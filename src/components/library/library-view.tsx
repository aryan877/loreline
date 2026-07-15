"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  BookOpen,
  FileText,
  LoaderCircle,
  Plus,
  Search,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useRef, useState } from "react";
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
  MAX_BOOK_FILE_SIZE,
  MAX_BOOK_FILE_SIZE_LABEL,
  type BooksPageResponse,
  type UploadBookResponse,
} from "@/shared/contracts";

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

export function LibraryView() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const booksQuery = useInfiniteQuery({
    queryKey: ["books"],
    queryFn: ({ pageParam }) => getBooks(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
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
      const transfer = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body: file,
      });
      if (!transfer.ok)
        throw new UserFacingError(
          "The PDF could not reach cloud storage. Please try again.",
        );
      return apiJson<UploadBookResponse>(
        `/api/books/${upload.bookId}/complete`,
        { method: "POST" },
      );
    },
    onSuccess: async () => {
      setOpen(false);
      if (inputRef.current) inputRef.current.value = "";
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

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
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
        <Dialog open={open} onOpenChange={setOpen}>
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
                  Upload a PDF. Loreline extracts its text privately and
                  prepares optional semantic retrieval.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="file">PDF file</Label>
                  <label
                    htmlFor="file"
                    className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed bg-card text-center transition-colors hover:bg-control"
                  >
                    <UploadCloud className="mb-3 size-6 text-brand-ink" />
                    <span className="text-sm font-medium">Choose a PDF</span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      Up to {MAX_BOOK_FILE_SIZE_LABEL}
                    </span>
                  </label>
                  <Input
                    ref={inputRef}
                    id="file"
                    name="file"
                    type="file"
                    accept="application/pdf,.pdf"
                    required
                    className="sr-only"
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
                    />
                  </div>
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={uploadMutation.isPending}>
                  {uploadMutation.isPending && (
                    <LoaderCircle className="animate-spin" />
                  )}
                  {uploadMutation.isPending
                    ? "Preparing book…"
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
            {filtered.map((book, index) => (
              <Link
                key={book.id}
                href={`/library/${book.id}`}
                className="group min-w-0"
              >
                <BookCover title={book.title} index={index} />
                <div className="mt-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="truncate font-semibold">{book.title}</h2>
                    <ArrowRight className="mt-0.5 size-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {book.author || `${book.pageCount} pages`} ·{" "}
                    {formatDistanceToNow(new Date(book.lastOpenedAt), {
                      addSuffix: true,
                    })}
                  </p>
                  <Progress value={book.progress * 100} className="mt-3 h-1" />
                </div>
              </Link>
            ))}
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
