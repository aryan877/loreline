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

function pageInstructions(context: ReadingContext) {
  const pointer = context.pointer
    ? `Pointer: ${Math.round(context.pointer.x * 100)}% from the left, ${Math.round(context.pointer.y * 100)}% from the top${context.pointer.text ? `, over “${context.pointer.text}”` : ""}.`
    : "No pointer is currently visible.";
  return [
    "You are Loreline, a calm, perceptive realtime reading companion.",
    "The live page is primary truth. Start with the visible page image, extracted text, selected text, and pointer. Only call search_book when the question needs information outside this page or the visible context is genuinely insufficient.",
    "Your spoken response is the narration. Keep it natural and compact. Use place_note for a definition, quote, steps, or a concise artifact that should remain visible. Use place_visual whenever an image, scene, analogy, map, or diagram would materially improve understanding; you may place multiple visuals in one explanation.",
    `Book: “${context.title}”. Current page: ${context.page}. ${pointer}`,
    context.selectedText ? `Selected text: “${context.selectedText}”` : "",
    context.visibleText
      ? `Visible page text:\n${context.visibleText.slice(0, 12000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function useLorelineVoice(
  context: ReadingContext,
  addBoardItem: (item: BoardItem) => void,
  addTranscript: (role: "user" | "assistant", text: string) => void,
) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState("");
  const sessionRef = useRef<RealtimeSession | null>(null);
  const contextRef = useRef(context);
  const boardRef = useRef(addBoardItem);
  const transcriptRef = useRef(addTranscript);
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
  }, [context, addBoardItem, addTranscript]);

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
        "Place a concise persistent note, definition, quote, comparison, or set of steps on the visual sideboard while explaining aloud.",
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

    return new RealtimeAgent({
      name: "Loreline",
      instructions: pageInstructions(contextRef.current),
      tools: [searchBook, placeNote, placeVisual],
    });
  }, [createVisual, queryClient]);

  const connect = useCallback(async () => {
    if (sessionRef.current) return;
    setError("");
    setState("connecting");
    try {
      const token = await getRealtimeToken(contextRef.current.title);
      const session = new RealtimeSession(buildAgent(), {
        model: token.model,
        transport: "webrtc",
        workflowName: "Loreline reading companion",
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
    } catch (cause) {
      setError(toUserMessage(cause, "Loreline couldn’t connect voice."));
      if (!(cause instanceof UserFacingError))
        showErrorToast(cause, "Loreline couldn’t connect voice.");
      setState("error");
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
    buildAgent,
  ]);

  useEffect(() => () => sessionRef.current?.close(), []);

  return {
    state,
    error,
    connected: state !== "idle" && state !== "error",
    connect,
    disconnect,
    interrupt: () => sessionRef.current?.interrupt(),
  };
}
