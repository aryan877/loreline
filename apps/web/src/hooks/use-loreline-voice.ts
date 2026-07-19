"use client";

import { tool } from "@openai/agents";
import {
  RealtimeAgent,
  type RealtimeItem,
  RealtimeSession,
} from "@openai/agents/realtime";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { apiJson } from "@/lib/api-client";
import { toUserMessage, UserFacingError } from "@/lib/errors";
import { showErrorToast } from "@/lib/toast-error";
import type {
  IllustrationInput,
  IllustrationResponse,
  RealtimeCompactionResponse,
  RealtimeCompactionTurn,
  RealtimeMemory,
  RealtimeTokenResponse,
  SearchBookResponse,
} from "@loreline/contracts/ai";
import type {
  BoardItem,
  ReaderControls,
  ReadingContext,
  VoiceState,
} from "@loreline/contracts/reader";

const REALTIME_COMPACTION_RATIO = 0.95;

const realtimeUsageEventSchema = z.object({
  type: z.literal("response.done"),
  response: z.object({
    usage: z.object({ input_tokens: z.number().int().nonnegative() }).nullish(),
  }),
});

async function searchBookRequest(bookId: string, query: string) {
  return apiJson<SearchBookResponse>("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, query, limit: 5 }),
  });
}

async function createIllustration(input: IllustrationInput) {
  return apiJson<IllustrationResponse>("/api/illustrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function mintRealtimeToken(bookTitle: string) {
  return apiJson<RealtimeTokenResponse>("/api/realtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookTitle }),
  });
}

