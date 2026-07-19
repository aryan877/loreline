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
  search_book: {
    running: "Searching this book…",
    success: "Book search complete",
    failed: "Book search failed",
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
  return /could not|failed|temporarily unavailable|not ready|no note was saved|is unavailable/i.test(
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

const realtimeInputTranscriptSchema = z.object({
  type: z.literal("conversation.item.input_audio_transcription.completed"),
  item_id: z.string(),
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
    "# Role and Objective",
    "You are Loreline, a calm, perceptive realtime reading companion. Help the reader understand the live book while keeping the words you discuss visibly anchored on the page.",
    "# Tools",
    "Use only the tools currently provided. The reader-facing page tools are read-only and low risk: call them proactively when their conditions are met without asking for confirmation. Never pretend a tool ran. Only say an action succeeded after its result confirms success.",
    "## prepare_reader_response — REQUIRED PRIVATE DECISION",
    "Every completed user voice turn begins with a forced prepare_reader_response call before audio can be produced. This is an intent decision, not a requirement to manipulate the page. Choose conversation for ordinary conversation or a follow-up that does not depend on visible page content. Choose keep_focus when answering a follow-up about the already focused passage; preserve that highlight without moving, recapturing, or flashing the page. Choose focus only when teaching, quoting, interpreting, summarizing, or narrating a new visible passage. Choose inspect_pointer or inspect_page only when pixels or spatial layout are genuinely needed, such as a picture, diagram, page design, an explicit request to look at or screenshot the page, or a reference to this, here, or under the cursor. Never take a screenshot merely because a response has no exact passage.",
    "## Page-material decisions",
    "The preparation function is the single path for focusing text or inspecting page pixels. It is also your direct screenshot capability: inspect_pointer and inspect_page make the host browser capture the rendered PDF and attach that image to this conversation. Never claim that you cannot take or inspect a screenshot before choosing the appropriate inspection mode and reading its result. Docker does not limit this capability because capture occurs in the reader's browser. For focus, supply one short contiguous verbatim quote of roughly 8–30 words and wait for its result before explaining. For inspection, wait for the attached image before describing pixels. Do not retry a failed preparation with another mode and do not substitute inspection for a failed focus.",
    "## Other tools",
    "Call search_book only when the live page, selection, and an on-demand page inspection are genuinely insufficient. Use save_highlight_note for a persistent note linked to PDF text. Use place_note only for a temporary sideboard thought. Use place_visual when an image, scene, analogy, map, or diagram would materially improve understanding. Use turn_page only after an explicit spoken navigation request.",
    "# Tool Failures",
    "If a tool fails, explain the failure briefly in reader-friendly language. Do not retry it through another tool or mode, expose raw errors, or claim completion.",
    "# Conversation Flow",
    "Speak conversationally and compactly. Do not begin continuous narration or turn pages automatically. When teaching from the page, the sequence is: focus the exact passage, wait for success, then explain it aloud.",
    "# Live Context",
    `Book: “${context.title}”. Current page: ${context.page}. The live page is primary truth.`,
    context.selectedText ? `Selected text: “${context.selectedText}”` : "",
    context.focusedPassage
      ? `Currently focused and visibly highlighted passage on page ${context.focusedPassage.page}: “${context.focusedPassage.text}”`
      : "No passage is currently focused by Loreline.",
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
  const processedAudioItemsRef = useRef(new Set<string>());
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
    const inspectRenderedPage = async (scope: "pointer" | "page") => {
      updateState("inspecting");
      try {
        const current = contextRef.current;
        const session = sessionRef.current;
        if (!session || session.transport.status !== "connected")
          return `Page inspection failed on page ${current.page} because voice is not connected.`;

        const capture = controlsRef.current.capturePageImage({
          markPointer: true,
        });
        if (!capture)
          return `Page inspection failed on page ${current.page} because the rendered page image is not ready.`;

        const pointerSummary = capture.pointer
          ? `${Math.round(capture.pointer.x * 100)}% from the left and ${Math.round(capture.pointer.y * 100)}% from the top${capture.pointer.text ? `, over “${capture.pointer.text}”` : ""}`
          : "not currently on the page";

        try {
          session.addImage(capture.dataUrl, { triggerResponse: false });
          return scope === "pointer"
            ? `Screenshot captured and attached for page ${capture.page}, with the cursor visibly marked at ${pointerSummary}. You can inspect this image directly. Use the annotated image, the extracted pointer text when present, and the live page text together.`
            : `Screenshot captured and attached for page ${capture.page}${capture.pointer ? ` with the live cursor visibly marked at ${pointerSummary}` : ", with no cursor currently on the PDF"}. You can inspect this image directly. Use it with the live page text to answer.`;
        } catch (cause) {
          console.error(
            "Loreline could not attach the requested page image",
            cause,
          );
          return `Page inspection failed on page ${capture.page} because the visual snapshot could not be attached.`;
        }
      } finally {
        window.setTimeout(() => {
          if (
            stateRef.current === "inspecting" &&
            sessionRef.current?.transport.status === "connected"
          )
            updateState("thinking");
        }, 1_100);
      }
    };

    const prepareReaderResponse = tool({
      name: "prepare_reader_response",
      description:
        "Mandatory private intent decision before each voice response. It may deliberately take no page action. This is also the model's direct screenshot tool: inspect_pointer and inspect_page make the host browser capture the rendered PDF and attach the image for vision. Use conversation for a normal conversational response, keep_focus for a follow-up about the passage already highlighted, focus for a new passage, and inspection for a visual question or an explicit request to look at or screenshot the page.",
      parameters: z.object({
        mode: z.enum([
          "conversation",
          "keep_focus",
          "focus",
          "inspect_pointer",
          "inspect_page",
        ]).describe(
          "The model-decided page action. inspect_pointer and inspect_page capture and attach a real screenshot from the host browser.",
        ),
        page: z
          .number()
          .int()
          .positive()
          .describe("The current or target PDF page number."),
        text: z
          .string()
          .trim()
          .max(2000)
          .optional()
          .describe("Required only for focus: a short exact PDF quote."),
      }),
      execute: async ({ mode, page, text }) => {
        const current = contextRef.current;
        if (mode === "conversation")
          return "No page action is needed. Respond conversationally without changing the reader's focus or inspecting the page.";
        if (mode === "keep_focus") {
          const focused = current.focusedPassage;
          return focused
            ? `Keep the existing visible highlight on page ${focused.page} while answering the follow-up about “${focused.text}”. Do not inspect or refocus the page.`
            : "Preparation failed because there is no existing focused passage to keep.";
        }
        if (mode === "inspect_pointer") return inspectRenderedPage("pointer");
        if (mode === "inspect_page") return inspectRenderedPage("page");

        const passage = text?.trim() ?? "";
        if (!passage)
          return `Passage focus failed on page ${page} because no exact quote was provided.`;
        const located = await controlsRef.current.focusPassage({
          page,
          text: passage,
        });
        if (located)
          return `Focused the teaching passage on page ${page}. The spoken explanation may now begin.`;
        return `Passage focus failed because the exact quote could not be located on page ${page}.`;
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
        prepareReaderResponse,
        searchBook,
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
    const existingSession = sessionRef.current;
    if (existingSession?.transport.status === "connected")
      return Promise.resolve(existingSession);
    if (existingSession) {
      existingSession.close();
      sessionRef.current = null;
    }
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
            audio: {
              input: {
                turnDetection: {
                  type: "semantic_vad",
                  eagerness: "auto",
                  createResponse: false,
                  interruptResponse: true,
                },
              },
            },
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
            if (action === "prepare_reader_response") {
              updateState("thinking");
              return;
            }
            publishActivity({
              id: callId,
              action,
              label: copy.running,
              status: "running",
            });
            updateState("thinking");
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
            if (action === "prepare_reader_response") {
              if (
                stateRef.current !== "speaking" &&
                stateRef.current !== "inspecting"
              )
                updateState("thinking");
              return;
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
          const inputTranscript = realtimeInputTranscriptSchema.safeParse(event);
          if (
            inputTranscript.success &&
            !processedAudioItemsRef.current.has(inputTranscript.data.item_id)
          ) {
            processedAudioItemsRef.current.add(inputTranscript.data.item_id);
            activeSession.transport.requestResponse?.({
              tool_choice: {
                type: "function",
                name: "prepare_reader_response",
              },
            });
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
          sessionRef.current = null;
          activeSession.close();
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
    processedAudioItemsRef.current.clear();
    updateState("idle");
  }, [publishActivity, updateState]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || session.transport.status !== "connected") return;
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
    context.focusedPassage,
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
