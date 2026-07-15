import type { PointerContext } from "./ai";
import type { MessageRow } from "../db/types";

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
  role: MessageRow["role"];
  content: string;
  createdAt: number;
};

export type VoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "error";
