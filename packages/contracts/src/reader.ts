import type { HighlightRect, PointerContext } from "./domain/reader";

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
  savedPassages: Array<{
    text: string;
    note: string | null;
  }>;
};

export type ReaderSelection = {
  page: number;
  text: string;
  rects: HighlightRect[];
};

export type ReaderFocusRequest = {
  id: string;
  page: number;
  text: string;
};

export type ReaderFocus = ReaderSelection & { id: string };

export type ReaderControls = {
  focusPassage: (input: {
    page: number;
    text: string;
  }) => Promise<ReaderSelection | null>;
  savePassageNote: (input: {
    page: number;
    text: string;
    note: string;
  }) => Promise<boolean>;
  capturePageImage: (focus: PointerContext) => string | null;
  goToPage: (page: number) => boolean;
};

export type VoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "error";
