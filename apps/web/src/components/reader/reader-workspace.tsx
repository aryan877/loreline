"use client";

import {
  type InfiniteData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  LoaderCircle,
  Mic2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Logo } from "@/components/brand/logo";
import { RealtimeModelBadge } from "@/components/app/realtime-model-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLorelineVoice } from "@/hooks/use-loreline-voice";
import { apiJson } from "@/lib/api-client";
import { toUserMessage } from "@/lib/errors";
import type {
  BookProgressResponse,
  BookResponse,
  BooksPageResponse,
  ReaderBook,
} from "@loreline/contracts/books";
import type {
  Bookmark as SavedBookmark,
  BookmarkResponse,
  BookmarksResponse,
} from "@loreline/contracts/bookmarks";
import type { PointerContext } from "@loreline/contracts/domain/reader";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
  Highlight,
  HighlightResponse,
  HighlightsResponse,
} from "@loreline/contracts/highlights";
import type {
  BoardItem,
  ReaderControls,
  ReaderFocus,
  ReaderFocusRequest,
  ReaderSelection,
  VoiceState,
} from "@loreline/contracts/reader";

const PdfReader = dynamic(() => import("@/components/reader/pdf-reader"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[32rem] w-full place-items-center bg-reader-paper">
      <LoaderCircle className="size-5 animate-spin text-coral" />
    </div>
  ),
});

const PageNavigator = dynamic(
  () =>
    import("@/components/reader/page-navigator").then(
      (module) => module.PageNavigator,
    ),
  {
    ssr: false,
    loading: () => (
      <aside className="absolute inset-y-0 left-0 z-30 grid w-56 place-items-center border-r bg-background lg:relative">
        <LoaderCircle className="size-4 animate-spin text-brand-ink" />
      </aside>
    ),
  },
);

const MIN_READER_ZOOM = 0.5;
const MAX_READER_ZOOM = 4;
const READER_ZOOM_STEP = 0.05;

function normalizeReaderZoom(value: number) {
  return Math.min(
    MAX_READER_ZOOM,
    Math.max(MIN_READER_ZOOM, Number(value.toFixed(3))),
  );
}

async function getBook(bookId: string): Promise<ReaderBook> {
  const data = await apiJson<BookResponse>(`/api/books/${bookId}`);
  return data.book;
}

async function getHighlights(bookId: string) {
  const data = await apiJson<HighlightsResponse>(
    `/api/books/${bookId}/highlights`,
  );
  return data.highlights;
}

async function getBookmarks(bookId: string) {
  const data = await apiJson<BookmarksResponse>(
    `/api/books/${bookId}/bookmarks`,
  );
  return data.bookmarks;
}

const voiceOrbAppearance: Record<
  VoiceState,
  { surface: string; glow: string }
> = {
  idle: {
    surface: "bg-primary text-primary-foreground",
    glow: "bg-primary",
  },
  connecting: {
    surface: "bg-muted text-muted-foreground",
    glow: "bg-muted-foreground",
  },
  listening: {
    surface: "bg-sage-soft text-sage",
    glow: "bg-sage",
  },
  thinking: {
    surface: "bg-gold text-foreground",
    glow: "bg-gold",
  },
  inspecting: {
    surface: "bg-primary text-primary-foreground",
    glow: "bg-primary",
  },
  speaking: {
    surface: "bg-sky text-primary-foreground",
    glow: "bg-sky",
  },
  error: {
    surface: "bg-destructive text-primary-foreground",
    glow: "bg-destructive",
  },
};

function VoiceOrb({ state }: { state: VoiceState }) {
  const reduceMotion = useReducedMotion() ?? false;
  const active =
    state === "listening" ||
    state === "thinking" ||
    state === "inspecting" ||
    state === "speaking";
  const appearance = voiceOrbAppearance[state];
  return (
    <span
      className={cn(
        "relative isolate grid size-10 place-items-center rounded-full",
        appearance.surface,
      )}
    >
      {active && (
        <motion.span
          className={cn(
            "absolute -inset-1 -z-10 rounded-full blur-md",
            appearance.glow,
          )}
          animate={
            reduceMotion
              ? { opacity: 0.24 }
              : { scale: [0.96, 1.08, 0.96], opacity: [0.18, 0.42, 0.18] }
          }
          transition={{ duration: 1.4, repeat: reduceMotion ? 0 : Infinity }}
        />
      )}
      {state === "connecting" || state === "thinking" ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : state === "inspecting" ? (
        <Sparkles className="size-4" />
      ) : state === "speaking" ? (
        <Volume2 className="size-4" />
      ) : (
        <Mic2 className="size-4" />
      )}
    </span>
  );
}

type ConfirmationRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  confirm: () => Promise<void>;
};

function ConfirmationDialog({
  request,
  onDismiss,
}: {
  request: ConfirmationRequest | null;
  onDismiss: () => void;
}) {
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!request) return;
    setPending(true);
    try {
      await request.confirm();
      onDismiss();
    } catch {
      // TanStack Query's global mutation handler owns user-facing failures.
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && !pending) onDismiss();
      }}
    >
      <DialogContent className="rounded-2xl sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {request?.title}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {request?.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onDismiss}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            {request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SavedHighlightRow({
  highlight,
  isCurrentPage,
  onSelect,
}: {
  highlight: Highlight;
  isCurrentPage: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full items-center gap-2.5 rounded-xl border bg-card p-2.5 text-left shadow-sm outline-none transition-[background-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:bg-muted/35 hover:shadow-soft focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-reader-highlight/65 text-[0.68rem] font-semibold text-foreground">
        {highlight.page}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-foreground">
          {isCurrentPage ? "This page" : `Page ${highlight.page}`}
          {highlight.note ? (
            <span
              className="size-1.5 rounded-full bg-sage"
              aria-label="Has a note"
            />
          ) : null}
        </span>
        <span className="mt-0.5 line-clamp-2 block break-words text-[0.7rem] leading-snug text-muted-foreground">
          {highlight.note || highlight.text}
        </span>
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
    </button>
  );
}

