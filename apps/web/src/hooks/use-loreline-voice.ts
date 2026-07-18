"use client";

import { tool } from "@openai/agents";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { apiJson } from "@/lib/api-client";
import { toUserMessage, UserFacingError } from "@/lib/errors";
import { showErrorToast } from "@/lib/toast-error";
import type {
  IllustrationInput,
  IllustrationResponse,
  RealtimeTokenResponse,
  SearchBookResponse,
} from "@loreline/contracts/ai";
import type {
  BoardItem,
  ReaderControls,
  ReadingContext,
  VoiceState,
} from "@loreline/contracts/reader";

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

function realtimeConversationBudget(model: string) {
  return model.startsWith("gpt-realtime-2.1") ? 64_000 : 20_000;
}

function pageInstructions(context: ReadingContext) {
  const pointer = context.pointer
    ? `Pointer: ${Math.round(context.pointer.x * 100)}% from the left, ${Math.round(context.pointer.y * 100)}% from the top${context.pointer.text ? `, over “${context.pointer.text}”` : ""}.`
    : "No pointer is currently visible.";
  return [
    "You are Loreline, a calm, perceptive realtime reading companion.",
    "The live page is primary truth. Start with the visible page image, extracted text, selected text, and pointer. Only call search_book when the question needs information outside this page or the visible context is genuinely insufficient.",
    "Before quoting, explaining, or narrating a specific passage, call focus_passage with the exact words and page so the reader can see what you are discussing. Use save_highlight_note when the reader asks to keep a note attached to a passage. Use place_note only for a temporary freeform sideboard artifact. Use place_visual whenever an image, scene, analogy, map, or diagram would materially improve understanding.",
    context.readerMode
      ? "Reader mode is ON. Read the visible page naturally in coherent passages and call focus_passage before each passage. At the end of the page, call turn_page with next and stop until the updated page arrives; narration will then continue. Obey spoken requests to pause, resume, move to the next page, or move to the previous page. Never invent text that is not visible."
      : "Reader mode is OFF. Do not begin continuous narration unless the reader asks for it.",
    `Book: “${context.title}”. Current page: ${context.page}. ${pointer}`,
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
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function useLorelineVoice(
  context: ReadingContext,
  addBoardItem: (item: BoardItem) => void,
  addTranscript: (role: "user" | "assistant", text: string) => void,
  readerControls: ReaderControls,
) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState("");
  const sessionRef = useRef<RealtimeSession | null>(null);
  const contextRef = useRef(context);
  const boardRef = useRef(addBoardItem);
  const transcriptRef = useRef(addTranscript);
  const controlsRef = useRef(readerControls);
  const { mutateAsync: createVisual } = useMutation({
    mutationFn: createIllustration,
  });
  const { mutateAsync: getRealtimeToken } = useMutation({
    mutationFn: mintRealtimeToken,
  });
  useEffect(() => {
    contextRef.current = context;
    boardRef.current = addBoardItem;
    transcriptRef.current = addTranscript;
    controlsRef.current = readerControls;
  }, [context, addBoardItem, addTranscript, readerControls]);

  const buildAgent = useCallback(() => {
    const searchBook = tool({
      name: "search_book",
      description:
        "Search other parts of the current book. Use only when the visible page, selection, pointer, and page image are insufficient.",
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
        "Move the PDF to the next or previous page. Use for spoken navigation and at the end of a page in Reader mode.",
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
      instructions: pageInstructions(contextRef.current),
      tools: [
        searchBook,
        focusPassage,
        turnPage,
        saveHighlightNote,
        placeNote,
        placeVisual,
      ],
    });
  }, [createVisual, queryClient]);

  const connect = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    setError("");
    setState("connecting");
    try {
      const token = await getRealtimeToken(contextRef.current.title);
      const session = new RealtimeSession(buildAgent(), {
        model: token.model,
        transport: "webrtc",
        workflowName: "Loreline reading companion",
        config: {
          providerData: {
            truncation: {
              type: "retention_ratio",
              retention_ratio: 0.7,
              token_limits: {
                post_instructions: realtimeConversationBudget(token.model),
              },
            },
          },
        },
      });
      session.on("audio_start", () => setState("speaking"));
      session.on("audio_stopped", () => setState("listening"));
      session.on("audio_interrupted", () => setState("listening"));
      session.on("agent_end", (_ctx, _agent, output) => {
        if (output?.trim()) transcriptRef.current("assistant", output.trim());
      });
      session.on("error", () => {
        const error = new UserFacingError(
          "The voice connection was interrupted. Please reconnect.",
        );
        setError(error.message);
        showErrorToast(error);
        setState("error");
      });
      await session.connect({ apiKey: token.clientSecret });
      sessionRef.current = session;
      if (contextRef.current.screenshot)
        session.addImage(contextRef.current.screenshot, {
          triggerResponse: false,
        });
      setState("listening");
      return session;
    } catch (cause) {
      setError(toUserMessage(cause, "Loreline couldn’t connect voice."));
      if (!(cause instanceof UserFacingError))
        showErrorToast(cause, "Loreline couldn’t connect voice.");
      setState("error");
      return null;
    }
  }, [buildAgent, getRealtimeToken]);

  const disconnect = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setState("idle");
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const timeout = window.setTimeout(async () => {
      await session.updateAgent(buildAgent());
      if (contextRef.current.screenshot)
        session.addImage(contextRef.current.screenshot, {
          triggerResponse: false,
        });
    }, 850);
    return () => window.clearTimeout(timeout);
  }, [
    context.page,
    context.visibleText,
    context.selectedText,
    context.pointer?.x,
    context.pointer?.y,
    context.readerMode,
    buildAgent,
  ]);

  const previousReaderPage = useRef(context.page);
  useEffect(() => {
    const previousPage = previousReaderPage.current;
    previousReaderPage.current = context.page;
    if (
      !context.readerMode ||
      context.page === previousPage ||
      !sessionRef.current
    )
      return;
    const timeout = window.setTimeout(() => {
      sessionRef.current?.sendMessage(
        `Continue Reader mode from the beginning of visible page ${context.page}. Focus each exact passage before reading it.`,
      );
    }, 950);
    return () => window.clearTimeout(timeout);
  }, [context.page, context.readerMode]);

  useEffect(() => () => sessionRef.current?.close(), []);

  return {
    state,
    error,
    connected: state !== "idle" && state !== "error",
    connect,
    disconnect,
    interrupt: () => sessionRef.current?.interrupt(),
    startNarration: async () => {
      const session = await connect();
      session?.sendMessage(
        `Begin Reader mode on visible page ${contextRef.current.page}. Read naturally in coherent passages and focus each exact passage before speaking it.`,
      );
    },
    stopNarration: () => sessionRef.current?.interrupt(),
  };
}
