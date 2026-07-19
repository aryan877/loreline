"use client";

import {
  type InfiniteData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  LoaderCircle,
  Mic2,
  Minus,
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

function VoiceOrb({ state }: { state: VoiceState }) {
  const active =
    state === "listening" || state === "inspecting" || state === "speaking";
  return (
    <span className="relative grid size-10 place-items-center rounded-full bg-coral text-primary-foreground">
      {active && (
        <motion.span
          className="absolute inset-0 rounded-full border border-coral"
          animate={{ scale: [1, 1.55], opacity: [0.7, 0] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        />
      )}
      {state === "connecting" ? (
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

function SavedHighlightCard({
  highlight,
  isCurrentPage,
  onOpen,
  onUpdate,
  onDelete,
}: {
  highlight: Highlight;
  isCurrentPage: boolean;
  onOpen: () => void;
  onUpdate: (note: string | null) => Promise<void>;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(highlight.note ?? "");

  const changed = note.trim() !== (highlight.note ?? "");
  return (
    <article className="grid h-[24rem] w-[min(32rem,calc(var(--workspace-width)-3.5rem))] max-w-[calc(100vw-5rem)] shrink-0 snap-start grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-start gap-3 border-b px-3.5 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-reader-highlight/60 text-[0.64rem] font-semibold text-foreground">
          {highlight.page}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            {isCurrentPage ? "This page" : `Page ${highlight.page}`}
          </span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-foreground">
            {highlight.note ? "Note and highlight" : "Saved highlight"}
          </span>
        </span>
      </div>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_7rem] gap-3 bg-paper/55 p-3.5">
        <p className="scrollbar-none min-h-0 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-xs leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
          “{highlight.text}”
        </p>
        <Textarea
          aria-label={`Note for highlight on page ${highlight.page}`}
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 4000))}
          placeholder="Add a note to this passage…"
          rows={4}
          className="field-sizing-fixed h-28 min-h-0 max-h-28 w-full max-w-full resize-none overflow-y-auto bg-background text-xs"
        />
      </div>
      <div className="grid grid-cols-2 items-center gap-1.5 border-t bg-card p-2.5">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete highlight on page ${highlight.page}`}
          onClick={onDelete}
        >
          <Trash2 />
          Remove
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-w-0"
          onClick={onOpen}
        >
          Show on page
        </Button>
        <Button
          size="sm"
          className="col-span-2 w-full"
          disabled={!changed}
          onClick={() => void onUpdate(note.trim() || null)}
        >
          Save note
        </Button>
      </div>
    </article>
  );
}

type SideboardProps = {
  book: ReaderBook;
  page: number;
  visibleText: string;
  selectedText: string;
  pointer: PointerContext;
  items: BoardItem[];
  setItems: React.Dispatch<React.SetStateAction<BoardItem[]>>;
  highlights: Highlight[];
  bookmarks: SavedBookmark[];
  readerControls: ReaderControls;
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
  pointer,
  items,
  setItems,
  highlights,
  bookmarks,
  readerControls,
  onOpenHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
  onOpenBookmark,
  onDeleteBookmark,
  onVoiceStateChange,
}: SideboardProps) {
  const [notesOpen, setNotesOpen] = useState(true);
  const [deleteRequest, setDeleteRequest] =
    useState<ConfirmationRequest | null>(null);
  const notesRailRef = useRef<HTMLDivElement>(null);
  const addBoardItem = useCallback(
    (item: BoardItem) => setItems((current) => [...current, item]),
    [setItems],
  );
  const voiceContext = useMemo(
    () => ({
      bookId: book.id,
      title: book.title,
      page,
      visibleText,
      selectedText,
      pointer,
      savedPassages: highlights
        .filter((highlight) => highlight.page === page)
        .map((highlight) => ({
          text: highlight.text,
          note: highlight.note,
        })),
    }),
    [book.id, book.title, page, visibleText, selectedText, pointer, highlights],
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
      : voice.state === "inspecting"
        ? "Looking at the page…"
        : voice.state === "speaking"
          ? "Loreline is speaking"
          : voice.state === "listening"
            ? "Listening"
            : "Start voice";
  const hasWorkspaceContent =
    items.length > 0 || highlights.length > 0 || bookmarks.length > 0;
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

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-l bg-card">
      <div className="min-w-0 border-b px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Workspace</p>
          <p className="truncate text-[0.7rem] text-muted-foreground">
            Board, notes, and page {page}
          </p>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 bg-paper/45">
        <div className="dot-grid min-h-full min-w-0 space-y-6 p-4">
          {!hasWorkspaceContent && (
            <div className="dot-grid flex min-h-64 flex-col items-center justify-center rounded-2xl border bg-paper px-6 text-center">
              <span className="grid size-11 place-items-center rounded-xl bg-card shadow-sm">
                <Sparkles className="size-5 text-coral" />
              </span>
              <p className="mt-4 font-display text-2xl">Your thinking space</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Speak to Loreline to explain, map, draw, or save an idea. The
                results stay here beside the page.
              </p>
            </div>
          )}

          {items.length > 0 && (
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

          {bookmarks.length > 0 && (
            <section>
              <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-muted-foreground">
                Bookmarks
              </p>
              <div className="flex flex-wrap gap-2">
                {bookmarks.map((bookmark) => (
                  <span
                    key={bookmark.id}
                    className="inline-flex items-center rounded-full border bg-card shadow-sm"
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
            <section className="overflow-hidden rounded-2xl border bg-card/90 shadow-sm">
              <button
                type="button"
                aria-expanded={notesOpen}
                aria-controls="saved-notes-panel"
                onClick={() => setNotesOpen((open) => !open)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-reader-highlight/55">
                  <StickyNote className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    Saved notes
                  </span>
                  <span className="block text-[0.66rem] text-muted-foreground">
                    {orderedHighlights.length} saved passage
                    {orderedHighlights.length === 1 ? "" : "s"}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    notesOpen && "rotate-180",
                  )}
                />
              </button>
              {notesOpen && (
                <div id="saved-notes-panel" className="border-t bg-paper/55">
                  <div className="flex items-center justify-between gap-3 px-3.5 pt-3">
                    <p className="text-[0.68rem] text-muted-foreground">
                      Browse saved notes
                    </p>
                    {orderedHighlights.length > 1 && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Previous saved note"
                          onClick={() =>
                            notesRailRef.current?.scrollBy({
                              left: -304,
                              behavior: "smooth",
                            })
                          }
                        >
                          <ChevronLeft />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Next saved note"
                          onClick={() =>
                            notesRailRef.current?.scrollBy({
                              left: 304,
                              behavior: "smooth",
                            })
                          }
                        >
                          <ChevronRight />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div
                    ref={notesRailRef}
                    className="scrollbar-none flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-3.5 pb-3.5 pt-2 scroll-smooth touch-pan-x"
                  >
                    {orderedHighlights.map((highlight) => (
                      <SavedHighlightCard
                        key={highlight.id}
                        highlight={highlight}
                        isCurrentPage={highlight.page === page}
                        onOpen={() => onOpenHighlight(highlight)}
                        onUpdate={(note) =>
                          onUpdateHighlight(highlight.id, note)
                        }
                        onDelete={() =>
                          setDeleteRequest({
                            title: highlight.note
                              ? "Remove this saved note?"
                              : "Remove this highlight?",
                            description: highlight.note
                              ? "The highlight and its attached note will be permanently removed."
                              : "This saved highlight will be permanently removed.",
                            confirmLabel: highlight.note
                              ? "Remove note"
                              : "Remove highlight",
                            confirm: () => onDeleteHighlight(highlight.id),
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </ScrollArea>

      <div className="space-y-2.5 border-t bg-background/75 p-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={voice.connected ? voice.disconnect : voice.connect}
          className={cn(
            "flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            voice.connected
              ? "border-coral/45 bg-coral-soft/50"
              : "bg-card hover:bg-muted/55",
          )}
        >
          <VoiceOrb state={voice.state} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{voiceLabel}</span>
            <span className="block truncate text-[0.66rem] text-muted-foreground">
              {voice.connected
                ? "Tap to end the voice session"
                : "Ask, navigate, draw, or save notes"}
            </span>
          </span>
          {voice.connected && (
            <span className="mr-1 flex items-center gap-1" aria-hidden="true">
              {[0, 1, 2].map((bar) => (
                <motion.span
                  key={bar}
                  className="w-0.5 rounded-full bg-coral"
                  animate={{ height: [5, 14, 7] }}
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
  const [numPages, setNumPages] = useState(book.pageCount || 1);
  const [zoom, setZoom] = useState(1);
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
  const pageCaptureRef = useRef<ReaderControls["capturePageImage"]>(() => null);
  const setPageCapture = useCallback(
    (capture: ReaderControls["capturePageImage"] | null) => {
      pageCaptureRef.current = capture ?? (() => null);
    },
    [],
  );
  const viewportRef = useRef<HTMLDivElement>(null);
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
  const bookmarks = bookmarksQuery.data ?? [];

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
      setPage(Math.min(numPages, Math.max(1, next)));
      setSelection(null);
      setActiveFocus(null);
      setFocusRequest(null);
      setPointer(null);
      setVisibleText("");
    },
    [cancelPendingFocus, numPages],
  );

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
      await createHighlightMutation.mutateAsync({ ...located, note });
      return true;
    },
    [createHighlightMutation, focusPassage],
  );

  const readerControls = useMemo<ReaderControls>(
    () => ({
      focusPassage,
      savePassageNote,
      capturePageImage: (focus) => pageCaptureRef.current(focus),
      goToPage: (nextPage) => {
        if (nextPage < 1 || nextPage > numPages) return false;
        go(nextPage);
        return true;
      },
    }),
    [focusPassage, go, numPages, savePassageNote],
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
      await createHighlightMutation.mutateAsync({ ...selected, note });
      clearSelection();
      setNoteSelection(null);
      setNoteDraft("");
    },
    [clearSelection, createHighlightMutation],
  );

  const currentBookmark = bookmarks.find((item) => item.page === page);
  const pageHighlights = highlights.filter((item) => item.page === page);

  const sideboard = (
    <Sideboard
      book={book}
      page={page}
      visibleText={visibleText}
      selectedText={selection?.text ?? ""}
      pointer={pointer}
      items={boardItems}
      setItems={setBoardItems}
      highlights={highlights}
      bookmarks={bookmarks}
      readerControls={readerControls}
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
                      createBookmarkMutation.mutate(page);
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
            onClick={() =>
              setZoom((value) =>
                Math.max(0.5, Number((value - 0.05).toFixed(2))),
              )
            }
            disabled={zoom <= 0.5}
          >
            <Minus />
          </Button>
          <span className="w-10 text-center font-mono text-[0.64rem] text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() =>
              setZoom((value) => Math.min(4, Number((value + 0.05).toFixed(2))))
            }
            disabled={zoom >= 4}
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

      <div
        className={cn(
          "grid min-h-0 flex-1",
          sideboardOpen
            ? "xl:grid-cols-[minmax(0,1fr)_var(--workspace-width)]"
            : "grid-cols-1",
        )}
        style={{ "--workspace-width": `${sideboardWidth}px` } as CSSProperties}
      >
        <div className="relative min-h-0 overflow-hidden">
          <div
            ref={viewportRef}
            data-reader-viewport="true"
            className="scrollbar-none absolute inset-0 overflow-auto p-4 sm:p-6"
          >
            <PdfReader
              fileUrl={`/api/books/${bookId}/file`}
              page={page}
              viewport={viewportSize}
              zoom={zoom}
              voiceState={voiceState}
              highlights={pageHighlights}
              selection={selection}
              activeFocus={activeFocus}
              focusRequest={focusRequest}
              onDocumentReady={(pages) => {
                setNumPages(pages);
                if (page > pages) setPage(pages);
              }}
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
