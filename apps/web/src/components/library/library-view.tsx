"use client";

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import {
  DragDropProvider,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
} from "@dnd-kit/react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  ArrowRightLeft,
  BookOpen,
  Check,
  CircleAlert,
  CloudUpload,
  ChevronRight,
  Database,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  GripVertical,
  Ellipsis,
  LoaderCircle,
  Plus,
  Pencil,
  RefreshCw,
  ScanText,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
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
  type BookListItem,
  MAX_BOOK_FILE_SIZE,
  MAX_BOOK_FILE_SIZE_LABEL,
  type BooksPageResponse,
  type DeleteBookResponse,
  type RetryBookIndexResponse,
  type UploadBookResponse,
} from "@loreline/contracts/books";
import type { Folder, FolderTreeNode } from "@loreline/contracts/folders";

const BookThumbnail = dynamic(
  () => import("@/components/library/book-thumbnail"),
  { ssr: false },
);

type UploadStage = "idle" | "creating" | "uploading" | "extracting";

async function getBooks(
  folderId: string | null,
  cursor?: string | null,
): Promise<BooksPageResponse> {
  const params = new URLSearchParams({ limit: "12" });
  if (folderId) params.set("folderId", folderId);
  if (cursor) params.set("cursor", cursor);
  return apiJson<BooksPageResponse>(`/api/books?${params}`);
}

async function getFolders(parentId: string | null) {
  const params = new URLSearchParams();
  if (parentId) params.set("parentId", parentId);
  return apiJson<{ folders: Folder[] }>(`/api/folders?${params}`);
}

async function getFolder(folderId: string) {
  return apiJson<{ folder: Folder }>(`/api/folders/${folderId}`);
}

async function getFolderBreadcrumb(folderId: string) {
  return apiJson<{ breadcrumb: Folder[] }>(
    `/api/folders/${folderId}/breadcrumb`,
  );
}

async function getFolderTree() {
  return apiJson<{ tree: FolderTreeNode[] }>("/api/folders/tree");
}

function flattenFolderTree(
  nodes: readonly FolderTreeNode[],
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
  nodes: readonly FolderTreeNode[],
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
  | { readonly type: "book"; readonly id: string }
  | { readonly type: "stack"; readonly id: string };

type DropPayload =
  | { readonly type: "shelf-target"; readonly id: "shelf" }
  | { readonly type: "stack-target"; readonly id: string };

const dragSensors = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 6 }),
    ],
    preventActivation: (event) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-drag-handle]")) return false;
      return target?.closest("button, input, textarea, select, a") !== null;
    },
  }),
  KeyboardSensor,
];

function DraggableItem({
  id,
  data,
  className,
  children,
}: {
  readonly id: string;
  readonly data: DragPayload;
  readonly className?: string;
  readonly children: (
    handleRef: (element: Element | null) => void,
  ) => ReactNode;
}) {
  const { ref, handleRef, isDragging } = useDraggable<DragPayload>({
    id,
    data,
  });
  return (
    <div ref={ref} className={cn(className, isDragging && "opacity-60")}>
      {children(handleRef)}
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
  readonly id: string;
  readonly data: DragPayload;
  readonly dropId: string;
  readonly dropData: DropPayload;
  readonly className?: string;
  readonly children: (
    handleRef: (element: Element | null) => void,
  ) => ReactNode;
}) {
  const {
    ref: draggableRef,
    handleRef,
    isDragging,
  } = useDraggable<DragPayload>({
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
        isDropTarget && "bg-brand-soft ring-2 ring-brand-ink",
      )}
    >
      {children(handleRef)}
    </div>
  );
}

