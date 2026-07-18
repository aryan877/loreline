"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  DragDropProvider,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  ArrowRightLeft,
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
import {
  FormEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { cn } from "@/lib/utils";
import {
  type BeginBookUploadResponse,
  MAX_BOOK_FILE_SIZE,
  MAX_BOOK_FILE_SIZE_LABEL,
  type BookListItem,
  type BooksPageResponse,
  type DeleteBookResponse,
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

function collectFolderIds(node: FolderTreeNode): string[] {
  return [node.id, ...node.children.flatMap(collectFolderIds)];
}

function getExcludedFolderIds(
  nodes: FolderTreeNode[],
  targetId: string,
): Set<string> {
  for (const node of nodes) {
    if (node.id === targetId) return new Set(collectFolderIds(node));
    const nested = getExcludedFolderIds(node.children, targetId);
    if (nested.size > 0) return nested;
  }
  return new Set();
}

type DragPayload =
  | { type: "book"; id: string }
  | { type: "stack"; id: string };
type DropPayload =
  | { type: "shelf-target"; id: "shelf" }
  | { type: "stack-target"; id: string };

const dragSensors = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 6 }),
    ],
    preventActivation: (event) =>
      (event.target as Element | null)?.closest(
        "button, input, textarea, select",
      ) !== null,
  }),
  KeyboardSensor,
];

function DraggableItem({
  id,
  data,
  className,
  children,
}: {
  id: string;
  data: DragPayload;
  className?: string;
  children: ReactNode;
}) {
  const { ref, isDragging } = useDraggable<DragPayload>({ id, data });

  return (
    <div ref={ref} className={cn(className, isDragging && "opacity-60")}>
      {children}
    </div>
  );
}

function DraggableDropTarget({
  id,
  data,
  dropId,
  dropData,
  className,
  children,
}: {
  id: string;
  data: DragPayload;
  dropId: string;
  dropData: DropPayload;
  className?: string;
  children: ReactNode;
}) {
  const { ref: draggableRef, isDragging } = useDraggable<DragPayload>({
    id,
    data,
  });
  const { ref: droppableRef, isDropTarget } = useDroppable<DropPayload>({
    id: dropId,
    data: dropData,
  });

  const setRefs = useCallback(
    (element: Element | null) => {
      draggableRef(element);
      droppableRef(element);
    },
    [draggableRef, droppableRef],
  );

  return (
    <div
      ref={setRefs}
      className={cn(
        className,
        isDragging && "opacity-60",
        isDropTarget && "ring-2 ring-brand-ink bg-brand-soft",
      )}
    >
      {children}
    </div>
  );
}

