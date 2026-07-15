"use client";

import {
  type InfiniteData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
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
  Volume2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  BoardItem,
  BookProgressResponse,
  BookResponse,
  BooksPageResponse,
  ChatMessage,
  ChatResponse,
  IllustrationResponse,
  PointerContext,
  ReaderBook,
} from "@/shared/contracts";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

async function getBook(bookId: string): Promise<ReaderBook> {
  const data = await apiJson<BookResponse>(`/api/books/${bookId}`);
  return data.book;
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

function Sideboard({
  book,
  page,
  visibleText,
  selectedText,
  pointer,
  screenshot,
  items,
  setItems,
}: {
  book: ReaderBook;
  page: number;
  visibleText: string;
  selectedText: string;
  pointer: PointerContext;
  screenshot: string | null;
  items: BoardItem[];
  setItems: React.Dispatch<React.SetStateAction<BoardItem[]>>;
}) {
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
    }),
    [book.id, book.title, page, visibleText, selectedText, pointer, screenshot],
  );
  const voice = useLorelineVoice(voiceContext, addBoardItem, addTranscript);

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
                <span className="line-clamp-2">
                  {selectedText
                    ? `Selected: “${selectedText}”`
                    : `Pointing at: “${pointer?.text}”`}
                </span>
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
  const [selectedText, setSelectedText] = useState("");
  const [visibleText, setVisibleText] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [boardItems, setBoardItems] = useState<BoardItem[]>([]);
  const pageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = useState(760);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setPageWidth(Math.min(820, Math.max(320, entry.contentRect.width - 48))),
    );
    observer.observe(node);
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

  const capturePage = useCallback(() => {
    window.setTimeout(() => {
      const canvas = pageRef.current?.querySelector("canvas");
      if (canvas) {
        try {
          setScreenshot(canvas.toDataURL("image/jpeg", 0.58));
        } catch {
          setScreenshot(null);
        }
      }
    }, 250);
  }, []);
  const go = (next: number) => {
    setPage(Math.min(numPages, Math.max(1, next)));
    setSelectedText("");
    setPointer(null);
    setVisibleText("");
    setScreenshot(null);
  };

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
        <div
          ref={viewportRef}
          className="scrollbar-none min-h-0 overflow-auto p-4 sm:p-6"
        >
          <div
            ref={pageRef}
            className="relative mx-auto w-fit overflow-hidden bg-card shadow-float"
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const element = document.elementFromPoint(
                event.clientX,
                event.clientY,
              );
              const text = element
                ?.closest(".react-pdf__Page__textContent span")
                ?.textContent?.trim();
              setPointer({
                x: Math.max(
                  0,
                  Math.min(1, (event.clientX - rect.left) / rect.width),
                ),
                y: Math.max(
                  0,
                  Math.min(1, (event.clientY - rect.top) / rect.height),
                ),
                text: text?.slice(0, 320) || undefined,
              });
            }}
            onMouseLeave={() => setPointer(null)}
            onMouseUp={() =>
              setSelectedText(
                window.getSelection()?.toString().trim().slice(0, 4000) ?? "",
              )
            }
          >
            <Document
              file={`/api/books/${bookId}/file`}
              loading={
                <div
                  style={{ width: pageWidth, minHeight: pageWidth * 1.35 }}
                  className="grid place-items-center"
                >
                  <LoaderCircle className="size-5 animate-spin text-coral" />
                </div>
              }
              onLoadSuccess={({ numPages: pages }) => setNumPages(pages)}
              onLoadError={() => null}
            >
              <Page
                pageNumber={page}
                width={pageWidth * zoom}
                renderAnnotationLayer={false}
                onRenderSuccess={capturePage}
                onGetTextSuccess={(content) =>
                  setVisibleText(
                    content.items
                      .map((item) => ("str" in item ? item.str : ""))
                      .join(" ")
                      .slice(0, 16000),
                  )
                }
              />
            </Document>
            {pointer && (
              <div
                className="pointer-events-none absolute z-20"
                style={{
                  left: `${pointer.x * 100}%`,
                  top: `${pointer.y * 100}%`,
                }}
              >
                <span className="absolute -left-2 -top-2 size-4 rounded-full border-2 border-card bg-coral shadow-sm" />
                <span className="absolute left-2 top-2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[0.6rem] font-semibold text-primary-foreground shadow-sm">
                  You&apos;re here
                </span>
              </div>
            )}
          </div>
        </div>
        {sideboardOpen && (
          <div className="hidden h-full min-h-0 xl:block">
            <Sideboard
              book={book}
              page={page}
              visibleText={visibleText}
              selectedText={selectedText}
              pointer={pointer}
              screenshot={screenshot}
              items={boardItems}
              setItems={setBoardItems}
            />
          </div>
        )}
      </div>
      {sideboardOpen && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-40 xl:hidden">
          <button
            aria-label="Close sideboard"
            className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
            onClick={() => setSideboardOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 w-[min(92vw,23rem)]">
            <Sideboard
              book={book}
              page={page}
              visibleText={visibleText}
              selectedText={selectedText}
              pointer={pointer}
              screenshot={screenshot}
              items={boardItems}
              setItems={setBoardItems}
            />
          </div>
        </div>
      )}
    </div>
  );
}