function SavedHighlightDialog({
  highlight,
  onClose,
  onOpen,
  onUpdate,
  onDelete,
}: {
  highlight: Highlight;
  onClose: () => void;
  onOpen: () => void;
  onUpdate: (note: string | null) => Promise<void>;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(highlight.note ?? "");
  const [saving, setSaving] = useState(false);

  const changed = note.trim() !== (highlight.note ?? "");
  const save = async () => {
    if (!changed || saving) return;
    setSaving(true);
    try {
      await onUpdate(note.trim() || null);
      onClose();
    } catch {
      // TanStack Query's global mutation handler owns user-facing failures.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-xl">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-reader-highlight/65 text-sm font-semibold">
              {highlight.page}
            </span>
            <div>
              <DialogTitle className="font-display text-2xl">
                Saved passage
              </DialogTitle>
              <DialogDescription>Page {highlight.page}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <blockquote className="scrollbar-none max-h-52 overflow-y-auto rounded-xl bg-paper/65 p-4 text-sm leading-relaxed text-ink-soft ring-1 ring-inset ring-border">
          “{highlight.text}”
        </blockquote>
        <div className="space-y-2">
          <label
            htmlFor={`highlight-note-${highlight.id}`}
            className="text-xs font-semibold"
          >
            Your note
          </label>
          <Textarea
            id={`highlight-note-${highlight.id}`}
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 4000))}
            placeholder="Add a note to this passage…"
            rows={5}
            className="field-sizing-fixed min-h-32 resize-none bg-background"
          />
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
            Remove
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                onOpen();
                onClose();
              }}
            >
              Show on page
            </Button>
            <Button disabled={!changed || saving} onClick={() => void save()}>
              {saving ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <StickyNote />
              )}
              Save note
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type WorkspaceMode = "board" | "notes";

type SideboardProps = {
  book: ReaderBook;
  page: number;
  visibleText: string;
  selectedText: string;
  focusedPassage: ReaderFocus | null;
  pointer: PointerContext;
  items: BoardItem[];
  setItems: React.Dispatch<React.SetStateAction<BoardItem[]>>;
  highlights: Highlight[];
  bookmarks: SavedBookmark[];
  mode: WorkspaceMode;
  openHighlightId: string | null;
  readerControls: ReaderControls;
  onModeChange: (mode: WorkspaceMode) => void;
  onOpenHighlightEditor: (highlightId: string | null) => void;
  onOpenHighlight: (highlight: Highlight) => void;
  onUpdateHighlight: (
    highlightId: string,
    note: string | null,
  ) => Promise<void>;
  onDeleteHighlight: (highlightId: string) => Promise<void>;
  onOpenBookmark: (page: number) => void;
  onDeleteBookmark: (bookmarkId: string) => Promise<void>;
  onVoiceStateChange: (state: VoiceState) => void;
};

