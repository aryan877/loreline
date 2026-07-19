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

type VoiceActivity = {
  id: string;
  action: string;
  label: string;
  status: "running" | "success" | "failed";
};

const voiceToolActivity: Record<
  string,
  { running: string; success: string; failed: string }
> = {
  inspect_page: {
    running: "Sharing the page with Loreline…",
    success: "Page shared with Loreline",
    failed: "Page inspection failed",
  },
  search_book: {
    running: "Searching this book…",
    success: "Book search complete",
    failed: "Book search failed",
  },
  focus_passage: {
    running: "Finding that passage…",
    success: "Passage focused on the page",
    failed: "Passage could not be located",
  },
  turn_page: {
    running: "Turning the page…",
    success: "Page changed",
    failed: "Page could not be changed",
  },
  save_highlight_note: {
    running: "Saving the passage…",
    success: "Passage and note saved",
    failed: "Passage note was not saved",
  },
  place_note: {
    running: "Pinning a thought…",
    success: "Thought pinned to the board",
    failed: "Thought could not be pinned",
  },
  place_visual: {
    running: "Creating a visual…",
    success: "Visual added to the board",
    failed: "Visual could not be created",
  },
};

function voiceToolFailed(result: string) {
  return /could not|temporarily unavailable|not ready|no note was saved|is unavailable/i.test(
    result,
  );
}

const realtimeUsageEventSchema = z.object({
  type: z.literal("response.done"),
  response: z.object({
    usage: z.object({ input_tokens: z.number().int().nonnegative() }).nullish(),
  }),
});

const realtimeSpeechEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input_audio_buffer.speech_started") }),
  z.object({ type: z.literal("input_audio_buffer.speech_stopped") }),
]);

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
    "# Role and Objective",
    "You are Loreline, a calm, perceptive realtime reading companion. Help the reader understand the live book while keeping the words you discuss visibly anchored on the page.",
    "# Tools",
    "Use only the tools currently provided. The reader-facing page tools are read-only and low risk: call them proactively when their conditions are met without asking for confirmation. Never pretend a tool ran. Only say an action succeeded after its result confirms success.",
    "## focus_passage — PROACTIVE TEACHING ANCHOR",
    "Before speaking any explanation, quotation, interpretation, or narration of visible text, first call focus_passage with the correct page and one short contiguous verbatim quote of roughly 8–30 words. Call it before the spoken explanation so the reader can see the exact words while listening. If no match is found, retry once with a shorter exact quote copied from the live visible text. If that also fails, briefly say you could not place the focus; never silently continue as if it worked.",
    "## inspect_page — PROACTIVE VISUAL LOOK",
    "No page image is sent automatically. Call inspect_page when the reader asks about a picture, diagram, visual layout, or refers to this, here, or under my cursor. Use pointer scope for a local reference and page scope for the overall page. Wait for the result before describing pixels. Do not call it merely because the page or pointer moved.",
    "## Other tools",
    "Call search_book only when the live page, selection, and an on-demand page inspection are genuinely insufficient. Use save_highlight_note for a persistent note linked to PDF text. Use place_note only for a temporary sideboard thought. Use place_visual when an image, scene, analogy, map, or diagram would materially improve understanding. Use turn_page only after an explicit spoken navigation request.",
    "# Tool Failures",
    "If a tool fails, explain the failure briefly in reader-friendly language. Retry focus_passage once with a shorter exact quote. Do not repeat any other failed call with identical arguments, expose raw errors, or claim completion.",
    "# Conversation Flow",
    "Speak conversationally and compactly. Do not begin continuous narration or turn pages automatically. When teaching from the page, the sequence is: focus the exact passage, wait for success, then explain it aloud.",
    "# Live Context",
    `Book: “${context.title}”. Current page: ${context.page}. The live page is primary truth.`,
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
  const [activity, setActivity] = useState<VoiceActivity | null>(null);
  const [error, setError] = useState("");
  const stateRef = useRef<VoiceState>("idle");
  const sessionRef = useRef<RealtimeSession | null>(null);
  const connectionRef = useRef<Promise<RealtimeSession | null> | null>(null);
  const connectionEpochRef = useRef(0);
  const contextRef = useRef(context);
  const boardRef = useRef(addBoardItem);
  const controlsRef = useRef(readerControls);
  const memoryRef = useRef<RealtimeMemory | null>(null);
  const compactingRef = useRef(false);
  const activityTimeoutRef = useRef<number | null>(null);
  const toolStartedAtRef = useRef(new Map<string, number>());
  const updateState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const publishActivity = useCallback(
    (next: VoiceActivity | null, clearAfter = 0) => {
      if (activityTimeoutRef.current !== null) {
        window.clearTimeout(activityTimeoutRef.current);
        activityTimeoutRef.current = null;
      }
      setActivity(next);
      if (next && clearAfter > 0)
        activityTimeoutRef.current = window.setTimeout(() => {
          setActivity(null);
          activityTimeoutRef.current = null;
        }, clearAfter);
    },
    [],
  );
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
        updateState("inspecting");
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
            updateState("thinking");
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
        "Focus and visibly highlight exact words on a PDF page before narrating, quoting, or explaining them. Pass a short contiguous verbatim quote from the visible page, ideally 8–30 words. If it is not found, retry once with a shorter exact quote.",
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
  }, [createVisual, queryClient, updateState]);

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
    updateState("connecting");
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
            reasoning: { effort: "low" },
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
        activeSession.on("agent_start", () => updateState("thinking"));
        activeSession.on(
          "agent_tool_start",
          (_runContext, _agent, activeTool, details) => {
            const action = activeTool.name;
            const callId =
              details.toolCall.type === "function_call"
                ? details.toolCall.callId
                : (details.toolCall.id ?? crypto.randomUUID());
            const copy = voiceToolActivity[action] ?? {
              running: "Working on that…",
              success: "Action complete",
              failed: "Action failed",
            };
            toolStartedAtRef.current.set(callId, performance.now());
            publishActivity({
              id: callId,
              action,
              label: copy.running,
              status: "running",
            });
            updateState(action === "inspect_page" ? "inspecting" : "thinking");
          },
        );
        activeSession.on(
          "agent_tool_end",
          (_runContext, _agent, activeTool, result, details) => {
            const action = activeTool.name;
            const callId =
              details.toolCall.type === "function_call"
                ? details.toolCall.callId
                : (details.toolCall.id ?? action);
            const copy = voiceToolActivity[action] ?? {
              running: "Working on that…",
              success: "Action complete",
              failed: "Action failed",
            };
            const failed = voiceToolFailed(result);
            const startedAt = toolStartedAtRef.current.get(callId);
            if (startedAt !== undefined) {
              performance.measure(`loreline:${action}`, {
                start: startedAt,
                end: performance.now(),
                detail: { action, failed, page: contextRef.current.page },
              });
              toolStartedAtRef.current.delete(callId);
            }
            publishActivity(
              {
                id: callId,
                action,
                label: failed ? copy.failed : copy.success,
                status: failed ? "failed" : "success",
              },
              3_200,
            );
            if (stateRef.current !== "speaking") updateState("thinking");
          },
        );
        activeSession.on("agent_end", () => {
          if (stateRef.current !== "speaking") updateState("listening");
        });
        activeSession.on("audio_start", () => updateState("speaking"));
        activeSession.on("audio_stopped", () => updateState("listening"));
        activeSession.on("audio_interrupted", () => updateState("listening"));
        activeSession.on("transport_event", (event) => {
          const speechEvent = realtimeSpeechEventSchema.safeParse(event);
          if (speechEvent.success) {
            updateState(
              speechEvent.data.type === "input_audio_buffer.speech_started"
                ? "listening"
                : "thinking",
            );
          }
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
          updateState("error");
        });
        await activeSession.connect({ apiKey: token.clientSecret });
        if (connectionEpochRef.current !== connectionEpoch) {
          activeSession.close();
          return null;
        }
        sessionRef.current = activeSession;
        setError("");
        updateState("listening");
        return activeSession;
      } catch (cause) {
        session?.close();
        if (connectionEpochRef.current !== connectionEpoch) return null;
        setError(toUserMessage(cause, "Loreline couldn’t connect voice."));
        if (!(cause instanceof UserFacingError))
          showErrorToast(cause, "Loreline couldn’t connect voice.");
        updateState("error");
        return null;
      }
    })();
    connectionRef.current = connection;
    void connection.finally(() => {
      if (connectionRef.current === connection) connectionRef.current = null;
    });
    return connection;
  }, [
    buildAgent,
    compactSession,
    getRealtimeToken,
    publishActivity,
    updateState,
  ]);

  const disconnect = useCallback(() => {
    connectionEpochRef.current += 1;
    connectionRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.close();
    setError("");
    publishActivity(null);
    toolStartedAtRef.current.clear();
    updateState("idle");
  }, [publishActivity, updateState]);

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
      if (activityTimeoutRef.current !== null)
        window.clearTimeout(activityTimeoutRef.current);
    },
    [],
  );

  return {
    state,
    activity,
    error,
    connected: state !== "idle" && state !== "error",
    connect,
    disconnect,
  };
}