function DropTarget({
  id,
  data,
  className,
  children,
}: {
  id: string;
  data: DropPayload;
  className?: string;
  children: ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable<DropPayload>({ id, data });

  return (
    <div
      ref={ref}
      className={cn(
        className,
        isDropTarget && "ring-2 ring-brand-ink bg-brand-soft",
      )}
    >
      {children}
    </div>
  );
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
  const [deleteBookOpen, setDeleteBookOpen] = useState(false);
  const [deleteBookTarget, setDeleteBookTarget] =
    useState<BookListItem | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<BookListItem | null>(null);
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [moveStackOpen, setMoveStackOpen] = useState(false);
  const [moveStackTarget, setMoveStackTarget] = useState<Folder | null>(null);
  const [moveStackDestination, setMoveStackDestination] = useState<
    string | null
  >(null);
  const [activeDrag, setActiveDrag] = useState<DragPayload | null>(null);
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
    enabled: moveOpen || moveStackOpen,
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
  const deleteBookMutation = useMutation({
    mutationFn: (bookId: string) =>
      apiJson<DeleteBookResponse>(`/api/books/${bookId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["books", folderId],
        exact: true,
      });
      setDeleteBookTarget(null);
      setDeleteBookOpen(false);
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
      setMoveDestination(null);
      setMoveOpen(false);
    },
  });
  const moveStackMutation = useMutation({
    mutationFn: ({ folderId, parentId }: { folderId: string; parentId: string | null }) =>
      apiJson<{ folder: Folder }>(`/api/folders/${folderId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId }),
      }),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["folderTree"],
        exact: true,
      });
      await queryClient.invalidateQueries({
        queryKey: ["folders", folderId],
        exact: true,
      });
      await queryClient.invalidateQueries({
        queryKey: ["folders", variables.parentId],
        exact: true,
      });
      if (folderId) {
        await queryClient.invalidateQueries({
          queryKey: ["folderBreadcrumb", folderId],
          exact: true,
        });
      }
      setMoveStackTarget(null);
      setMoveStackDestination(null);
      setMoveStackOpen(false);
    },
  });
  const books = useMemo(
    () => booksQuery.data?.pages.flatMap((page) => page.books) ?? [],
    [booksQuery.data],
  );
  const folders = foldersQuery.data?.folders ?? [];
  const breadcrumb = breadcrumbQuery.data?.breadcrumb ?? [];
  const folderOptions = flattenFolderTree(folderTreeQuery.data?.tree ?? []);
  const excludedFolderIds = moveStackTarget
    ? getExcludedFolderIds(folderTreeQuery.data?.tree ?? [], moveStackTarget.id)
    : new Set<string>();
  const moveStackOptions = folderOptions.filter(
    ({ folder }) => !excludedFolderIds.has(folder.id),
  );
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

  function getFolderHref(nextFolderId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("folderId", nextFolderId);
    return `${pathname}?${params}`;
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

  function openDeleteBook(book: BookListItem) {
    setDeleteBookTarget(book);
    setDeleteBookOpen(true);
  }

  function deleteBook() {
    if (!deleteBookTarget) return;
    deleteBookMutation.mutate(deleteBookTarget.id);
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

  function openMoveStack(folder: Folder) {
    setMoveStackTarget(folder);
    setMoveStackDestination(folder.parentId);
    setMoveStackOpen(true);
  }

  function moveStack() {
    if (!moveStackTarget) return;
    moveStackMutation.mutate({
      folderId: moveStackTarget.id,
      parentId: moveStackDestination,
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const payload = event.operation.source?.data;
    if (
      payload &&
      (payload.type === "book" || payload.type === "stack") &&
      typeof payload.id === "string"
    ) {
      setActiveDrag({ type: payload.type, id: payload.id });
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);

    if (event.canceled) return;

    const source = event.operation.source?.data;
    const target = event.operation.target?.data;
    if (!source || !target) return;

    if (source.type === "book" && typeof source.id === "string") {
      const destinationFolderId =
        target.type === "shelf-target"
          ? null
          : target.type === "stack-target" && typeof target.id === "string"
            ? target.id
            : undefined;

      if (destinationFolderId === undefined || destinationFolderId === folderId) {
        return;
      }

      moveBookMutation.mutate({
        bookId: source.id,
        folderId: destinationFolderId,
      });
      return;
    }

    if (source.type === "stack" && typeof source.id === "string") {
      const sourceFolder = folders.find((folder) => folder.id === source.id);
      const destinationParentId =
        target.type === "shelf-target"
          ? null
          : target.type === "stack-target" && typeof target.id === "string"
            ? target.id
            : undefined;

      if (
        destinationParentId === undefined ||
        destinationParentId === source.id ||
        destinationParentId === sourceFolder?.parentId
      ) {
        return;
      }

      moveStackMutation.mutate({
        folderId: source.id,
        parentId: destinationParentId,
      });
    }
  }

  return (
    <DragDropProvider
      sensors={dragSensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <main
        data-dragging={activeDrag ? activeDrag.type : undefined}
        className="mx-auto max-w-[80rem] px-4 py-10 sm:px-0 sm:py-16"
      >
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
                  Delete &quot;{deleteTarget?.name}&quot;? This cannot be undone.
                  {(deleteTarget?.bookCount ?? 0) > 0 ||
                  (deleteTarget?.childStackCount ?? 0) > 0 ? (
                    <span className="mt-3 block">
                      This stack contains:
                      <span className="block">
                        • {deleteTarget?.bookCount ?? 0}{" "}
                        {(deleteTarget?.bookCount ?? 0) === 1
                          ? "Book"
                          : "Books"}
                      </span>
                      <span className="block">
                        • {deleteTarget?.childStackCount ?? 0}{" "}
                        {(deleteTarget?.childStackCount ?? 0) === 1
                          ? "Nested stack"
                          : "Nested stacks"}
                      </span>
                      <span className="mt-3 block">
                        Empty the stack before deleting it.
                        <br />
                        Move or delete its contents to continue.
                      </span>
                    </span>
                  ) : null}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="ghost"
                  className="cursor-pointer"
                  onClick={() => setDeleteOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="cursor-pointer"
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
            open={deleteBookOpen}
            onOpenChange={(nextOpen) => {
              setDeleteBookOpen(nextOpen);
              if (!nextOpen) setDeleteBookTarget(null);
            }}
          >
            <DialogContent className="rounded-3xl p-6 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                  Delete Book
                </DialogTitle>
                <DialogDescription>
                  Delete &quot;{deleteBookTarget?.title}&quot;? This cannot be
                  undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="ghost"
                  className="cursor-pointer"
                  onClick={() => setDeleteBookOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="cursor-pointer"
                  disabled={deleteBookMutation.isPending}
                  onClick={deleteBook}
                >
                  {deleteBookMutation.isPending && (
                    <LoaderCircle className="animate-spin" />
                  )}
                  Delete Book
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={moveOpen}
            onOpenChange={(nextOpen) => {
              setMoveOpen(nextOpen);
              if (!nextOpen) {
                setMoveTarget(null);
                setMoveDestination(null);
              }
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
                      <span>Shelf</span>
                      {folderId === null && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          (Current)
                        </span>
                      )}
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
                        {folder.id === folderId && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            (Current)
                          </span>
                        )}
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
                    moveBookMutation.isPending ||
                    folderTreeQuery.isPending ||
                    moveDestination === folderId
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

          <Dialog
            open={moveStackOpen}
            onOpenChange={(nextOpen) => {
              setMoveStackOpen(nextOpen);
              if (!nextOpen) {
                setMoveStackTarget(null);
                setMoveStackDestination(null);
              }
            }}
          >
            <DialogContent className="rounded-3xl p-6 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                  Move Stack
                </DialogTitle>
                <DialogDescription>
                  Choose where to place “{moveStackTarget?.name}”.
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
                      aria-pressed={moveStackDestination === null}
                      onClick={() => setMoveStackDestination(null)}
                      className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm hover:bg-control aria-pressed:bg-control"
                    >
                      <FolderIcon className="size-4 text-brand-ink" />
                      <span>Shelf</span>
                      {moveStackTarget?.parentId === null && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          (Current)
                        </span>
                      )}
                    </button>
                    {moveStackOptions.map(({ folder, depth }) => (
                      <button
                        key={folder.id}
                        type="button"
                        aria-pressed={moveStackDestination === folder.id}
                        onClick={() => setMoveStackDestination(folder.id)}
                        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
                        className="flex w-full items-center gap-3 rounded-lg p-2 pr-2 text-left text-sm hover:bg-control aria-pressed:bg-control"
                      >
                        <FolderIcon className="size-4 shrink-0 text-brand-ink" />
                        <span className="truncate">{folder.name}</span>
                        {folder.id === moveStackTarget?.parentId && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            (Current)
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                )}
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setMoveStackOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    moveStackMutation.isPending ||
                    folderTreeQuery.isPending ||
                    moveStackDestination === moveStackTarget?.parentId
                  }
                  onClick={moveStack}
                >
                  {moveStackMutation.isPending && (
                    <LoaderCircle className="animate-spin" />
                  )}
                  Move Stack
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
        <DropTarget
          id="shelf"
          data={{ type: "shelf-target", id: "shelf" }}
          className="rounded-md"
        >
          <button
            type="button"
            className="cursor-pointer px-1 font-medium text-foreground hover:text-brand-ink"
            onClick={returnToShelf}
          >
            Shelf
          </button>
        </DropTarget>
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
                  className="cursor-pointer truncate hover:text-foreground"
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
              <DraggableDropTarget
                key={folder.id}
                id={`stack:${folder.id}`}
                data={{ type: "stack", id: folder.id }}
                dropId={`stack-target:${folder.id}`}
                dropData={{ type: "stack-target", id: folder.id }}
                className="flex min-w-0 items-center gap-2 rounded-xl border bg-card p-2"
              >
              <Link
                href={getFolderHref(folder.id)}
                scroll={false}
                className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
              >
                <FolderIcon className="size-5 shrink-0 text-brand-ink" />
                <span className="truncate text-sm font-semibold">
                  {folder.name}
                </span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Actions for ${folder.name}`}
                      className="cursor-pointer"
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
                  <DropdownMenuItem onClick={() => openMoveStack(folder)}>
                    <ArrowRightLeft />
                    Move to...
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
              </DraggableDropTarget>
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
              <DraggableItem
                key={book.id}
                id={`book:${book.id}`}
                data={{ type: "book", id: book.id }}
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
                        className="absolute top-2 right-2 cursor-pointer bg-card/80 opacity-0 backdrop-blur-sm group-hover:opacity-100 focus-visible:opacity-100"
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
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => openDeleteBook(book)}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </DraggableItem>
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
    </DragDropProvider>
  );
}
