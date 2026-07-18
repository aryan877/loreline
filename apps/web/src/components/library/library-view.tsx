"use client";

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  CloudUpload,
  Database,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
  ScanText,
  Search,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { apiJson } from "@/lib/api-client";
import { toUserMessage, UserFacingError } from "@/lib/errors";
import { showErrorToast } from "@/lib/toast-error";
import {
  type BeginBookUploadResponse,
  type BookListItem,
  MAX_BOOK_FILE_SIZE,
  MAX_BOOK_FILE_SIZE_LABEL,
  type BooksPageResponse,
  type RetryBookIndexResponse,
  type UploadBookResponse,
} from "@loreline/contracts/books";

type UploadStage = "idle" | "creating" | "uploading" | "extracting";

async function getBooks(cursor?: string | null): Promise<BooksPageResponse> {
  const params = new URLSearchParams({ limit: "12" });
  if (cursor) params.set("cursor", cursor);
  return apiJson<BooksPageResponse>(`/api/books?${params}`);
}

function BookCover({ title, index }: { title: string; index: number }) {
  const tones = ["bg-coral-soft", "bg-sage-soft", "bg-sky-soft", "bg-accent"];
  return (
    <div
      className={`relative aspect-[3/4.15] overflow-hidden rounded-2xl ${tones[index % tones.length]} p-5 transition-transform duration-300 group-hover:-translate-y-1`}
    >
      <div className="absolute inset-y-0 left-2 w-px bg-foreground/10" />
      <div className="flex h-full flex-col justify-between">
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-foreground/55">
          Loreline edition
        </span>
        <p className="text-balance text-2xl font-semibold leading-[1.05] tracking-[-0.04em]">
          {title}
        </p>
        <div className="flex items-end justify-between">
          <span className="h-px w-12 bg-foreground/35" />
          <BookOpen className="size-4 text-foreground/55" />
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 0.1) return `${megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function indexingPercent(book: BookListItem) {
  if (book.indexingStatus === "ready") return 100;
  if (book.totalChunks === 0) return 0;
  return Math.round((book.indexedChunks / book.totalChunks) * 100);
}

function IndexingState({ book }: { book: BookListItem }) {
  if (book.status !== "ready") {
    return (
      <div className="mt-3 rounded-xl border bg-card px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          {book.status === "processing" ? (
            <LoaderCircle className="size-3.5 animate-spin text-brand-ink" />
          ) : (
            <CircleAlert className="size-3.5 text-destructive" />
          )}
          {book.status === "processing"
            ? "PDF preparation paused"
            : "PDF needs attention"}
        </div>
        <p className="mt-1 text-[0.7rem] leading-relaxed text-muted-foreground">
          {book.errorMessage ??
            "Resume from the private upload already in storage."}
        </p>
      </div>
    );
  }

  if (book.indexingStatus === "ready") {
    return (
      <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-ink">
        <span className="grid size-5 place-items-center rounded-full bg-brand-soft">
          <Check className="size-3" />
        </span>
        Grounded search ready
      </div>
    );
  }

  if (book.indexingStatus === "failed") {
    return (
      <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-medium text-destructive">
          <CircleAlert className="size-3.5" />
          {book.totalChunks === 0
            ? "No searchable text found"
            : "Grounded search paused"}
        </div>
        <p className="mt-1 text-[0.7rem] leading-relaxed text-muted-foreground">
          {book.indexingError ?? "The semantic index needs another try."}
        </p>
      </div>
    );
  }

  const percent = indexingPercent(book);
  return (
    <div className="mt-3 rounded-xl border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-xs font-medium">
        <span className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-brand-ink" />
          Building grounded search
        </span>
        <span className="tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <Progress
        value={percent}
        aria-label={`Semantic indexing ${percent}% complete`}
        className="mt-2"
      />
      <p className="mt-1.5 text-[0.68rem] text-muted-foreground">
        {book.indexedChunks.toLocaleString()} of{" "}
        {book.totalChunks.toLocaleString()} passages indexed
      </p>
    </div>
  );
}

const uploadSteps = [
  { stage: "creating", label: "Secure upload", icon: CloudUpload },
  { stage: "uploading", label: "Transfer PDF", icon: Database },
  { stage: "extracting", label: "Read every page", icon: ScanText },
] as const;

function UploadProgress({ stage }: { stage: Exclude<UploadStage, "idle"> }) {
  const activeIndex = uploadSteps.findIndex((step) => step.stage === stage);
  return (
    <div className="rounded-2xl border bg-card p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        {uploadSteps.map((step, index) => {
          const Icon = step.icon;
          const complete = index < activeIndex;
          const active = index === activeIndex;
          return (
            <div key={step.stage} className="flex min-w-0 flex-1 items-center">
              <div className="min-w-0 text-center">
                <span
                  className={`mx-auto grid size-8 place-items-center rounded-full border transition-colors ${
                    complete || active
                      ? "border-brand-ink/20 bg-brand-soft text-brand-ink"
                      : "bg-background text-muted-foreground"
                  }`}
                >
                  {complete ? (
                    <Check className="size-4" />
                  ) : active ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </span>
                <span className="mt-2 block truncate text-[0.68rem] font-medium">
                  {step.label}
                </span>
              </div>
              {index < uploadSteps.length - 1 && (
                <span
                  className={`mx-2 h-px flex-1 ${
                    index < activeIndex ? "bg-brand-ink/35" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        {stage === "extracting"
          ? "The PDF is safely stored. Loreline is extracting every page now; semantic indexing continues visibly in your library."
          : "Your PDF goes directly to private object storage and never passes through the web server."}
      </p>
    </div>
  );
}

