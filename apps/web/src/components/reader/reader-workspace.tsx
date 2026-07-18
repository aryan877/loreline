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
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  Mic2,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ChatResponse,
  IllustrationResponse,
} from "@loreline/contracts/ai";
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
  ChatMessage,
  ReaderControls,
  ReaderFocus,
  ReaderFocusRequest,
  ReaderSelection,
} from "@loreline/contracts/reader";

const PdfReader = dynamic(
  () => import("@/components/reader/pdf-reader"),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[32rem] w-full place-items-center bg-reader-paper">
        <LoaderCircle className="size-5 animate-spin text-coral" />
      </div>
    ),
  },
);

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

function VoiceOrb({ state }: { state: string }) {
  const active = state === "listening" || state === "speaking";
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
      ) : state === "speaking" ? (
        <Volume2 className="size-4" />
      ) : (
        <Mic2 className="size-4" />
      )}
    </span>
  );
}

function SavedHighlightCard({
  highlight,
  onOpen,
  onUpdate,
  onDelete,
}: {
  highlight: Highlight;
  onOpen: () => void;
  onUpdate: (note: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [note, setNote] = useState(highlight.note ?? "");

  const changed = note.trim() !== (highlight.note ?? "");
  return (
    <article className="rounded-2xl border bg-card p-3 shadow-sm">
      <button className="w-full text-left" onClick={onOpen}>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-coral">
          Page {highlight.page}
        </span>
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink-soft">
          “{highlight.text}”
        </p>
      </button>
      <Textarea
        aria-label={`Note for highlight on page ${highlight.page}`}
        value={note}
        onChange={(event) => setNote(event.target.value.slice(0, 4000))}
        placeholder="Add a note to this passage…"
        className="mt-3 min-h-20 resize-none bg-background text-xs"
      />
      <div className="mt-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete highlight on page ${highlight.page}`}
          onClick={() => void onDelete()}
        >
          <Trash2 />
        </Button>
        <Button
          size="sm"
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
  screenshot: string | null;
  items: BoardItem[];
  setItems: React.Dispatch<React.SetStateAction<BoardItem[]>>;
  highlights: Highlight[];
  bookmarks: SavedBookmark[];
  readerControls: ReaderControls;
  onOpenHighlight: (highlight: Highlight) => void;
  onUpdateHighlight: (highlightId: string, note: string | null) => Promise<void>;
  onDeleteHighlight: (highlightId: string) => Promise<void>;
  onOpenBookmark: (page: number) => void;
  onDeleteBookmark: (bookmarkId: string) => Promise<void>;
};

function Sideboard({
  book,
  page,
  visibleText,
  selectedText,
  pointer,
  screenshot,
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
}: SideboardProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I’m with you on this page. Point at a line, select a phrase, or ask me anything.",
      createdAt: 0,
    },
  ]);
  const [conversationId, setConversationId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState("talk");
  const [readerMode, setReaderMode] = useState(false);
  const addBoardItem = useCallback(
    (item: BoardItem) => {
      setItems((current) => [...current, item]);
      setTab("board");
    },
    [setItems],
  );
  const addTranscript = useCallback(
    (role: "user" | "assistant", content: string) =>
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role, content, createdAt: Date.now() },
      ]),
    [],
  );
  const voiceContext = useMemo(
    () => ({
      bookId: book.id,
      title: book.title,
      page,
      visibleText,
      selectedText,
      pointer,
      screenshot,
      readerMode,
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
      pointer,
      screenshot,
      readerMode,
      highlights,
    ],
  );
  const voice = useLorelineVoice(
    voiceContext,
    addBoardItem,
    addTranscript,
    readerControls,
  );

  const chat = useMutation({
    mutationFn: async (message: string) => {
      return apiJson<ChatResponse>("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: book.id,
          conversationId,
          message,
          page,
          visibleText,
          pointer,
          screenshot,
        }),
      });
    },
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setMessages((current) => [
        ...current,
        {
          id: data.messageId,
          role: "assistant",
          content: data.answer,
          createdAt: Date.now(),
        },
      ]);
    },
  });
  const visualize = useMutation({
    mutationFn: async () => {
      const prompt = selectedText
        ? `Help me visualize this selected passage: ${selectedText}`
        : `Create a visual explanation for the central idea on this page.`;
      const data = await apiJson<IllustrationResponse>("/api/illustrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id, page, prompt, visibleText }),
      });
      return { ...data, prompt };
    },
    onSuccess: (data) =>
      addBoardItem({
        id: data.id,
        kind: "image",
        title: selectedText ? "Selected passage" : `Page ${page}`,
        url: data.dataUrl,
        prompt: data.prompt,
        createdAt: Date.now(),
      }),
  });

  function send() {
    const message = draft.trim();
    if (!message || chat.isPending) return;
    setDraft("");
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        createdAt: Date.now(),
      },
    ]);
    chat.mutate(message);
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-l bg-card">
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Reading companion</p>
            <p className="text-[0.7rem] text-muted-foreground">
              Page {page} · page-first context
            </p>
          </div>
          <TabsList className="h-8">
            <TabsTrigger value="talk">
              <MessageCircle />
              Talk
            </TabsTrigger>
            <TabsTrigger value="board">
              <Sparkles />
              Board{" "}
              {items.length ? (
                <span className="ml-0.5 text-[0.62rem]">{items.length}</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="notes">
              <StickyNote />
              Notes{" "}
              {highlights.length ? (
                <span className="ml-0.5 text-[0.62rem]">
                  {highlights.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="talk" className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4">
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "max-w-[92%] rounded-2xl px-3.5 py-3 text-sm leading-relaxed",
                    message.role === "user"
                      ? "ml-auto rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-muted text-ink-soft",
                  )}
                >
                  {message.content}
                </motion.div>
              ))}
              {chat.isPending && (
                <div className="flex max-w-[80%] items-center gap-2 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-3 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Looking closely at the page…
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="border-t p-3">
            {(selectedText || pointer?.text) && (
              <div className="mb-2 flex items-start gap-2 rounded-xl bg-coral-soft/55 px-3 py-2 text-[0.68rem] leading-relaxed text-ink-soft">
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-coral" />
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">
                    {selectedText ? "Selected passage" : "Pointing at"}
                  </p>
                  <p className="scrollbar-none mt-0.5 max-h-20 overflow-y-auto pr-1">
                    “{selectedText || pointer?.text}”
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border bg-background p-1.5 pl-3 shadow-sm">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                placeholder="Ask about what you see…"
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon"
                      onClick={send}
                      disabled={!draft.trim() || chat.isPending}
                    />
                  }
                >
                  <Send />
                </TooltipTrigger>
                <TooltipContent>Send question</TooltipContent>
              </Tooltip>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => visualize.mutate()}
                disabled={visualize.isPending}
              >
                {visualize.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ImageIcon />
                )}
                Visualize this
              </Button>
              <Button
                variant={voice.connected ? "secondary" : "outline"}
                size="sm"
                onClick={voice.connected ? voice.disconnect : voice.connect}
              >
                <VoiceOrb state={voice.state} />
                <span>
                  {voice.state === "idle" || voice.state === "error"
                    ? "Talk aloud"
                    : voice.state === "connecting"
                      ? "Connecting"
                      : voice.state === "speaking"
                        ? "Loreline speaking"
                        : "Listening"}
                </span>
              </Button>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={readerMode}
              onClick={() => {
                const next = !readerMode;
                setReaderMode(next);
                if (next) void voice.startNarration();
                else voice.stopNarration();
              }}
              className={cn(
                "mt-3 flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition-colors",
                readerMode
                  ? "border-coral/45 bg-coral-soft/50"
                  : "bg-background hover:bg-muted/55",
              )}
            >
              <span className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-full bg-card shadow-sm">
                  <BookOpenText className="size-4 text-coral" />
                </span>
                <span>
                  <span className="block text-xs font-semibold">
                    Reader mode
                  </span>
                  <span className="block text-[0.64rem] text-muted-foreground">
                    Narrate and turn pages automatically
                  </span>
                </span>
              </span>
              <span
                className={cn(
                  "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
                  readerMode ? "justify-end bg-coral" : "justify-start bg-muted",
                )}
              >
                <span className="size-4 rounded-full bg-card shadow-sm" />
              </span>
            </button>
            {voice.error && (
              <p className="mt-2 text-[0.68rem] text-destructive">
                {voice.error}
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="board" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-4">
              {items.length === 0 ? (
                <div className="dot-grid flex min-h-72 flex-col items-center justify-center rounded-2xl border bg-paper px-6 text-center">
                  <span className="grid size-11 place-items-center rounded-xl bg-card shadow-sm">
                    <Sparkles className="size-5 text-coral" />
                  </span>
                  <p className="mt-4 font-display text-2xl">
                    A visual working space
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Ask Loreline to show, compare, map, or visualize something.
                    Notes and images will stay here while you read.
                  </p>
                </div>
              ) : (
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
                          setItems((current) =>
                            current.filter(
                              (candidate) => candidate.id !== item.id,
                            ),
                          )
                        }
                        className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-full bg-background/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
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
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="notes" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-5 p-4">
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
                          onClick={() => void onDeleteBookmark(bookmark.id)}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </section>
              )}
              <section>
                <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-muted-foreground">
                  Highlighted passages
                </p>
                {highlights.length ? (
                  <div className="space-y-3">
                    {highlights.map((highlight) => (
                      <SavedHighlightCard
                        key={`${highlight.id}:${highlight.note ?? ""}`}
                        highlight={highlight}
                        onOpen={() => onOpenHighlight(highlight)}
                        onUpdate={(note) =>
                          onUpdateHighlight(highlight.id, note)
                        }
                        onDelete={() => onDeleteHighlight(highlight.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed bg-paper p-6 text-center">
                    <Highlighter className="mx-auto size-5 text-coral" />
                    <p className="mt-3 text-sm font-semibold">
                      Your passages will live here
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Select text in the PDF to highlight it or attach a note.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
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
  const [pointer, setPointer] = useState<PointerContext>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [activeFocus, setActiveFocus] = useState<ReaderFocus | null>(null);
  const [focusRequest, setFocusRequest] =
    useState<ReaderFocusRequest | null>(null);
  const pendingFocusRef = useRef<{
    id: string;
    resolve: (selection: ReaderSelection | null) => void;
    timeout: number;
  } | null>(null);
  const [visibleText, setVisibleText] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [boardItems, setBoardItems] = useState<BoardItem[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({
    width: 760,
    height: 900,
  });
  const [noteSelection, setNoteSelection] =
    useState<ReaderSelection | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

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
      setActiveFocus((current) =>
        current?.id === deletedId ? null : current,
      );
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
            : [...current, created].sort((left, right) => left.page - right.page),
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
      setScreenshot(null);
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
  const displayedFocus: ReaderFocus | null = selection
    ? { id: "current-selection", ...selection }
    : activeFocus;

  const sideboard = (
    <Sideboard
      book={book}
      page={page}
      visibleText={visibleText}
      selectedText={selection?.text ?? ""}
      pointer={pointer}
      screenshot={screenshot}
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
                    if (currentBookmark)
                      deleteBookmarkMutation.mutate(currentBookmark.id);
                    else createBookmarkMutation.mutate(page);
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
            onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))}
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
            onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
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
          sideboardOpen ? "xl:grid-cols-[minmax(0,1fr)_23rem]" : "grid-cols-1",
        )}
      >
        <div className="relative min-h-0 overflow-hidden">
          <div
            ref={viewportRef}
            className="scrollbar-none absolute inset-0 overflow-auto p-4 sm:p-6"
          >
            <PdfReader
              fileUrl={`/api/books/${bookId}/file`}
              page={page}
              viewport={viewportSize}
              zoom={zoom}
              highlights={pageHighlights}
              activeFocus={displayedFocus}
              focusRequest={focusRequest}
              pointer={pointer}
              onDocumentReady={(pages) => {
                setNumPages(pages);
                if (page > pages) setPage(pages);
              }}
              onVisibleTextChange={setVisibleText}
              onScreenshotChange={setScreenshot}
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
            <div className="fixed bottom-0 right-0 top-14 z-50 w-[min(92vw,23rem)] xl:static xl:z-auto xl:h-full xl:w-auto xl:min-h-0">
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
            onChange={(event) => setNoteDraft(event.target.value.slice(0, 4000))}
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
    </div>
  );
}