async function compactRealtimeConversation(input: {
  bookId: string;
  page: number;
  previousMemory: RealtimeMemory | null;
  turns: RealtimeCompactionTurn[];
}) {
  return apiJson<RealtimeCompactionResponse>("/api/realtime/compact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

function realtimeConversationBudget(model: string) {
  return model.startsWith("gpt-realtime-2.1") ? 96_000 : 20_000;
}

function realtimeTurns(history: RealtimeItem[]): RealtimeCompactionTurn[] {
  const turns: RealtimeCompactionTurn[] = [];
  for (const item of history) {
    if (item.type === "message" && item.role !== "system") {
      const text = item.content
        .map((part) => {
          if (part.type === "input_text" || part.type === "output_text")
            return part.text;
          return part.transcript ?? "";
        })
        .join("\n")
        .trim()
        .slice(0, 12_000);
      if (text)
        turns.push({
          role: item.role,
          text,
        });
      continue;
    }
    if (
      item.type === "function_call" ||
      item.type === "mcp_call" ||
      item.type === "mcp_tool_call"
    ) {
      const text = [
        `${item.name}(${item.arguments})`,
        item.output ? `Result: ${item.output}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 12_000);
      turns.push({ role: "tool", text });
    }
  }
  return turns.slice(-500);
}

function pageInstructions(
  context: ReadingContext,
  memory: RealtimeMemory | null,
) {
  return [
    "You are Loreline, a calm, perceptive realtime reading companion.",
    "The live page is primary truth. Start with extracted visible text and the reader's selected text. No page image is sent automatically. Call inspect_page when the reader asks about a diagram, picture, visual layout, or refers to something with words like this, here, or under my cursor. Every requested inspection attaches the entire rendered page and visibly marks the live cursor when it is on the PDF; pointer scope also returns any extracted text under that point.",
    "Do not call inspect_page merely because the page or pointer changed, and do not claim to see page pixels until the tool confirms that it attached an image. Only call search_book when the question needs information outside this page or the visible context is genuinely insufficient.",
    "Before quoting, explaining, or narrating a specific passage, call focus_passage with the exact words and page so the reader can see what you are discussing. Use save_highlight_note when the reader asks to keep a note attached to a passage. Use place_note only for a temporary freeform sideboard artifact. Use place_visual whenever an image, scene, analogy, map, or diagram would materially improve understanding.",
    "Use voice for conversation and spoken navigation. Do not begin continuous narration or turn pages automatically. Obey explicit spoken requests to move to the next or previous PDF page.",
    `Book: “${context.title}”. Current page: ${context.page}.`,
    context.selectedText ? `Selected text: “${context.selectedText}”` : "",
    context.visibleText
      ? `Visible page text:\n${context.visibleText.slice(0, 12000)}`
      : "",
    context.savedPassages.length
      ? `Saved passages on this page:\n${context.savedPassages
          .map(
            (passage) =>
              `- “${passage.text}”${passage.note ? ` — Note: ${passage.note}` : ""}`,
          )
          .join("\n")}`
      : "",
    memory
      ? `Long-session conversation memory. Treat this as a compacted record of earlier turns; the live page remains primary truth:\n${JSON.stringify(memory)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function useLorelineVoice(
  context: ReadingContext,
  addBoardItem: (item: BoardItem) => void,
  readerControls: ReaderControls,
) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState("");
  const sessionRef = useRef<RealtimeSession | null>(null);
  const connectionRef = useRef<Promise<RealtimeSession | null> | null>(null);
  const connectionEpochRef = useRef(0);
  const contextRef = useRef(context);
  const boardRef = useRef(addBoardItem);
  const controlsRef = useRef(readerControls);
  const memoryRef = useRef<RealtimeMemory | null>(null);
  const compactingRef = useRef(false);
  const { mutateAsync: createVisual } = useMutation({
    mutationFn: createIllustration,
  });
  const { mutateAsync: getRealtimeToken } = useMutation({
    mutationFn: mintRealtimeToken,
  });
  const { mutateAsync: compactConversation } = useMutation({
    mutationFn: compactRealtimeConversation,
  });
  useEffect(() => {
    contextRef.current = context;
    boardRef.current = addBoardItem;
    controlsRef.current = readerControls;
  }, [context, addBoardItem, readerControls]);

  const buildAgent = useCallback(() => {
    const inspectPage = tool({
      name: "inspect_page",
      description:
        "Visually inspect the rendered PDF page. Every scope attaches the entire page and visibly marks the live cursor when it is on the PDF. Use pointer scope for phrases like this, here, or under my cursor so the answer is anchored to the marked position and extracted text under it. Use page scope for diagrams, pictures, page design, or overall layout. Never call this tool just because the pointer or page changed.",
      parameters: z.object({
        scope: z.enum(["pointer", "page"]),
      }),
      execute: async ({ scope }) => {
        setState("inspecting");
        try {
          const current = contextRef.current;
          const session = sessionRef.current;
          if (!session || session.transport.status !== "connected")
            return `Current page: ${current.page}. A visual snapshot is unavailable because voice is not connected.`;

          const capture = controlsRef.current.capturePageImage({
            markPointer: true,
          });
          if (!capture)
            return `Current page: ${current.page}. The rendered page image is not ready, so answer from the extracted text or ask the reader to try again.`;

          const pointerSummary = capture.pointer
            ? `${Math.round(capture.pointer.x * 100)}% from the left and ${Math.round(capture.pointer.y * 100)}% from the top${capture.pointer.text ? `, over “${capture.pointer.text}”` : ""}`
            : "not currently on the page";

          try {
            session.addImage(capture.dataUrl, { triggerResponse: false });
            return scope === "pointer"
              ? `Attached the compressed full page ${capture.page} with the cursor visibly marked at ${pointerSummary}. Use the annotated image, the extracted pointer text when present, and the live page text together.`
              : `Attached a compressed full-page image for page ${capture.page}${capture.pointer ? ` with the live cursor visibly marked at ${pointerSummary}` : ", with no cursor currently on the PDF"}. Use that image and the live page text to answer.`;
          } catch (cause) {
            console.error(
              "Loreline could not attach the requested page image",
              cause,
            );
            return `Current page: ${capture.page}. The pointer is ${pointerSummary}. The visual snapshot could not be attached, so answer from extracted text or ask the reader to try again.`;
          }
        } finally {
          if (sessionRef.current?.transport.status === "connected")
            setState("listening");
        }
      },
    });

    const searchBook = tool({
      name: "search_book",
      description:
        "Search other parts of the current book. Use only when the visible page, selection, and an on-demand page inspection are insufficient.",
      parameters: z.object({
        query: z.string().min(2).max(1000),
        reason: z.string().min(2).max(300),
      }),
      execute: async ({ query }) => {
        const current = contextRef.current;
        try {
          const data = await queryClient.fetchQuery({
            queryKey: ["book-search", current.bookId, query],
            queryFn: () => searchBookRequest(current.bookId, query),
            staleTime: 60_000,
          });
          return (
            data.results
              .map(
                (result) =>
                  `[Pages ${result.pageStart}-${result.pageEnd}] ${result.content}`,
              )
              .join("\n\n") || "No relevant passages were found."
          );
        } catch {
          return "Book search is temporarily unavailable.";
        }
      },
    });

    const placeNote = tool({
      name: "place_note",
      description:
        "Place a temporary freeform note, definition, comparison, or set of steps on the visual sideboard. To persist a note against PDF text, use save_highlight_note instead.",
      parameters: z.object({
        title: z.string().min(1).max(80),
        body: z.string().min(1).max(1200),
        tone: z.enum(["paper", "sage", "sky", "coral"]),
      }),
      execute: async ({ title, body, tone }) => {
        boardRef.current({
          id: crypto.randomUUID(),
          kind: "note",
          title,
          body,
          tone,
          createdAt: Date.now(),
        });
        return `Placed “${title}” on the reader's sideboard.`;
      },
    });

    const placeVisual = tool({
      name: "place_visual",
      description:
        "Generate and pin a visual explanation, imagined scene, analogy, diagram-like composition, or conceptual image to the sideboard. Use whenever seeing would help more than more words; multiple calls are allowed.",
      parameters: z.object({
        title: z.string().min(1).max(80),
        prompt: z.string().min(3).max(1800),
      }),
      execute: async ({ title, prompt }) => {
        const current = contextRef.current;
        try {
          const data = await createVisual({
            bookId: current.bookId,
            page: current.page,
            prompt,
            visibleText: current.visibleText,
          });
          boardRef.current({
            id: data.id,
            kind: "image",
            title,
            url: data.dataUrl,
            prompt,
            createdAt: Date.now(),
          });
          return `Generated and pinned “${title}” to the sideboard.`;
        } catch {
          return "Visual generation is temporarily unavailable.";
        }
      },
    });

    const focusPassage = tool({
      name: "focus_passage",
      description:
        "Focus and visibly highlight exact words on a PDF page before narrating, quoting, or explaining them.",
      parameters: z.object({
        page: z.number().int().positive(),
        text: z.string().trim().min(2).max(2000),
      }),
      execute: async ({ page, text }) => {
        const located = await controlsRef.current.focusPassage({ page, text });
        return located
          ? `Focused the requested passage on page ${page}.`
          : `The exact passage could not be located on page ${page}.`;
      },
    });

    const turnPage = tool({
      name: "turn_page",
      description:
        "Move the PDF to the next or previous page when the reader explicitly asks for spoken navigation.",
      parameters: z.object({
        direction: z.enum(["next", "previous"]),
      }),
      execute: async ({ direction }) => {
        const current = contextRef.current;
        const target = current.page + (direction === "next" ? 1 : -1);
        return controlsRef.current.goToPage(target)
          ? `Moved to page ${target}. Wait for the updated page context before continuing.`
          : direction === "next"
            ? "This is the final page."
            : "This is the first page.";
      },
    });

    const saveHighlightNote = tool({
      name: "save_highlight_note",
      description:
        "Persist a note linked to an exact passage in the PDF. The passage will be highlighted and the note will appear in Saved notes.",
      parameters: z.object({
        page: z.number().int().positive(),
        text: z.string().trim().min(2).max(2000),
        note: z.string().trim().min(1).max(4000),
      }),
      execute: async ({ page, text, note }) => {
        try {
          const saved = await controlsRef.current.savePassageNote({
            page,
            text,
            note,
          });
          return saved
            ? `Saved a note linked to the passage on page ${page}.`
            : `The exact passage could not be located, so no note was saved.`;
        } catch {
          return "The passage note is temporarily unavailable.";
        }
      },
    });

    return new RealtimeAgent({
      name: "Loreline",
      instructions: pageInstructions(contextRef.current, memoryRef.current),
      tools: [
        inspectPage,
        searchBook,
        focusPassage,
        turnPage,
        saveHighlightNote,
        placeNote,
        placeVisual,
      ],
    });
  }, [createVisual, queryClient]);

  const compactSession = useCallback(
    async (session: RealtimeSession) => {
      if (compactingRef.current) return;
      const history = session.history;
      const turns = realtimeTurns(history);
      if (!turns.length) return;
      const summarizedItemIds = new Set(history.map((item) => item.itemId));
      compactingRef.current = true;
      try {
        const { memory } = await compactConversation({
          bookId: contextRef.current.bookId,
          page: contextRef.current.page,
          previousMemory: memoryRef.current,
          turns,
        });
        memoryRef.current = memory;
        await session.updateAgent(buildAgent());
        session.updateHistory((current) =>
          current.filter((item) => !summarizedItemIds.has(item.itemId)),
        );
      } catch (cause) {
        console.error("Loreline could not compact the voice session", cause);
      } finally {
        compactingRef.current = false;
      }
    },
    [buildAgent, compactConversation],
  );

  const connect = useCallback(() => {
    if (sessionRef.current) return Promise.resolve(sessionRef.current);
    if (connectionRef.current) return connectionRef.current;

    const connectionEpoch = ++connectionEpochRef.current;
    setError("");
    setState("connecting");
    const connection = (async () => {
      let session: RealtimeSession | null = null;
      try {
        const token = await getRealtimeToken(contextRef.current.title);
        const conversationBudget = realtimeConversationBudget(token.model);
        session = new RealtimeSession(buildAgent(), {
          model: token.model,
          transport: "webrtc",
          workflowName: "Loreline reading companion",
          config: {
            providerData: {
              truncation: {
                type: "retention_ratio",
                retention_ratio: 0.7,
                token_limits: {
                  post_instructions: conversationBudget,
                },
              },
            },
          },
        });
        const activeSession = session;
        activeSession.on("audio_start", () => setState("speaking"));
        activeSession.on("audio_stopped", () => setState("listening"));
        activeSession.on("audio_interrupted", () => setState("listening"));
        activeSession.on("transport_event", (event) => {
          const parsed = realtimeUsageEventSchema.safeParse(event);
          const inputTokens = parsed.success
            ? (parsed.data.response.usage?.input_tokens ?? 0)
            : 0;
          if (inputTokens >= conversationBudget * REALTIME_COMPACTION_RATIO)
            void compactSession(activeSession);
        });
        activeSession.on("error", ({ error: cause }) => {
          console.error("Loreline Realtime session error", cause);
          if (
            sessionRef.current !== activeSession ||
            activeSession.transport.status === "connected"
          )
            return;
          const connectionError = new UserFacingError(
            "The voice connection was interrupted. Please reconnect.",
          );
          setError(connectionError.message);
          showErrorToast(connectionError);
          setState("error");
        });
        await activeSession.connect({ apiKey: token.clientSecret });
        if (connectionEpochRef.current !== connectionEpoch) {
          activeSession.close();
          return null;
        }
        sessionRef.current = activeSession;
        setError("");
        setState("listening");
        return activeSession;
      } catch (cause) {
        session?.close();
        if (connectionEpochRef.current !== connectionEpoch) return null;
        setError(toUserMessage(cause, "Loreline couldn’t connect voice."));
        if (!(cause instanceof UserFacingError))
          showErrorToast(cause, "Loreline couldn’t connect voice.");
        setState("error");
        return null;
      }
    })();
    connectionRef.current = connection;
    void connection.finally(() => {
      if (connectionRef.current === connection) connectionRef.current = null;
    });
    return connection;
  }, [buildAgent, compactSession, getRealtimeToken]);

  const disconnect = useCallback(() => {
    connectionEpochRef.current += 1;
    connectionRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.close();
    setError("");
    setState("idle");
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const timeout = window.setTimeout(() => {
      void session.updateAgent(buildAgent()).catch((cause) => {
        console.error(
          "Loreline could not refresh the live page context",
          cause,
        );
      });
    }, 850);
    return () => window.clearTimeout(timeout);
  }, [
    context.page,
    context.visibleText,
    context.selectedText,
    context.savedPassages,
    buildAgent,
  ]);

  useEffect(
    () => () => {
      connectionEpochRef.current += 1;
      connectionRef.current = null;
      const session = sessionRef.current;
      sessionRef.current = null;
      session?.close();
    },
    [],
  );

  return {
    state,
    error,
    connected: state !== "idle" && state !== "error",
    connect,
    disconnect,
  };
}