function Sideboard({
  book,
  page,
  visibleText,
  selectedText,
  focusedPassage,
  pointer,
  items,
  setItems,
  highlights,
  bookmarks,
  mode,
  openHighlightId,
  readerControls,
  onModeChange,
  onOpenHighlightEditor,
  onOpenHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
  onOpenBookmark,
  onDeleteBookmark,
  onVoiceStateChange,
}: SideboardProps) {
  const [deleteRequest, setDeleteRequest] =
    useState<ConfirmationRequest | null>(null);
  const addBoardItem = useCallback(
    (item: BoardItem) => {
      setItems((current) => [...current, item]);
      onModeChange("board");
    },
    [onModeChange, setItems],
  );
  const voiceContext = useMemo(
    () => ({
      bookId: book.id,
      title: book.title,
      page,
      visibleText,
      selectedText,
      focusedPassage: focusedPassage
        ? { page: focusedPassage.page, text: focusedPassage.text }
        : null,
      pointer,
      savedPassages: highlights
        .filter((highlight) => highlight.page === page)
        .map((highlight) => ({
          text: highlight.text,
          note: highlight.note,
        })),
    }),
    [
      book.id,
      book.title,
      page,
      visibleText,
      selectedText,
      focusedPassage,
      pointer,
      highlights,
    ],
  );
  const voice = useLorelineVoice(voiceContext, addBoardItem, readerControls);
  useEffect(() => {
    onVoiceStateChange(voice.state);
  }, [onVoiceStateChange, voice.state]);
  useEffect(
    () => () => {
      onVoiceStateChange("idle");
    },
    [onVoiceStateChange],
  );
  const voiceLabel =
    voice.state === "connecting"
      ? "Connecting…"
      : voice.state === "thinking"
        ? "Thinking…"
        : voice.state === "inspecting"
          ? "Looking at the page…"
          : voice.state === "speaking"
            ? "Loreline is speaking"
            : voice.state === "listening"
              ? "Listening"
              : voice.state === "error"
                ? "Reconnect voice"
                : "Start voice";
  const orderedHighlights = useMemo(
    () =>
      [...highlights].sort((left, right) => {
        const leftIsCurrent = left.page === page;
        const rightIsCurrent = right.page === page;
        if (leftIsCurrent !== rightIsCurrent) return leftIsCurrent ? -1 : 1;
        return left.page - right.page;
      }),
    [highlights, page],
  );
  const editingHighlight =
    orderedHighlights.find((highlight) => highlight.id === openHighlightId) ??
    null;

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-l bg-card">
      <div className="min-w-0 border-b bg-card px-4 pt-3.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Workspace</p>
            <p className="truncate text-[0.7rem] text-muted-foreground">
              {mode === "board"
                ? `Thinking board for page ${page}`
                : "Highlights, notes, and saved pages"}
            </p>
          </div>
          <RealtimeModelBadge className="mt-0.5" />
        </div>
        <div className="mt-3 flex gap-5" role="tablist" aria-label="Workspace">
          <button
            type="button"
            id="workspace-board-tab"
            role="tab"
            aria-selected={mode === "board"}
            aria-controls="workspace-board-panel"
            onClick={() => onModeChange("board")}
            className={cn(
              "flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              mode === "board"
                ? "border-coral text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Board
            {items.length > 0 && (
              <span className="text-[0.62rem] text-muted-foreground">
                {items.length}
              </span>
            )}
          </button>
          <button
            type="button"
            id="workspace-notes-tab"
            role="tab"
            aria-selected={mode === "notes"}
            aria-controls="workspace-notes-panel"
            onClick={() => onModeChange("notes")}
            className={cn(
              "flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              mode === "notes"
                ? "border-coral text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Notes
            {highlights.length + bookmarks.length > 0 && (
              <span className="text-[0.62rem] text-muted-foreground">
                {highlights.length + bookmarks.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 bg-paper/45">
        {mode === "board" ? (
          <div
            id="workspace-board-panel"
            role="tabpanel"
            aria-labelledby="workspace-board-tab"
            className="dot-grid min-h-full min-w-0 p-4"
          >
            {items.length === 0 ? (
              <div className="flex min-h-[28rem] flex-col items-center justify-center px-7 text-center">
                <span className="grid size-11 place-items-center rounded-xl border bg-card shadow-sm">
                  <Sparkles className="size-5 text-coral" />
                </span>
                <p className="mt-4 font-display text-2xl">Your thinking space</p>
                <p className="mt-2 max-w-64 text-xs leading-relaxed text-muted-foreground">
                  Ask Loreline to explain, map, or draw an idea. Visuals and
                  pinned thoughts get the whole board.
                </p>
              </div>
            ) : (
              <section>
                <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-muted-foreground">
                  On the board
                </p>
                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {items.map((item) => (
                      <motion.article
                        layout
                        key={item.id}
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        className={cn(
                          "group relative overflow-hidden rounded-2xl border",
                          item.kind === "note" && {
                            "bg-paper": item.tone === "paper",
                            "bg-sage-soft/55": item.tone === "sage",
                            "bg-sky-soft/55": item.tone === "sky",
                            "bg-coral-soft/55": item.tone === "coral",
                          },
                        )}
                      >
                        <button
                          aria-label="Remove board item"
                          onClick={() =>
                            setDeleteRequest({
                              title: "Remove this board item?",
                              description: `“${item.title}” will be removed from this workspace.`,
                              confirmLabel: "Remove item",
                              confirm: async () => {
                                setItems((current) =>
                                  current.filter(
                                    (candidate) => candidate.id !== item.id,
                                  ),
                                );
                              },
                            })
                          }
                          className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-full bg-background/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <X className="size-3.5" />
                        </button>
                        {item.kind === "image" ? (
                          <>
                            <Image
                              src={item.url}
                              alt={item.title}
                              width={1024}
                              height={1024}
                              unoptimized
                              className="aspect-square w-full object-cover"
                            />
                            <div className="p-3">
                              <p className="font-display text-lg font-semibold">
                                {item.title}
                              </p>
                              <p className="mt-1 line-clamp-2 text-[0.67rem] leading-relaxed text-muted-foreground">
                                {item.prompt}
                              </p>
                            </div>
                          </>
                        ) : (
                          <div className="p-4">
                            <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
                              Pinned thought
                            </p>
                            <h3 className="mt-3 font-display text-xl font-semibold">
                              {item.title}
                            </h3>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                              {item.body}
                            </p>
                          </div>
                        )}
                      </motion.article>
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}
          </div>
        ) : (
          <div
            id="workspace-notes-panel"
            role="tabpanel"
            aria-labelledby="workspace-notes-tab"
            className="dot-grid min-h-full min-w-0 space-y-4 p-3"
          >
            {bookmarks.length === 0 && orderedHighlights.length === 0 ? (
              <div className="flex min-h-[28rem] flex-col items-center justify-center px-7 text-center">
                <span className="grid size-11 place-items-center rounded-xl border bg-card shadow-sm">
                  <StickyNote className="size-5 text-coral" />
                </span>
                <p className="mt-4 font-display text-2xl">Nothing saved yet</p>
                <p className="mt-2 max-w-64 text-xs leading-relaxed text-muted-foreground">
                  Select a passage to highlight it or attach a note. It will
                  stay here without crowding the board.
                </p>
              </div>
            ) : (
              <>
                {bookmarks.length > 0 && (
                  <section>
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <p className="text-xs font-semibold text-foreground">
                        Saved pages
                      </p>
                      <span className="rounded-full bg-control px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
                        {bookmarks.length}
                      </span>
                    </div>
                    <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
                      {bookmarks.map((bookmark) => (
                        <span
                          key={bookmark.id}
                          className="inline-flex shrink-0 items-center rounded-full border bg-card shadow-sm"
                        >
                          <button
                            className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-1 text-xs font-medium"
                            onClick={() => onOpenBookmark(bookmark.page)}
                          >
                            <BookmarkCheck className="size-3.5 text-coral" />
                            Page {bookmark.page}
                          </button>
                          <button
                            aria-label={`Delete bookmark on page ${bookmark.page}`}
                            className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              setDeleteRequest({
                                title: "Remove this bookmark?",
                                description: `Page ${bookmark.page} will no longer be bookmarked.`,
                                confirmLabel: "Remove bookmark",
                                confirm: () => onDeleteBookmark(bookmark.id),
                              })
                            }
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {orderedHighlights.length > 0 && (
                  <section>
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <p className="text-xs font-semibold text-foreground">
                        Saved passages
                      </p>
                      <span className="rounded-full bg-control px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
                        {orderedHighlights.length}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {orderedHighlights.map((highlight) => (
                        <SavedHighlightRow
                          key={highlight.id}
                          highlight={highlight}
                          isCurrentPage={highlight.page === page}
                          onSelect={() =>
                            onOpenHighlightEditor(highlight.id)
                          }
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </ScrollArea>

      {editingHighlight ? (
        <SavedHighlightDialog
          key={editingHighlight.id}
          highlight={editingHighlight}
          onClose={() => onOpenHighlightEditor(null)}
          onOpen={() => onOpenHighlight(editingHighlight)}
          onUpdate={(note) => onUpdateHighlight(editingHighlight.id, note)}
          onDelete={() => {
            onOpenHighlightEditor(null);
            setDeleteRequest({
              title: editingHighlight.note
                ? "Remove this saved note?"
                : "Remove this highlight?",
              description: editingHighlight.note
                ? "The highlight and its attached note will be permanently removed."
                : "This saved highlight will be permanently removed.",
              confirmLabel: editingHighlight.note
                ? "Remove note"
                : "Remove highlight",
              confirm: () => onDeleteHighlight(editingHighlight.id),
            });
          }}
        />
      ) : null}

      <div className="space-y-2 border-t bg-background/75 px-3 py-2.5 backdrop-blur-xl">
        <button
          type="button"
          onClick={voice.connected ? voice.disconnect : voice.connect}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            voice.connected
              ? "bg-muted/45"
              : "hover:bg-muted/55",
          )}
        >
          <VoiceOrb state={voice.state} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{voiceLabel}</span>
            <span
              aria-live="polite"
              className={cn(
                "block truncate text-[0.66rem] text-muted-foreground",
                voice.activity?.status === "failed" && "text-destructive",
              )}
            >
              {voice.activity?.label ??
                (voice.connected
                  ? "Tap to end the voice session"
                  : "Ask, navigate, draw, or save notes")}
            </span>
          </span>
          {(voice.state === "listening" || voice.state === "speaking") && (
            <span className="mr-1 flex items-center gap-1" aria-hidden="true">
              {[0, 1, 2].map((bar) => (
                <motion.span
                  key={bar}
                  className={cn(
                    "w-0.5 rounded-full",
                    voice.state === "speaking" ? "bg-sky" : "bg-sage",
                  )}
                  animate={{
                    height: [5, voice.state === "speaking" ? 14 : 10, 7],
                  }}
                  transition={{
                    duration: 0.85,
                    delay: bar * 0.12,
                    repeat: Infinity,
                  }}
                />
              ))}
            </span>
          )}
        </button>

        {voice.error && (
          <p className="px-1 text-[0.68rem] text-destructive">{voice.error}</p>
        )}
      </div>
      <ConfirmationDialog
        request={deleteRequest}
        onDismiss={() => setDeleteRequest(null)}
      />
    </aside>
  );
}

export function ReaderWorkspace({ bookId }: { bookId: string }) {
  const bookQuery = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
  });
  if (bookQuery.isPending)
    return (
      <div className="grid h-screen place-items-center bg-paper">
        <LoaderCircle className="size-6 animate-spin text-coral" />
      </div>
    );
  if (bookQuery.isError || !bookQuery.data)
    return (
      <div className="grid h-screen place-items-center bg-paper p-5">
        <div className="max-w-md rounded-2xl border bg-card p-8 text-center">
          <p className="font-display text-3xl">This book could not open.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {toUserMessage(
              bookQuery.error,
              "Loreline couldn’t open this book. Please try again.",
            )}
          </p>
          <Button className="mt-5" render={<Link href="/library" />}>
            Back to library
          </Button>
        </div>
      </div>
    );
  return <ReaderReady bookId={bookId} book={bookQuery.data} />;
}

function ReaderReady({ bookId, book }: { bookId: string; book: ReaderBook }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(book.lastPage || 1);
  const [navigationRequest, setNavigationRequest] = useState({
    id: `initial:${book.id}:${book.lastPage || 1}`,
    page: book.lastPage || 1,
    behavior: "auto" as ScrollBehavior,
  });
  const [numPages, setNumPages] = useState(book.pageCount || 1);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [pageNavigatorOpen, setPageNavigatorOpen] = useState(true);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [sideboardOpen, setSideboardOpen] = useState(true);
  const [sideboardWidth, setSideboardWidth] = useState(368);
  const [resizingSideboard, setResizingSideboard] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [pointer, setPointer] = useState<PointerContext>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [activeFocus, setActiveFocus] = useState<ReaderFocus | null>(null);
  const [focusRequest, setFocusRequest] = useState<ReaderFocusRequest | null>(
    null,
  );
  const pendingFocusRef = useRef<{
    id: string;
    resolve: (selection: ReaderSelection | null) => void;
    timeout: number;
  } | null>(null);
  const [visibleText, setVisibleText] = useState("");
  const [boardItems, setBoardItems] = useState<BoardItem[]>([]);
  const [workspaceMode, setWorkspaceMode] =
    useState<WorkspaceMode>("board");
  const [openHighlightId, setOpenHighlightId] = useState<string | null>(null);
  const pageCaptureRef = useRef<ReaderControls["capturePageImage"]>(() => null);
  const setPageCapture = useCallback(
    (capture: ReaderControls["capturePageImage"] | null) => {
      pageCaptureRef.current = capture ?? (() => null);
    },
    [],
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const [viewportSize, setViewportSize] = useState({
    width: 760,
    height: 900,
  });
  const [noteSelection, setNoteSelection] = useState<ReaderSelection | null>(
    null,
  );
  const [noteDraft, setNoteDraft] = useState("");
  const [readerConfirmation, setReaderConfirmation] =
    useState<ConfirmationRequest | null>(null);

  const commitZoom = useCallback((value: number) => {
    const next = normalizeReaderZoom(value);
    zoomRef.current = next;
    setZoom(next);
    return next;
  }, []);

  const clearLiveZoom = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    node.style.removeProperty("--reader-live-page-width");
    node.style.removeProperty("--reader-live-page-height");
    node.style.removeProperty("--reader-live-render-scale");
  }, []);

  const applyLiveZoom = useCallback(
    (
      value: number,
      clientX: number,
      clientY: number,
      targetPage?: number,
    ) => {
      const node = viewportRef.current;
      if (!node) return null;
      const pageNode =
        (targetPage
          ? node.querySelector<HTMLElement>(
              `[data-reader-page="${targetPage}"]`,
            )
          : document
              .elementFromPoint(clientX, clientY)
              ?.closest<HTMLElement>(".pdf-reader-shell")) ??
        node.querySelector<HTMLElement>(".pdf-reader-shell");
      if (!pageNode) return null;
      const baseWidth = Number(pageNode.dataset.readerBaseWidth);
      const baseHeight = Number(pageNode.dataset.readerBaseHeight);
      const renderWidth = Number(pageNode.dataset.readerRenderWidth);
      if (!baseWidth || !baseHeight || !renderWidth) return null;

      const next = normalizeReaderZoom(value);
      const before = pageNode.getBoundingClientRect();
      const anchorX = Math.max(
        0,
        Math.min(1, (clientX - before.left) / Math.max(1, before.width)),
      );
      const anchorY = Math.max(
        0,
        Math.min(1, (clientY - before.top) / Math.max(1, before.height)),
      );
      const nextWidth = Math.max(1, Math.floor(baseWidth * next));
      const nextHeight = Math.max(1, Math.floor(baseHeight * next));
      zoomRef.current = next;
      node.style.setProperty("--reader-live-page-width", `${nextWidth}px`);
      node.style.setProperty("--reader-live-page-height", `${nextHeight}px`);
      node.style.setProperty(
        "--reader-live-render-scale",
        String(nextWidth / renderWidth),
      );
      if (zoomLabelRef.current)
        zoomLabelRef.current.textContent = `${Math.round(next * 100)}%`;

      const after = pageNode.getBoundingClientRect();
      node.scrollLeft += after.left + after.width * anchorX - clientX;
      node.scrollTop += after.top + after.height * anchorY - clientY;
      return next;
    },
    [],
  );

  const zoomFromControl = useCallback(
    (value: number) => {
      const node = viewportRef.current;
      if (!node) return;
      const viewportRect = node.getBoundingClientRect();
      const next = applyLiveZoom(
        value,
        viewportRect.left + viewportRect.width / 2,
        viewportRect.top + viewportRect.height / 2,
        page,
      );
      if (next === null) return;
      commitZoom(next);
      window.requestAnimationFrame(clearLiveZoom);
    },
    [applyLiveZoom, clearLiveZoom, commitZoom, page],
  );

  const resizeSideboard = useCallback((clientX: number) => {
    const maxWidth = Math.max(320, Math.min(720, window.innerWidth - 480));
    setSideboardWidth(
      Math.round(
        Math.min(maxWidth, Math.max(320, window.innerWidth - clientX)),
      ),
    );
  }, []);

  useEffect(() => {
    if (!resizingSideboard) return;
    const onPointerMove = (event: PointerEvent) =>
      resizeSideboard(event.clientX);
    const finish = () => setResizingSideboard(false);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [resizeSideboard, resizingSideboard]);

  const highlightsQuery = useQuery({
    queryKey: ["highlights", bookId],
    queryFn: () => getHighlights(bookId),
  });
  const bookmarksQuery = useQuery({
    queryKey: ["bookmarks", bookId],
    queryFn: () => getBookmarks(bookId),
  });
  const highlights = highlightsQuery.data ?? [];
  const bookmarks = useMemo(
    () => bookmarksQuery.data ?? [],
    [bookmarksQuery.data],
  );

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measureViewport = () => {
      const style = window.getComputedStyle(node);
      const horizontalPadding =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const verticalPadding =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      const next = {
        width: Math.max(1, Math.floor(node.clientWidth - horizontalPadding)),
        height: Math.max(1, Math.floor(node.clientHeight - verticalPadding)),
      };
      setViewportSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(measureViewport);
    observer.observe(node);
    measureViewport();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    let accumulatedDelta = 0;
    let zoomFrame: number | null = null;
    let settleTimeout: number | null = null;
    let clearFrame: number | null = null;
    let clientX = 0;
    let clientY = 0;

    const applyGestureZoom = () => {
      zoomFrame = null;
      const current = zoomRef.current;
      const next = normalizeReaderZoom(
        current * Math.exp(-accumulatedDelta * 0.002),
      );
      accumulatedDelta = 0;
      if (next === current) return;
      applyLiveZoom(next, clientX, clientY);

      if (settleTimeout !== null) window.clearTimeout(settleTimeout);
      settleTimeout = window.setTimeout(() => {
        settleTimeout = null;
        commitZoom(zoomRef.current);
        clearFrame = window.requestAnimationFrame(() => {
          clearLiveZoom();
          clearFrame = null;
        });
      }, 140);
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const deltaMultiplier =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? node.clientHeight
            : 1;
      accumulatedDelta += event.deltaY * deltaMultiplier;
      clientX = event.clientX;
      clientY = event.clientY;
      if (clearFrame !== null) {
        window.cancelAnimationFrame(clearFrame);
        clearFrame = null;
      }
      if (zoomFrame === null)
        zoomFrame = window.requestAnimationFrame(applyGestureZoom);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      if (zoomFrame !== null) window.cancelAnimationFrame(zoomFrame);
      if (settleTimeout !== null) window.clearTimeout(settleTimeout);
      if (clearFrame !== null) window.cancelAnimationFrame(clearFrame);
      clearLiveZoom();
    };
  }, [applyLiveZoom, clearLiveZoom, commitZoom]);

  const progressMutation = useMutation({
    mutationFn: async (nextPage: number) => {
      const data = await apiJson<BookProgressResponse>(`/api/books/${bookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: nextPage,
          progress: Math.min(1, nextPage / Math.max(numPages, 1)),
        }),
      });
      return { page: nextPage, progress: data.book.progress };
    },
    onSuccess: ({ page: savedPage, progress }) => {
      queryClient.setQueryData<ReaderBook>(["book", bookId], (current) =>
        current ? { ...current, lastPage: savedPage, progress } : current,
      );
      queryClient.setQueriesData<InfiniteData<BooksPageResponse>>(
        { queryKey: ["books"] },
        (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((group) => ({
                  ...group,
                  books: group.books.map((item) =>
                    item.id === bookId
                      ? { ...item, lastPage: savedPage, progress }
                      : item,
                  ),
                })),
              }
            : current,
      );
    },
  });
  useEffect(() => {
    const timeout = window.setTimeout(() => progressMutation.mutate(page), 800);
    return () => window.clearTimeout(timeout);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const createHighlightMutation = useMutation({
    mutationFn: async (input: ReaderSelection & { note: string | null }) => {
      const data = await apiJson<HighlightResponse>(
        `/api/books/${bookId}/highlights`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return data.highlight;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Highlight[]>(
        ["highlights", bookId],
        (current = []) => [...current, created],
      );
    },
  });
  const updateHighlightMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string | null }) => {
      const data = await apiJson<HighlightResponse>(
        `/api/books/${bookId}/highlights/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );
      return data.highlight;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Highlight[]>(
        ["highlights", bookId],
        (current = []) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
      );
    },
  });
  const deleteHighlightMutation = useMutation({
    mutationFn: async (highlightId: string) => {
      await apiJson<Record<string, never>>(
        `/api/books/${bookId}/highlights/${highlightId}`,
        { method: "DELETE" },
      );
      return highlightId;
    },
    onSuccess: (deletedId) => {
      queryClient.setQueryData<Highlight[]>(
        ["highlights", bookId],
        (current = []) => current.filter((item) => item.id !== deletedId),
      );
      setActiveFocus((current) => (current?.id === deletedId ? null : current));
    },
  });
  const createBookmarkMutation = useMutation({
    mutationFn: async (bookmarkPage: number) => {
      const data = await apiJson<BookmarkResponse>(
        `/api/books/${bookId}/bookmarks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page: bookmarkPage }),
        },
      );
      return data.bookmark;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<SavedBookmark[]>(
        ["bookmarks", bookId],
        (current = []) =>
          current.some((item) => item.id === created.id)
            ? current
            : [...current, created].sort(
                (left, right) => left.page - right.page,
              ),
      );
    },
  });
  const deleteBookmarkMutation = useMutation({
    mutationFn: async (bookmarkId: string) => {
      await apiJson<Record<string, never>>(
        `/api/books/${bookId}/bookmarks/${bookmarkId}`,
        { method: "DELETE" },
      );
      return bookmarkId;
    },
    onSuccess: (deletedId) =>
      queryClient.setQueryData<SavedBookmark[]>(
        ["bookmarks", bookId],
        (current = []) => current.filter((item) => item.id !== deletedId),
      ),
  });

  const cancelPendingFocus = useCallback(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pending.resolve(null);
    pendingFocusRef.current = null;
  }, []);

  const go = useCallback(
    (next: number) => {
      cancelPendingFocus();
      const targetPage = Math.min(numPages, Math.max(1, next));
      setPage(targetPage);
      setNavigationRequest({
        id: crypto.randomUUID(),
        page: targetPage,
        behavior: "auto",
      });
      setSelection(null);
      setActiveFocus(null);
      setFocusRequest(null);
      setPointer(null);
      setVisibleText("");
      window.getSelection()?.removeAllRanges();
    },
    [cancelPendingFocus, numPages],
  );

  const updateCurrentPageFromScroll = useCallback((nextPage: number) => {
    setPage((current) => (current === nextPage ? current : nextPage));
    setPointer(null);
  }, []);

  const focusPassage = useCallback(
    ({ page: targetPage, text }: { page: number; text: string }) => {
      if (targetPage < 1 || targetPage > numPages || !text.trim())
        return Promise.resolve(null);
      cancelPendingFocus();
      const id = crypto.randomUUID();
      if (targetPage !== page) go(targetPage);
      setSelection(null);
      setFocusRequest({ id, page: targetPage, text: text.trim() });
      return new Promise<ReaderSelection | null>((resolve) => {
        const timeout = window.setTimeout(() => {
          if (pendingFocusRef.current?.id !== id) return;
          pendingFocusRef.current = null;
          setFocusRequest((current) => (current?.id === id ? null : current));
          resolve(null);
        }, 6_000);
        pendingFocusRef.current = { id, resolve, timeout };
      });
    },
    [cancelPendingFocus, go, numPages, page],
  );

  const clearFocus = useCallback(() => {
    cancelPendingFocus();
    setFocusRequest(null);
    setActiveFocus(null);
  }, [cancelPendingFocus]);

  const savePassageNote = useCallback(
    async ({
      page: targetPage,
      text,
      note,
    }: {
      page: number;
      text: string;
      note: string;
    }) => {
      const located = await focusPassage({ page: targetPage, text });
      if (!located) return false;
      const created = await createHighlightMutation.mutateAsync({
        ...located,
        note,
      });
      setSideboardOpen(true);
      setWorkspaceMode("notes");
      setOpenHighlightId(created.id);
      return true;
    },
    [createHighlightMutation, focusPassage],
  );

  const bookmarkPage = useCallback(
    async (targetPage: number) => {
      if (targetPage < 1 || targetPage > numPages) return "invalid" as const;
      if (bookmarks.some((item) => item.page === targetPage))
        return "existing" as const;
      await createBookmarkMutation.mutateAsync(targetPage);
      return "created" as const;
    },
    [bookmarks, createBookmarkMutation, numPages],
  );

  const readerControls = useMemo<ReaderControls>(
    () => ({
      clearFocus,
      focusPassage,
      savePassageNote,
      capturePageImage: (focus) => pageCaptureRef.current(focus),
      bookmarkPage,
      goToPage: (nextPage) => {
        if (nextPage < 1 || nextPage > numPages) return false;
        go(nextPage);
        return true;
      },
    }),
    [bookmarkPage, clearFocus, focusPassage, go, numPages, savePassageNote],
  );

  useEffect(() => cancelPendingFocus, [cancelPendingFocus]);

  const resolveFocus = useCallback(
    (request: ReaderFocusRequest, rects: ReaderSelection["rects"]) => {
      const pending = pendingFocusRef.current;
      if (!pending || pending.id !== request.id) return;
      window.clearTimeout(pending.timeout);
      const located = rects.length
        ? { page: request.page, text: request.text, rects }
        : null;
      if (located) setActiveFocus({ id: request.id, ...located });
      pending.resolve(located);
      pendingFocusRef.current = null;
      setFocusRequest((current) =>
        current?.id === request.id ? null : current,
      );
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const saveSelection = useCallback(
    async (selected: ReaderSelection, note: string | null) => {
      const created = await createHighlightMutation.mutateAsync({
        ...selected,
        note,
      });
      setSideboardOpen(true);
      setWorkspaceMode("notes");
      setOpenHighlightId(created.id);
      clearSelection();
      setNoteSelection(null);
      setNoteDraft("");
    },
    [clearSelection, createHighlightMutation],
  );

  const currentBookmark = bookmarks.find((item) => item.page === page);

  const sideboard = (
    <Sideboard
      book={book}
      page={page}
      visibleText={visibleText}
      selectedText={selection?.text ?? ""}
      focusedPassage={activeFocus}
      pointer={pointer}
      items={boardItems}
      setItems={setBoardItems}
      highlights={highlights}
      bookmarks={bookmarks}
      mode={workspaceMode}
      openHighlightId={openHighlightId}
      readerControls={readerControls}
      onModeChange={setWorkspaceMode}
      onOpenHighlightEditor={setOpenHighlightId}
      onOpenHighlight={(highlight) => {
        go(highlight.page);
        setActiveFocus({ ...highlight, id: highlight.id });
      }}
      onUpdateHighlight={async (highlightId, note) => {
        await updateHighlightMutation.mutateAsync({ id: highlightId, note });
      }}
      onDeleteHighlight={async (highlightId) => {
        await deleteHighlightMutation.mutateAsync(highlightId);
      }}
      onOpenBookmark={go}
      onDeleteBookmark={async (bookmarkId) => {
        await deleteBookmarkMutation.mutateAsync(bookmarkId);
      }}
      onVoiceStateChange={setVoiceState}
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper-deep/55">
      <header className="z-30 flex h-14 shrink-0 items-center justify-between border-b bg-background/94 px-3 backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={pageNavigatorOpen ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label={
                    pageNavigatorOpen
                      ? "Close page navigator"
                      : "Open page navigator"
                  }
                  onClick={() =>
                    setPageNavigatorOpen((current) => !current)
                  }
                />
              }
            >
              {pageNavigatorOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </TooltipTrigger>
            <TooltipContent>
              {pageNavigatorOpen ? "Close page navigator" : "Open pages"}
            </TooltipContent>
          </Tooltip>
          <Logo compact />
          <span className="h-5 w-px bg-border" />
          <Link href="/library" className="min-w-0">
            <p className="truncate text-sm font-semibold">{book.title}</p>
            <p className="truncate text-[0.66rem] text-muted-foreground">
              {book.author || "Your library"}
            </p>
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            onClick={() => go(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft />
          </Button>
          <div className="flex h-8 items-center rounded-lg border bg-card px-2 text-xs">
            <Input
              aria-label="Current page"
              value={page}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) go(next);
              }}
              className="h-6 w-9 border-0 bg-transparent p-0 text-center text-xs shadow-none focus-visible:ring-0"
            />
            <span className="text-muted-foreground">/ {numPages}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            onClick={() => go(page + 1)}
            disabled={page >= numPages}
          >
            <ChevronRight />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={currentBookmark ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label={
                    currentBookmark
                      ? `Remove bookmark from page ${page}`
                      : `Bookmark page ${page}`
                  }
                  disabled={
                    createBookmarkMutation.isPending ||
                    deleteBookmarkMutation.isPending
                  }
                  onClick={() => {
                    if (!currentBookmark) {
                      void bookmarkPage(page);
                      return;
                    }
                    const bookmarkId = currentBookmark.id;
                    setReaderConfirmation({
                      title: "Remove this bookmark?",
                      description: `Page ${page} will no longer be bookmarked.`,
                      confirmLabel: "Remove bookmark",
                      confirm: async () => {
                        await deleteBookmarkMutation.mutateAsync(bookmarkId);
                      },
                    });
                  }}
                />
              }
            >
              {currentBookmark ? <BookmarkCheck /> : <Bookmark />}
            </TooltipTrigger>
            <TooltipContent>
              {currentBookmark ? "Remove bookmark" : "Bookmark this page"}
            </TooltipContent>
          </Tooltip>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => zoomFromControl(zoomRef.current - READER_ZOOM_STEP)}
            disabled={zoom <= MIN_READER_ZOOM}
          >
            <Minus />
          </Button>
          <span
            ref={zoomLabelRef}
            className="w-10 text-center font-mono text-[0.64rem] text-muted-foreground"
          >
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => zoomFromControl(zoomRef.current + READER_ZOOM_STEP)}
            disabled={zoom >= MAX_READER_ZOOM}
          >
            <Plus />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={sideboardOpen ? "secondary" : "ghost"}
                  size="icon"
                  aria-label={
                    sideboardOpen ? "Close sideboard" : "Open sideboard"
                  }
                  onClick={() => setSideboardOpen((value) => !value)}
                />
              }
            >
              {sideboardOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </TooltipTrigger>
            <TooltipContent>
              {sideboardOpen ? "Close sideboard" : "Open sideboard"}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {pageNavigatorOpen ? (
          <PageNavigator
            document={pdfDocument}
            page={page}
            totalPages={numPages}
            onSelect={go}
            onClose={() => setPageNavigatorOpen(false)}
          />
        ) : null}
        <div
          className={cn(
            "grid min-h-0 min-w-0 flex-1",
            sideboardOpen
              ? "xl:grid-cols-[minmax(0,1fr)_var(--workspace-width)]"
              : "grid-cols-1",
          )}
          style={
            { "--workspace-width": `${sideboardWidth}px` } as CSSProperties
          }
        >
        <div className="relative min-h-0 overflow-hidden">
          <div
            ref={viewportRef}
            data-reader-viewport="true"
            className="scrollbar-none absolute inset-0 overflow-auto p-4 sm:p-6"
          >
            <PdfReader
              fileUrl={`/api/books/${bookId}/file`}
              currentPage={page}
              viewport={viewportSize}
              zoom={zoom}
              voiceState={voiceState}
              highlights={highlights}
              selection={selection}
              activeFocus={activeFocus}
              focusRequest={focusRequest}
              navigationRequest={navigationRequest}
              onDocumentReady={(document) => {
                setPdfDocument(document);
                setNumPages(document.numPages);
                if (page > document.numPages) go(document.numPages);
              }}
              onCurrentPageChange={updateCurrentPageFromScroll}
              onVisibleTextChange={setVisibleText}
              onPageCaptureReady={setPageCapture}
              onPointerChange={setPointer}
              onSelectionChange={(nextSelection) => {
                setSelection(nextSelection);
                if (nextSelection) setActiveFocus(null);
              }}
              onFocusResolved={resolveFocus}
            />
          </div>
          {selection && (
            <div className="absolute inset-x-3 bottom-4 z-30 mx-auto flex max-w-xl items-center gap-2 rounded-2xl border bg-background/95 p-2 pl-3 shadow-float backdrop-blur-xl">
              <p className="min-w-0 flex-1 text-xs font-medium text-ink-soft">
                {selection.text.split(/\s+/).length} words selected
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={createHighlightMutation.isPending}
                onClick={() => void saveSelection(selection, null)}
              >
                <Highlighter />
                Highlight
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setSideboardOpen(true);
                  setWorkspaceMode("notes");
                  setNoteSelection(selection);
                  setNoteDraft("");
                }}
              >
                <StickyNote />
                Add note
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear text selection"
                onClick={clearSelection}
              >
                <X />
              </Button>
            </div>
          )}
        </div>
        {sideboardOpen && (
          <>
            <button
              aria-label="Close sideboard"
              className="fixed inset-x-0 bottom-0 top-14 z-40 bg-foreground/20 backdrop-blur-sm xl:hidden"
              onClick={() => setSideboardOpen(false)}
            />
            <div className="fixed bottom-0 right-0 top-14 z-50 w-[min(92vw,23rem)] overflow-hidden xl:relative xl:inset-auto xl:z-auto xl:h-full xl:w-auto xl:min-h-0">
              <div
                role="separator"
                aria-label="Resize workspace"
                aria-orientation="vertical"
                aria-valuemin={320}
                aria-valuemax={720}
                aria-valuenow={sideboardWidth}
                tabIndex={0}
                onPointerDown={(event) => {
                  event.preventDefault();
                  setResizingSideboard(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    setSideboardWidth((width) => Math.min(720, width + 16));
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    setSideboardWidth((width) => Math.max(320, width - 16));
                  }
                }}
                className="group absolute inset-y-0 left-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none place-items-center outline-none xl:grid"
              >
                <span
                  className={cn(
                    "h-14 w-1 rounded-full bg-border transition-colors group-hover:bg-coral group-focus-visible:bg-coral",
                    resizingSideboard && "bg-coral",
                  )}
                />
              </div>
              {sideboard}
            </div>
          </>
        )}
        </div>
      </div>
      <Dialog
        open={Boolean(noteSelection)}
        onOpenChange={(open) => {
          if (!open) {
            setNoteSelection(null);
            setNoteDraft("");
          }
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              Note this passage
            </DialogTitle>
            <DialogDescription className="line-clamp-3 leading-relaxed">
              “{noteSelection?.text}”
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            value={noteDraft}
            onChange={(event) =>
              setNoteDraft(event.target.value.slice(0, 4000))
            }
            placeholder="What do you want to remember?"
            className="min-h-32 resize-none"
          />
          <DialogFooter>
            <Button
              disabled={
                !noteSelection ||
                !noteDraft.trim() ||
                createHighlightMutation.isPending
              }
              onClick={() => {
                if (noteSelection)
                  void saveSelection(noteSelection, noteDraft.trim());
              }}
            >
              {createHighlightMutation.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <StickyNote />
              )}
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        request={readerConfirmation}
        onDismiss={() => setReaderConfirmation(null)}
      />
    </div>
  );
}
