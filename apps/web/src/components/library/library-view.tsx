"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Ellipsis,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { apiJson } from "@/lib/api-client";
import { toUserMessage, UserFacingError } from "@/lib/errors";
import { showErrorToast } from "@/lib/toast-error";
import {
  type BeginBookUploadResponse,
  MAX_BOOK_FILE_SIZE,
  MAX_BOOK_FILE_SIZE_LABEL,
  type BookListItem,
  type BooksPageResponse,
  type UploadBookResponse,
} from "@loreline/contracts/books";
import type { Folder, FolderTreeNode } from "@loreline/contracts/folders";

async function getBooks(
  folderId: string | null,
  cursor?: string | null,
): Promise<BooksPageResponse> {
  const params = new URLSearchParams({ limit: "12" });
  if (folderId) params.set("folderId", folderId);
  if (cursor) params.set("cursor", cursor);
  return apiJson<BooksPageResponse>(`/api/books?${params}`);
}

async function getFolders(
  parentId: string | null,
): Promise<{ folders: Folder[] }> {
  const params = new URLSearchParams();
  if (parentId) params.set("parentId", parentId);
  return apiJson<{ folders: Folder[] }>(`/api/folders?${params}`);
}

async function getFolderBreadcrumb(
  folderId: string,
): Promise<{ breadcrumb: Folder[] }> {
  return apiJson<{ breadcrumb: Folder[] }>(
    `/api/folders/${folderId}/breadcrumb`,
  );
}

async function getFolderTree(): Promise<{ tree: FolderTreeNode[] }> {
  return apiJson<{ tree: FolderTreeNode[] }>("/api/folders/tree");
}

