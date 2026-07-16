import type { PointerContext } from "./domain/reader";

export type BoardItem =
  | {
      id: string;
      kind: "note";
      title: string;
      body: string;
      tone: "paper" | "sage" | "sky" | "coral";
      createdAt: number;
    }
  | {
      id: string;
      kind: "image";
      title: string;
      url: string;
      prompt: string;
      createdAt: number;
    };

export type ReadingContext = {
  bookId: string;
  title: string;
  page: number;
  visibleText: string;
  selectedText: string;
  pointer: PointerContext;
  screenshot: string | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type VoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "error";