export function LibraryView() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const booksQuery = useInfiniteQuery({
    queryKey: ["books"],
    queryFn: ({ pageParam }) => getBooks(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) => {
      const data = query.state.data as
        | InfiniteData<BooksPageResponse>
        | undefined;
      const hasActiveWork = data?.pages.some((page) =>
        page.books.some(
          (book) =>
            book.indexingStatus === "pending" ||
            book.indexingStatus === "indexing",
        ),
      );
      return hasActiveWork ? 2_000 : false;
    },
  });
  const uploadMutation = useMutation({
    mutationFn: async ({
      file,
      title,
      author,
    }: {
      file: File;
      title: string;
      author: string;
    }) => {
      setUploadStage("creating");
      const upload = await apiJson<BeginBookUploadResponse>("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          contentType: "application/pdf",
          title: title || undefined,
          author: author || undefined,
        }),
      });
      setUploadStage("uploading");
      const transfer = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body: file,
      });
      if (!transfer.ok)
        throw new UserFacingError(
          "The PDF could not reach cloud storage. Please try again.",
        );
      setUploadStage("extracting");
      return apiJson<UploadBookResponse>(
        `/api/books/${upload.bookId}/complete`,
        { method: "POST" },
      );
    },
    onSuccess: async () => {
      setOpen(false);
      setSelectedFile(null);
      setUploadStage("idle");
      if (inputRef.current) inputRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: () => setUploadStage("idle"),
  });
  const retryMutation = useMutation({
    mutationFn: async ({
      bookId,
      kind,
    }: {
      bookId: string;
      kind: "prepare" | "index";
    }) => {
      if (kind === "prepare") {
        return apiJson<UploadBookResponse>(
          `/api/books/${bookId}/complete`,
          { method: "POST" },
        );
      }
      return apiJson<RetryBookIndexResponse>(
        `/api/books/${bookId}/index`,
        { method: "POST" },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["books"] });
    },
  });
  const books = useMemo(
    () => booksQuery.data?.pages.flatMap((page) => page.books) ?? [],
    [booksQuery.data],
  );
  const filtered = books.filter((book) =>
    `${book.title} ${book.author ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  function changeFile(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.currentTarget.files?.[0] ?? null);
  }

  function changeDialogOpen(nextOpen: boolean) {
    if (!nextOpen && uploadMutation.isPending) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelectedFile(null);
      setUploadStage("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = selectedFile;
    if (!file) {
      showErrorToast(new UserFacingError("Choose a PDF to upload."));
      return;
    }
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      showErrorToast(
        new UserFacingError("Loreline currently accepts PDF books only."),
      );
      return;
    }
    if (file.size <= 0 || file.size > MAX_BOOK_FILE_SIZE) {
      showErrorToast(
        new UserFacingError(
          `PDFs must be smaller than ${MAX_BOOK_FILE_SIZE_LABEL}.`,
        ),
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    uploadMutation.mutate({
      file,
      title: String(form.get("title") ?? "").trim(),
      author: String(form.get("author") ?? "").trim(),
    });
  }

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-10 sm:px-0 sm:py-16">
      <div className="flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-brand-ink">
            Your reading room
          </p>
          <h1 className="mt-3 text-5xl font-semibold tracking-[-0.047em]">
            Library
          </h1>
          <p className="mt-3 text-muted-foreground">
            A shelf for books you want to understand, not merely finish.
          </p>
        </div>
        <Dialog open={open} onOpenChange={changeDialogOpen}>
          <DialogTrigger render={<Button size="lg" className="h-10" />}>
            <Plus />
            Add a book
          </DialogTrigger>
          <DialogContent className="rounded-3xl p-6 sm:max-w-lg">
            <form onSubmit={upload}>
              <DialogHeader>
                <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                  Bring in a book
                </DialogTitle>
                <DialogDescription>
                  Upload directly to private storage. Loreline reads every
                  page, then builds the semantic index used for grounded voice
                  answers.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="file">PDF file</Label>
                  <label
                    htmlFor="file"
                    className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center transition-colors hover:bg-control ${
                      selectedFile
                        ? "border-brand-ink/35 bg-brand-ink/5"
                        : "bg-card"
                    }`}
                  >
                    {selectedFile ? (
                      <>
                        <FileText className="mb-3 size-6 text-brand-ink" />
                        <span className="max-w-full truncate text-sm font-medium">
                          {selectedFile.name}
                        </span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          {formatFileSize(selectedFile.size)} · Choose another PDF
                        </span>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="mb-3 size-6 text-brand-ink" />
                        <span className="text-sm font-medium">Choose a PDF</span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          Up to {MAX_BOOK_FILE_SIZE_LABEL}
                        </span>
                      </>
                    )}
                  </label>
                  <Input
                    ref={inputRef}
                    id="file"
                    name="file"
                    type="file"
                    accept="application/pdf,.pdf"
                    required
                    disabled={uploadMutation.isPending}
                    className="sr-only"
                    onChange={changeFile}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="title">
                      Title{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="title"
                      name="title"
                      placeholder="Detected from filename"
                      disabled={uploadMutation.isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="author">
                      Author{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="author"
                      name="author"
                      placeholder="Author name"
                      disabled={uploadMutation.isPending}
                    />
                  </div>
                </div>
                {uploadStage !== "idle" && (
                  <UploadProgress stage={uploadStage} />
                )}
              </div>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={uploadMutation.isPending}
                  onClick={() => changeDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!selectedFile || uploadMutation.isPending}
                >
                  {uploadMutation.isPending && (
                    <LoaderCircle className="animate-spin" />
                  )}
                  {uploadMutation.isPending
                    ? uploadStage === "creating"
                      ? "Securing upload…"
                      : uploadStage === "uploading"
                        ? "Uploading PDF…"
                        : "Reading every page…"
                    : "Add to library"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-10 flex items-center gap-3 border-b pb-5">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your shelf"
            className="pl-9"
          />
        </div>
        <Badge variant="secondary">
          {books.length} {books.length === 1 ? "book" : "books"}
        </Badge>
      </div>

      {booksQuery.isPending ? (
        <div className="grid grid-cols-2 gap-5 py-10 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[3/4.15] animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      ) : booksQuery.isError ? (
        <div className="my-12 rounded-2xl border bg-card p-8">
          <p className="font-medium">Your library could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {toUserMessage(
              booksQuery.error,
              "Loreline couldn’t load your library. Please try again.",
            )}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => booksQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="my-12 flex min-h-96 flex-col items-center justify-center rounded-[2.5rem] bg-card text-center">
          <span className="grid size-14 place-items-center rounded-full bg-control">
            <FileText className="size-6 text-brand-ink" />
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
            {search ? "Nothing on this shelf" : "Your first book belongs here"}
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {search
              ? "Try a different title or author."
              : "Upload a PDF and Loreline will prepare a private, conversational reading space."}
          </p>
          {!search && (
            <Button className="mt-6" onClick={() => setOpen(true)}>
              <Plus />
              Add your first book
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 py-10 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((book, index) => {
              const canRead = book.status === "ready";
              const canRetryIndex =
                canRead &&
                book.indexingStatus === "failed" &&
                book.totalChunks > 0;
              const retrying =
                retryMutation.isPending &&
                retryMutation.variables?.bookId === book.id;
              return (
                <article key={book.id} className="group min-w-0">
                  {canRead ? (
                    <Link
                      href={`/library/${book.id}`}
                      aria-label={`Read ${book.title}`}
                    >
                      <BookCover title={book.title} index={index} />
                    </Link>
                  ) : (
                    <BookCover title={book.title} index={index} />
                  )}
                  <div className="mt-4">
                    {canRead ? (
                      <Link
                        href={`/library/${book.id}`}
                        className="flex items-start justify-between gap-2"
                      >
                        <h2 className="truncate font-semibold">{book.title}</h2>
                        <ArrowRight className="mt-0.5 size-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                      </Link>
                    ) : (
                      <h2 className="truncate font-semibold">{book.title}</h2>
                    )}
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {book.author ||
                        (canRead
                          ? `${book.pageCount} pages`
                          : formatFileSize(book.fileSize))}{" "}
                      ·{" "}
                      {formatDistanceToNow(new Date(book.lastOpenedAt), {
                        addSuffix: true,
                      })}
                    </p>
                    {canRead && (
                      <Progress
                        value={book.progress * 100}
                        aria-label={`Reading progress for ${book.title}`}
                        className="mt-3 h-1"
                      />
                    )}
                    <IndexingState book={book} />
                    {(!canRead || canRetryIndex) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-3 w-full"
                        disabled={retrying}
                        onClick={() =>
                          retryMutation.mutate({
                            bookId: book.id,
                            kind: canRead ? "index" : "prepare",
                          })
                        }
                      >
                        {retrying ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <RefreshCw />
                        )}
                        {canRead ? "Retry search index" : "Resume preparation"}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {booksQuery.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={booksQuery.isFetchingNextPage}
                onClick={() => booksQuery.fetchNextPage()}
              >
                {booksQuery.isFetchingNextPage && (
                  <LoaderCircle className="animate-spin" />
                )}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