function DropTarget({
  id,
  data,
  className,
  children,
}: {
  readonly id: string;
  readonly data: DropPayload;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable<DropPayload>({ id, data });
  return (
    <div
      ref={ref}
      className={cn(
        className,
        isDropTarget && "bg-brand-soft ring-2 ring-brand-ink",
      )}
    >
      {children}
    </div>
  );
}

function FolderDestinationPicker({
  options,
  value,
  currentId,
  isPending,
  isError,
  onChange,
  onRetry,
}: {
  readonly options: Array<{ folder: Folder; depth: number }>;
  readonly value: string | null;
  readonly currentId: string | null;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly onChange: (folderId: string | null) => void;
  readonly onRetry: () => void;
}) {
  if (isPending)
    return <div className="h-10 animate-pulse rounded-lg bg-muted" />;
  if (isError)
    return (
      <div className="flex items-center justify-between gap-3 py-3 text-sm text-muted-foreground">
        <span>Stacks could not be loaded.</span>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto">
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm hover:bg-control aria-pressed:bg-control"
      >
        <FolderIcon className="size-4 text-brand-ink" />
        <span>Shelf</span>
        {currentId === null && (
          <span className="ml-auto text-xs text-muted-foreground">Current</span>
        )}
      </button>
      {options.map(({ folder, depth }) => (
        <button
          key={folder.id}
          type="button"
          aria-pressed={value === folder.id}
          onClick={() => onChange(folder.id)}
          style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
          className="flex w-full items-center gap-3 rounded-lg p-2 pr-2 text-left text-sm hover:bg-control aria-pressed:bg-control"
        >
          <FolderIcon className="size-4 shrink-0 text-brand-ink" />
          <span className="truncate">{folder.name}</span>
          {folder.id === currentId && (
            <span className="ml-auto text-xs text-muted-foreground">
              Current
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function BookCover({ book, index }: { book: BookListItem; index: number }) {
  const tones = ["bg-coral-soft", "bg-sage-soft", "bg-sky-soft", "bg-accent"];
  return (
    <div
      className={`relative aspect-[3/4.15] overflow-hidden rounded-2xl border ${tones[index % tones.length]} shadow-soft transition-transform duration-300 group-hover:-translate-y-1`}
    >
      {book.status === "ready" ? (
        <BookThumbnail bookId={book.id} title={book.title} />
      ) : (
        <div className="flex h-full flex-col justify-between p-5">
          <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-foreground/55">
            Preparing PDF
          </span>
          <p className="text-balance text-2xl font-semibold leading-[1.05] tracking-[-0.04em]">
            {book.title}
          </p>
          <BookOpen className="size-4 text-foreground/55" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-foreground/8" />
      <div className="pointer-events-none absolute inset-y-0 left-2 w-px bg-foreground/10" />
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
        Embeddings indexed
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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Folder | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBookTarget, setDeleteBookTarget] = useState<BookListItem | null>(
    null,
  );
  const [moveTarget, setMoveTarget] = useState<BookListItem | null>(null);
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [moveStackTarget, setMoveStackTarget] = useState<Folder | null>(null);
  const [moveStackDestination, setMoveStackDestination] = useState<
    string | null
  >(null);
  const [activeDrag, setActiveDrag] = useState<DragPayload | null>(null);
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
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
  const deleteSummaryQuery = useQuery({
    queryKey: ["folder", deleteTarget?.id],
    queryFn: () => getFolder(deleteTarget!.id),
    enabled: !!deleteTarget,
  });
  const folderTreeQuery = useQuery({
    queryKey: ["folderTree"],
    queryFn: getFolderTree,
    enabled: !!moveTarget || !!moveStackTarget,
  });
  const booksQuery = useInfiniteQuery({
    queryKey: ["books", folderId],
    queryFn: ({ pageParam }) => getBooks(folderId, pageParam),
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
          folderId,
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
        return apiJson<UploadBookResponse>(`/api/books/${bookId}/complete`, {
          method: "POST",
        });
      }
      return apiJson<RetryBookIndexResponse>(`/api/books/${bookId}/index`, {
        method: "POST",
      });
    },
    onSuccess: async () => {
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["folders", folderId] }),
        queryClient.invalidateQueries({ queryKey: ["folderTree"] }),
      ]);
      if (folderInputRef.current) folderInputRef.current.value = "";
      setFolderOpen(false);
    },
  });
  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiJson<{ folder: Folder }>(`/api/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["folders"] }),
        queryClient.invalidateQueries({ queryKey: ["folderBreadcrumb"] }),
        queryClient.invalidateQueries({ queryKey: ["folderTree"] }),
      ]);
      setRenameTarget(null);
      setRenameName("");
    },
  });
  const deleteFolderMutation = useMutation({
    mutationFn: ({ id, confirmation }: { id: string; confirmation: string }) =>
      apiJson<{
        folder: {
          id: string;
          deletedBookCount: number;
          deletedStackCount: number;
        };
      }>(`/api/folders/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["folders"] }),
        queryClient.invalidateQueries({ queryKey: ["folderTree"] }),
      ]);
      setDeleteTarget(null);
      setDeleteConfirmation("");
    },
  });
  const deleteBookMutation = useMutation({
    mutationFn: (id: string) =>
      apiJson<DeleteBookResponse>(`/api/books/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["books", folderId] }),
        queryClient.invalidateQueries({ queryKey: ["folders"] }),
      ]);
      setDeleteBookTarget(null);
    },
  });
  const moveBookMutation = useMutation({
    mutationFn: ({
      bookId,
      destinationId,
    }: {
      bookId: string;
      destinationId: string | null;
    }) =>
      apiJson<{ book: { id: string; folderId: string | null } }>(
        `/api/books/${bookId}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: destinationId }),
        },
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["books"] }),
        queryClient.invalidateQueries({ queryKey: ["folders"] }),
      ]);
      setMoveTarget(null);
      setMoveDestination(null);
    },
  });
  const moveStackMutation = useMutation({
    mutationFn: ({
      stackId,
      destinationId,
    }: {
      stackId: string;
      destinationId: string | null;
    }) =>
      apiJson<{ folder: Folder }>(`/api/folders/${stackId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: destinationId }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["folders"] }),
        queryClient.invalidateQueries({ queryKey: ["folderTree"] }),
        queryClient.invalidateQueries({ queryKey: ["folderBreadcrumb"] }),
      ]);
      setMoveStackTarget(null);
      setMoveStackDestination(null);
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
  const visibleFolders = folders.filter((folder) =>
    folder.name.toLowerCase().includes(search.toLowerCase()),
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

  function selectFolder(nextFolderId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("folderId", nextFolderId);
    router.push(`${pathname}?${params}`, { scroll: false });
  }

  function folderHref(nextFolderId: string) {
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

  function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderInputRef.current?.value.trim();
    if (!name) {
      showErrorToast(new UserFacingError("Enter a stack name."));
      return;
    }
    createFolderMutation.mutate(name);
  }

  function renameFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = renameName.trim();
    if (!renameTarget || !name) {
      showErrorToast(new UserFacingError("Enter a stack name."));
      return;
    }
    renameFolderMutation.mutate({ id: renameTarget.id, name });
  }

  function startMoveBook(book: BookListItem) {
    setMoveTarget(book);
    setMoveDestination(folderId);
  }

  function startMoveStack(folder: Folder) {
    setMoveStackTarget(folder);
    setMoveStackDestination(folder.parentId);
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

    const destinationId =
      target.type === "shelf-target"
        ? null
        : target.type === "stack-target" && typeof target.id === "string"
          ? target.id
          : undefined;
    if (destinationId === undefined) return;

    if (source.type === "book" && typeof source.id === "string") {
      if (destinationId !== folderId)
        moveBookMutation.mutate({ bookId: source.id, destinationId });
      return;
    }

    if (source.type === "stack" && typeof source.id === "string") {
      const sourceFolder = folders.find((folder) => folder.id === source.id);
      if (
        destinationId !== source.id &&
        destinationId !== sourceFolder?.parentId
      ) {
        moveStackMutation.mutate({ stackId: source.id, destinationId });
      }
    }
  }

  const deleteSummary = deleteSummaryQuery.data?.folder;
  const canDeleteStack =
    deleteSummaryQuery.isSuccess && deleteConfirmation === deleteTarget?.name;

  return (
    <DragDropProvider
      sensors={dragSensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <main
        data-dragging={activeDrag?.type}
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
                New stack
              </DialogTrigger>
              <DialogContent className="rounded-3xl p-6 sm:max-w-md">
                <form onSubmit={createFolder}>
                  <DialogHeader>
                    <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                      Create a stack
                    </DialogTitle>
                    <DialogDescription>
                      Keep related books together. Stacks can contain other
                      stacks.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-6 space-y-2">
                    <Label htmlFor="stack-name">Stack name</Label>
                    <Input
                      ref={folderInputRef}
                      id="stack-name"
                      required
                      maxLength={180}
                      placeholder="History"
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
                      Create stack
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
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
                      page, then builds the semantic index used for grounded
                      voice answers.
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
                              {formatFileSize(selectedFile.size)} · Choose
                              another PDF
                            </span>
                          </>
                        ) : (
                          <>
                            <UploadCloud className="mb-3 size-6 text-brand-ink" />
                            <span className="text-sm font-medium">
                              Choose a PDF
                            </span>
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
                          <span className="text-muted-foreground">
                            (optional)
                          </span>
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
                          <span className="text-muted-foreground">
                            (optional)
                          </span>
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
        </div>

        <Dialog
          open={!!renameTarget}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !renameFolderMutation.isPending) {
              setRenameTarget(null);
              setRenameName("");
            }
          }}
        >
          <DialogContent className="rounded-3xl p-6 sm:max-w-md">
            <form onSubmit={renameFolder}>
              <DialogHeader>
                <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                  Rename stack
                </DialogTitle>
                <DialogDescription>
                  Choose a clear name for this collection.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-6 space-y-2">
                <Label htmlFor="rename-stack">Stack name</Label>
                <Input
                  id="rename-stack"
                  value={renameName}
                  maxLength={180}
                  autoFocus
                  onChange={(event) => setRenameName(event.target.value)}
                />
              </div>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={renameFolderMutation.isPending}
                  onClick={() => setRenameTarget(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={renameFolderMutation.isPending}>
                  {renameFolderMutation.isPending && (
                    <LoaderCircle className="animate-spin" />
                  )}
                  Rename stack
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!deleteTarget}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !deleteFolderMutation.isPending) {
              setDeleteTarget(null);
              setDeleteConfirmation("");
            }
          }}
        >
          <DialogContent className="rounded-3xl p-6 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                Delete stack?
              </DialogTitle>
              <DialogDescription>
                This permanently deletes “{deleteTarget?.name}” and everything
                nested inside it.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 rounded-2xl border bg-card p-4 text-sm">
              {deleteSummaryQuery.isPending ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  Checking everything inside…
                </div>
              ) : deleteSummaryQuery.isError ? (
                <div>
                  <p className="text-muted-foreground">
                    The stack contents could not be checked.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => deleteSummaryQuery.refetch()}
                  >
                    Check again
                  </Button>
                </div>
              ) : (
                <div>
                  <p className="font-medium">This will permanently remove:</p>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    <li>
                      {deleteSummary?.descendantBookCount ?? 0}{" "}
                      {(deleteSummary?.descendantBookCount ?? 0) === 1
                        ? "book"
                        : "books"}
                    </li>
                    <li>
                      {deleteSummary?.descendantStackCount ?? 0}{" "}
                      {(deleteSummary?.descendantStackCount ?? 0) === 1
                        ? "nested stack"
                        : "nested stacks"}
                    </li>
                  </ul>
                  <p className="mt-3 text-muted-foreground">
                    PDFs, generated images, highlights, notes, and RAG data are
                    included.
                  </p>
                </div>
              )}
            </div>
            <div className="mt-4 space-y-2">
              <Label htmlFor="confirm-stack-delete">
                Type <span className="font-semibold">{deleteTarget?.name}</span>{" "}
                to confirm
              </Label>
              <Input
                id="confirm-stack-delete"
                value={deleteConfirmation}
                autoComplete="off"
                disabled={deleteFolderMutation.isPending}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="ghost"
                disabled={deleteFolderMutation.isPending}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmation("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!canDeleteStack || deleteFolderMutation.isPending}
                onClick={() =>
                  deleteTarget &&
                  deleteFolderMutation.mutate({
                    id: deleteTarget.id,
                    confirmation: deleteConfirmation,
                  })
                }
              >
                {deleteFolderMutation.isPending && (
                  <LoaderCircle className="animate-spin" />
                )}
                Delete stack
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!deleteBookTarget}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !deleteBookMutation.isPending)
              setDeleteBookTarget(null);
          }}
        >
          <DialogContent className="rounded-3xl p-6 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                Delete book?
              </DialogTitle>
              <DialogDescription>
                This permanently removes “{deleteBookTarget?.title}”, its PDF,
                generated images, highlights, notes, and search index.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="ghost"
                disabled={deleteBookMutation.isPending}
                onClick={() => setDeleteBookTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteBookMutation.isPending}
                onClick={() =>
                  deleteBookTarget &&
                  deleteBookMutation.mutate(deleteBookTarget.id)
                }
              >
                {deleteBookMutation.isPending && (
                  <LoaderCircle className="animate-spin" />
                )}
                Delete book
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!moveTarget}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !moveBookMutation.isPending) {
              setMoveTarget(null);
              setMoveDestination(null);
            }
          }}
        >
          <DialogContent className="rounded-3xl p-6 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                Move book
              </DialogTitle>
              <DialogDescription>
                Choose where to keep “{moveTarget?.title}”.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <FolderDestinationPicker
                options={folderOptions}
                value={moveDestination}
                currentId={folderId}
                isPending={folderTreeQuery.isPending}
                isError={folderTreeQuery.isError}
                onChange={setMoveDestination}
                onRetry={() => void folderTreeQuery.refetch()}
              />
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMoveTarget(null)}
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
                onClick={() =>
                  moveTarget &&
                  moveBookMutation.mutate({
                    bookId: moveTarget.id,
                    destinationId: moveDestination,
                  })
                }
              >
                {moveBookMutation.isPending && (
                  <LoaderCircle className="animate-spin" />
                )}
                Move book
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!moveStackTarget}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !moveStackMutation.isPending) {
              setMoveStackTarget(null);
              setMoveStackDestination(null);
            }
          }}
        >
          <DialogContent className="rounded-3xl p-6 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-3xl font-semibold tracking-[-0.04em]">
                Move stack
              </DialogTitle>
              <DialogDescription>
                Choose where to place “{moveStackTarget?.name}”.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <FolderDestinationPicker
                options={moveStackOptions}
                value={moveStackDestination}
                currentId={moveStackTarget?.parentId ?? null}
                isPending={folderTreeQuery.isPending}
                isError={folderTreeQuery.isError}
                onChange={setMoveStackDestination}
                onRetry={() => void folderTreeQuery.refetch()}
              />
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMoveStackTarget(null)}
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
                onClick={() =>
                  moveStackTarget &&
                  moveStackMutation.mutate({
                    stackId: moveStackTarget.id,
                    destinationId: moveStackDestination,
                  })
                }
              >
                {moveStackMutation.isPending && (
                  <LoaderCircle className="animate-spin" />
                )}
                Move stack
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
            id="shelf-target"
            data={{ type: "shelf-target", id: "shelf" }}
            className="rounded-md"
          >
            <button
              type="button"
              className="px-1 font-medium text-foreground hover:text-brand-ink"
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
              <span key={folder.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="size-3.5 shrink-0" />
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
        ) : visibleFolders.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 py-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {visibleFolders.map((folder) => (
              <DraggableDropTarget
                key={folder.id}
                id={`stack:${folder.id}`}
                data={{ type: "stack", id: folder.id }}
                dropId={`stack-target:${folder.id}`}
                dropData={{ type: "stack-target", id: folder.id }}
                className="flex min-w-0 items-center gap-1 rounded-xl border bg-card p-2"
              >
                {(handleRef) => (
                  <>
                    <button
                      ref={handleRef}
                      type="button"
                      data-drag-handle
                      aria-label={`Drag ${folder.name}`}
                      className="grid size-7 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    >
                      <GripVertical className="size-4" />
                    </button>
                    <Link
                      href={folderHref(folder.id)}
                      scroll={false}
                      className="flex min-w-0 flex-1 items-center gap-3 p-2"
                    >
                      <FolderIcon className="size-5 shrink-0 text-brand-ink" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {folder.name}
                        </span>
                        <span className="block truncate text-[0.65rem] text-muted-foreground">
                          {folder.bookCount ?? 0} books ·{" "}
                          {folder.childStackCount ?? 0} stacks
                        </span>
                      </span>
                    </Link>
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
                        <DropdownMenuItem
                          onClick={() => {
                            setRenameTarget(folder);
                            setRenameName(folder.name);
                          }}
                        >
                          <Pencil />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => startMoveStack(folder)}
                        >
                          <ArrowRightLeft />
                          Move to…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            setDeleteConfirmation("");
                            setDeleteTarget(folder);
                          }}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
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
        ) : filtered.length === 0 && visibleFolders.length === 0 ? (
          <div className="my-12 flex min-h-96 flex-col items-center justify-center rounded-[2.5rem] bg-card text-center">
            <span className="grid size-14 place-items-center rounded-full bg-control">
              <FileText className="size-6 text-brand-ink" />
            </span>
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
              {search
                ? "Nothing on this shelf"
                : "Your first book belongs here"}
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
                  <DraggableItem
                    key={book.id}
                    id={`book:${book.id}`}
                    data={{ type: "book", id: book.id }}
                    className="group relative min-w-0"
                  >
                    {(handleRef) => (
                      <>
                        <button
                          ref={handleRef}
                          type="button"
                          data-drag-handle
                          aria-label={`Drag ${book.title}`}
                          className="absolute left-2 top-2 z-10 grid size-8 cursor-grab place-items-center rounded-lg bg-card/85 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </button>
                        {canRead ? (
                          <Link
                            href={`/library/${book.id}`}
                            aria-label={`Read ${book.title}`}
                          >
                            <BookCover book={book} index={index} />
                          </Link>
                        ) : (
                          <BookCover book={book} index={index} />
                        )}
                        <div className="mt-4">
                          {canRead ? (
                            <Link
                              href={`/library/${book.id}`}
                              className="flex items-start justify-between gap-2"
                            >
                              <h2 className="truncate font-semibold">
                                {book.title}
                              </h2>
                              <ArrowRight className="mt-0.5 size-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                            </Link>
                          ) : (
                            <h2 className="truncate font-semibold">
                              {book.title}
                            </h2>
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
                              {canRead
                                ? "Retry search index"
                                : "Resume preparation"}
                            </Button>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Actions for ${book.title}`}
                                className="absolute right-2 top-2 bg-card/85 opacity-0 backdrop-blur-sm group-hover:opacity-100 focus-visible:opacity-100"
                              />
                            }
                          >
                            <Ellipsis />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem
                              onClick={() => startMoveBook(book)}
                            >
                              <FolderIcon />
                              Move to…
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteBookTarget(book)}
                            >
                              <Trash2 />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </DraggableItem>
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
    </DragDropProvider>
  );
}