function flattenFolderTree(
  nodes: FolderTreeNode[],
  depth = 0,
): Array<{ folder: Folder; depth: number }> {
  return nodes.flatMap((node) => [
    { folder: node, depth },
    ...flattenFolderTree(node.children, depth + 1),
  ]);
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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Folder | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<BookListItem | null>(null);
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderId = searchParams.get("folderId") || null;
  const foldersQuery = useQuery({
    queryKey: ["folders", folderId],
    queryFn: () => getFolders(folderId),
  });
  const breadcrumbQuery = useQuery({
    queryKey: ["folderBreadcrumb", folderId],
    queryFn: () => getFolderBreadcrumb(folderId!),
    enabled: !!folderId,
  });
  const folderTreeQuery = useQuery({
    queryKey: ["folderTree"],
    queryFn: getFolderTree,
    enabled: moveOpen,
  });
  const booksQuery = useInfiniteQuery({
    queryKey: ["books", folderId],
    queryFn: ({ pageParam }) => getBooks(folderId, pageParam),
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
  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      apiJson<{ folder: Folder }>("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: folderId }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["folders", folderId],
        exact: true,
      });
      if (folderInputRef.current) folderInputRef.current.value = "";
      setFolderOpen(false);
    },
  });
  const renameFolderMutation = useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      apiJson<{ folder: Folder }>(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["folders", folderId],
        exact: true,
      });
      if (folderId) {
        await queryClient.invalidateQueries({
          queryKey: ["folderBreadcrumb", folderId],
          exact: true,
        });
      }
      setRenameName("");
      setRenameTarget(null);
      setRenameOpen(false);
    },
  });
  const deleteFolderMutation = useMutation({
    mutationFn: (folderId: string) =>
      apiJson<{ folder: Folder }>(`/api/folders/${folderId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      const params = new URLSearchParams(searchParams.toString());
      if (deleteTarget?.parentId) params.set("folderId", deleteTarget.parentId);
      else params.delete("folderId");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });

      await queryClient.invalidateQueries({
        queryKey: ["folders", folderId],
        exact: true,
      });
      if (folderId) {
        await queryClient.invalidateQueries({
          queryKey: ["folderBreadcrumb", folderId],
          exact: true,
        });
      }
      setDeleteTarget(null);
      setDeleteOpen(false);
    },
  });
  const moveBookMutation = useMutation({
    mutationFn: ({
      bookId,
      folderId: destinationFolderId,
    }: {
      bookId: string;
      folderId: string | null;
    }) =>
      apiJson<{ book: { id: string; folderId: string | null } }>(
        `/api/books/${bookId}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: destinationFolderId }),
        },
      ),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["books", folderId],
        exact: true,
      });
      await queryClient.invalidateQueries({
        queryKey: ["folders", variables.folderId],
        exact: true,
      });
      setMoveTarget(null);
      setMoveOpen(false);
    },
  });
  const books = useMemo(
    () => booksQuery.data?.pages.flatMap((page) => page.books) ?? [],
    [booksQuery.data],
  );
  const folders = foldersQuery.data?.folders ?? [];
  const breadcrumb = breadcrumbQuery.data?.breadcrumb ?? [];
  const folderOptions = flattenFolderTree(folderTreeQuery.data?.tree ?? []);
  const filtered = books.filter((book) =>
    `${book.title} ${book.author ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  function selectFolder(nextFolderId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("folderId", nextFolderId);
    router.push(`${pathname}?${params}`, { scroll: false });
  }

  function returnToShelf() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("folderId");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

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

  function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderInputRef.current?.value.trim();
    if (!name) {
      showErrorToast(new UserFacingError("Enter a stack name."));
      return;
    }
    createFolderMutation.mutate(name);
  }

  function openRename(folder: Folder) {
    setRenameTarget(folder);
    setRenameName(folder.name);
    setRenameOpen(true);
  }

  function renameFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = renameName.trim();
    if (!name) {
      showErrorToast(new UserFacingError("Enter a stack name."));
      return;
    }
    if (!renameTarget) return;
    renameFolderMutation.mutate({ folderId: renameTarget.id, name });
  }

  function openDelete(folder: Folder) {
    setDeleteTarget(folder);
    setDeleteOpen(true);
  }

  function deleteFolder() {
    if (!deleteTarget) return;
    deleteFolderMutation.mutate(deleteTarget.id);
  }

  function openMove(book: BookListItem) {
    setMoveTarget(book);
    setMoveDestination(folderId);
    setMoveOpen(true);
  }

  function moveBook() {
    if (!moveTarget) return;
    moveBookMutation.mutate({
      bookId: moveTarget.id,
      folderId: moveDestination,
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
        <div className="flex items-center gap-2">
          <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
            <DialogTrigger
              render={<Button size="lg" variant="outline" className="h-10" />}
            >
              <FolderPlus />
              New Stack
            </DialogTrigger>
            <DialogContent className="rounded-3xl p-6 sm:max-w-md">
              <form onSubmit={createFolder}>
                <DialogHeader>
                  <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                    Create Stack
                  </DialogTitle>
                  <DialogDescription>
                    Keep related books together in one stack.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-6 space-y-2">
                  <Label htmlFor="folder-name">Stack name</Label>
                  <Input
                    ref={folderInputRef}
                    id="folder-name"
                    name="folder-name"
                    required
                    maxLength={180}
                    placeholder="Programming"
                  />
                </div>
                <DialogFooter className="mt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setFolderOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createFolderMutation.isPending}
                  >
                    {createFolderMutation.isPending && (
                      <LoaderCircle className="animate-spin" />
                    )}
                    Create Stack
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={renameOpen}
            onOpenChange={(nextOpen) => {
              setRenameOpen(nextOpen);
              if (!nextOpen) setRenameTarget(null);
            }}
          >
            <DialogContent className="rounded-3xl p-6 sm:max-w-md">
              <form onSubmit={renameFolder}>
                <DialogHeader>
                  <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                    Rename Stack
                  </DialogTitle>
                  <DialogDescription>
                    Choose a new name for this stack.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-6 space-y-2">
                  <Label htmlFor="rename-folder-name">Stack name</Label>
                  <Input
                    id="rename-folder-name"
                    name="rename-folder-name"
                    value={renameName}
                    onChange={(event) => setRenameName(event.target.value)}
                    required
                    maxLength={180}
                    autoFocus
                  />
                </div>
                <DialogFooter className="mt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRenameOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={renameFolderMutation.isPending}
                  >
                    {renameFolderMutation.isPending && (
                      <LoaderCircle className="animate-spin" />
                    )}
                    Rename Stack
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={deleteOpen}
            onOpenChange={(nextOpen) => {
              setDeleteOpen(nextOpen);
              if (!nextOpen) setDeleteTarget(null);
            }}
          >
            <DialogContent className="rounded-3xl p-6 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                  Delete Stack
                </DialogTitle>
                <DialogDescription>
                  Delete “{deleteTarget?.name}”? This cannot be undone. Stacks
                  with books or child stacks must be emptied first.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDeleteOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteFolderMutation.isPending}
                  onClick={deleteFolder}
                >
                  {deleteFolderMutation.isPending && (
                    <LoaderCircle className="animate-spin" />
                  )}
                  Delete Stack
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={moveOpen}
            onOpenChange={(nextOpen) => {
              setMoveOpen(nextOpen);
              if (!nextOpen) setMoveTarget(null);
            }}
          >
            <DialogContent className="rounded-3xl p-6 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                  Move Book
                </DialogTitle>
                <DialogDescription>
                  Choose where to keep “{moveTarget?.title}”.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                {folderTreeQuery.isPending ? (
                  <div className="h-10 animate-pulse rounded-lg bg-muted" />
                ) : folderTreeQuery.isError ? (
                  <div className="flex items-center justify-between gap-3 py-3 text-sm text-muted-foreground">
                    <span>Stacks could not be loaded.</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => folderTreeQuery.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-pressed={moveDestination === null}
                      onClick={() => setMoveDestination(null)}
                      className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm hover:bg-control aria-pressed:bg-control"
                    >
                      <FolderIcon className="size-4 text-brand-ink" />
                      Shelf
                    </button>
                    {folderOptions.map(({ folder, depth }) => (
                      <button
                        key={folder.id}
                        type="button"
                        aria-pressed={moveDestination === folder.id}
                        onClick={() => setMoveDestination(folder.id)}
                        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
                        className="flex w-full items-center gap-3 rounded-lg p-2 pr-2 text-left text-sm hover:bg-control aria-pressed:bg-control"
                      >
                        <FolderIcon className="size-4 shrink-0 text-brand-ink" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setMoveOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    moveBookMutation.isPending || folderTreeQuery.isPending
                  }
                  onClick={moveBook}
                >
                  {moveBookMutation.isPending && (
                    <LoaderCircle className="animate-spin" />
                  )}
                  Move Book
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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

      <div className="mt-4 flex min-h-8 items-center gap-1 text-sm text-muted-foreground">
        <button
          type="button"
          className="font-medium text-foreground hover:text-brand-ink"
          onClick={returnToShelf}
        >
          Shelf
        </button>
        {folderId && breadcrumbQuery.isPending ? (
          <span className="ml-2 h-4 w-24 animate-pulse rounded bg-muted" />
        ) : folderId && breadcrumbQuery.isError ? (
          <span className="ml-2">Stack path unavailable.</span>
        ) : (
          breadcrumb.map((folder, index) => (
            <span key={folder.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5" />
              {index === breadcrumb.length - 1 ? (
                <span className="truncate font-medium text-foreground">
                  {folder.name}
                </span>
              ) : (
                <button
                  type="button"
                  className="truncate hover:text-foreground"
                  onClick={() => selectFolder(folder.id)}
                >
                  {folder.name}
                </button>
              )}
            </span>
          ))
        )}
      </div>

      {foldersQuery.isPending ? (
        <div className="grid grid-cols-2 gap-3 py-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-[3.625rem] animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      ) : foldersQuery.isError ? (
        <div className="flex items-center justify-between gap-3 py-4 text-sm text-muted-foreground">
          <span className="truncate">
            {toUserMessage(
              foldersQuery.error,
              "Loreline couldn’t load your stacks. Please try again.",
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={foldersQuery.isFetching}
            onClick={() => foldersQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : folders.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 py-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="flex min-w-0 items-center gap-2 rounded-xl border bg-card p-2"
            >
              <button
                type="button"
                onClick={() => selectFolder(folder.id)}
                className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
              >
                <FolderIcon className="size-5 shrink-0 text-brand-ink" />
                <span className="truncate text-sm font-semibold">
                  {folder.name}
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Actions for ${folder.name}`}
                    />
                  }
                >
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem onClick={() => openRename(folder)}>
                    <Pencil />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => openDelete(folder)}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      ) : null}

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
              <div
                key={book.id}
                className="group relative min-w-0"
              >
                <Link href={`/library/${book.id}`}>
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
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Actions for ${book.title}`}
                        className="absolute top-2 right-2 bg-card/80 opacity-0 backdrop-blur-sm group-hover:opacity-100 focus-visible:opacity-100"
                      />
                    }
                  >
                    <Ellipsis />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem onClick={() => openMove(book)}>
                      <FolderIcon />
                      Move to...
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
