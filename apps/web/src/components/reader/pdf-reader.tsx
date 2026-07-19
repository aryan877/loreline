"use client";

import { LoaderCircle, MousePointer2, RefreshCw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Document, Page } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/TextLayer.css";
import type { Highlight } from "@loreline/contracts/highlights";
import type {
  HighlightRect,
  PointerContext,
} from "@loreline/contracts/domain/reader";
import type {
  ReaderControls,
  ReaderFocus,
  ReaderFocusRequest,
  ReaderSelection,
  VoiceState,
} from "@loreline/contracts/reader";
import { Button } from "@/components/ui/button";
import {
  ReaderStateAura,
  ReadingAura,
  type ReaderAuraMode,
  type ReaderInspectionTarget,
} from "./reading-aura";
import {
  findMatchingTextRange,
  normalizePdfText,
  sentenceTextRanges,
} from "@/lib/pdf-text";
import { PDF_DOCUMENT_OPTIONS } from "@/lib/pdfjs-client";

const REALTIME_IMAGE_MAX_DATA_URL_LENGTH = 120_000;
const REALTIME_IMAGE_WIDTHS = [960, 768, 640, 512, 384] as const;
const REALTIME_IMAGE_QUALITIES = [0.62, 0.5, 0.4, 0.3] as const;

function drawPointerMarker(
  context: CanvasRenderingContext2D,
  pointer: NonNullable<PointerContext>,
  width: number,
  height: number,
) {
  const x = pointer.x * width;
  const y = pointer.y * height;
  const radius = Math.max(9, Math.min(18, width * 0.018));
  const rootStyles = context.canvas.ownerDocument.defaultView?.getComputedStyle(
    context.canvas.ownerDocument.documentElement,
  );
  const accent =
    rootStyles?.getPropertyValue("--primary").trim() || "CanvasText";
  const background =
    rootStyles?.getPropertyValue("--background").trim() || "Canvas";
  const foreground =
    rootStyles?.getPropertyValue("--foreground").trim() || "CanvasText";

  context.save();
  context.beginPath();
  context.arc(x, y, radius + 3, 0, Math.PI * 2);
  context.fillStyle = background;
  context.fill();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = accent;
  context.fill();
  context.strokeStyle = foreground;
  context.lineWidth = Math.max(2, radius * 0.16);
  context.stroke();
  context.beginPath();
  context.moveTo(x - radius * 0.62, y);
  context.lineTo(x + radius * 0.62, y);
  context.moveTo(x, y - radius * 0.62);
  context.lineTo(x, y + radius * 0.62);
  context.stroke();
  context.restore();
}

function captureRealtimePageImage(
  source: HTMLCanvasElement,
  pointer: PointerContext,
) {
  if (!source.width || !source.height) return null;

  const output = source.ownerDocument.createElement("canvas");
  const context = output.getContext("2d", { alpha: false });
  if (!context) return null;

  const widths = [
    ...new Set(
      REALTIME_IMAGE_WIDTHS.map((width) =>
        Math.max(1, Math.min(width, source.width)),
      ),
    ),
  ];
  for (const width of widths) {
    output.width = width;
    output.height = Math.max(
      1,
      Math.round((source.height / source.width) * width),
    );
    context.drawImage(source, 0, 0, output.width, output.height);
    if (pointer)
      drawPointerMarker(context, pointer, output.width, output.height);
    for (const quality of REALTIME_IMAGE_QUALITIES) {
      const image = output.toDataURL("image/jpeg", quality);
      if (image.length <= REALTIME_IMAGE_MAX_DATA_URL_LENGTH) return image;
    }
  }
  return null;
}

type PdfReaderProps = {
  fileUrl: string;
  page: number;
  viewport: { width: number; height: number };
  zoom: number;
  voiceState: VoiceState;
  highlights: Highlight[];
  selection: ReaderSelection | null;
  activeFocus: ReaderFocus | null;
  focusRequest: ReaderFocusRequest | null;
  onDocumentReady: (document: PDFDocumentProxy) => void;
  onVisibleTextChange: (text: string) => void;
  onPageCaptureReady: (
    capture: ReaderControls["capturePageImage"] | null,
  ) => void;
  onPointerChange: (pointer: PointerContext) => void;
  onSelectionChange: (selection: ReaderSelection | null) => void;
  onFocusResolved: (
    request: ReaderFocusRequest,
    rects: HighlightRect[],
  ) => void;
};

function normalizedRects(
  clientRects: Iterable<DOMRect>,
  pageRect: DOMRect,
): HighlightRect[] {
  const clipped = Array.from(clientRects)
    .map((rect) => ({
      left: Math.max(pageRect.left, rect.left),
      top: Math.max(pageRect.top, rect.top),
      right: Math.min(pageRect.right, rect.right),
      bottom: Math.min(pageRect.bottom, rect.bottom),
    }))
    .filter(
      (rect) => rect.right - rect.left > 0.5 && rect.bottom - rect.top > 0.5,
    )
    .sort((left, right) => left.top - right.top || left.left - right.left);

  const lines: typeof clipped = [];
  for (const rect of clipped) {
    const line = lines.at(-1);
    if (!line) {
      lines.push(rect);
      continue;
    }

    const overlap =
      Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top);
    const lineHeight = line.bottom - line.top;
    const rectHeight = rect.bottom - rect.top;
    const gap = Math.max(0, rect.left - line.right, line.left - rect.right);
    const sameLine =
      overlap / Math.min(lineHeight, rectHeight) >= 0.55 &&
      gap <= Math.max(4, Math.max(lineHeight, rectHeight) * 1.5);

    if (sameLine) {
      line.left = Math.min(line.left, rect.left);
      line.top = Math.min(line.top, rect.top);
      line.right = Math.max(line.right, rect.right);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else {
      lines.push(rect);
    }
  }

  return lines
    .map((rect) => ({
      x: (rect.left - pageRect.left) / pageRect.width,
      y: (rect.top - pageRect.top) / pageRect.height,
      width: (rect.right - rect.left) / pageRect.width,
      height: (rect.bottom - rect.top) / pageRect.height,
    }))
    .map((rect) => ({
      x: Number(rect.x.toFixed(6)),
      y: Number(rect.y.toFixed(6)),
      width: Number(rect.width.toFixed(6)),
      height: Number(rect.height.toFixed(6)),
    }));
}

type TextSpanEntry = {
  span: HTMLElement;
  node: Text;
  start: number;
  end: number;
};

type SentenceBoundary = {
  key: string;
  start: number;
  end: number;
  text: string;
};

type TextLayerModel = {
  page: number;
  fullText: string;
  entries: TextSpanEntry[];
  entryBySpan: WeakMap<HTMLElement, TextSpanEntry>;
  sentences: SentenceBoundary[];
  selectionBySentence: Map<string, ReaderSelection>;
};

type SentenceHit = {
  key: string;
  selection: ReaderSelection;
};

function sentenceBoundaries(text: string, page: number): SentenceBoundary[] {
  return sentenceTextRanges(text).map((sentence) => ({
    ...sentence,
    key: `${page}:${sentence.start}:${sentence.end}`,
  }));
}

function buildTextLayerModel(
  pageNode: HTMLElement,
  page: number,
): TextLayerModel | null {
  const entries: TextSpanEntry[] = [];
  const entryBySpan = new WeakMap<HTMLElement, TextSpanEntry>();
  let fullText = "";
  for (const span of Array.from(
    pageNode.querySelectorAll<HTMLElement>(
      ".react-pdf__Page__textContent span",
    ),
  )) {
    const node = Array.from(span.childNodes).find(
      (child): child is Text => child.nodeType === Node.TEXT_NODE,
    );
    const text = node?.data ?? "";
    if (!node || !text) continue;
    if (fullText) fullText += " ";
    const entry = {
      span,
      node,
      start: fullText.length,
      end: fullText.length + text.length,
    };
    fullText += text;
    entries.push(entry);
    entryBySpan.set(span, entry);
  }
  if (!entries.length || !fullText.trim()) return null;
  return {
    page,
    fullText,
    entries,
    entryBySpan,
    sentences: sentenceBoundaries(fullText, page),
    selectionBySentence: new Map(),
  };
}

function entryAtOffset(
  entries: TextSpanEntry[],
  offset: number,
): TextSpanEntry | null {
  return (
    entries.find((entry) => offset >= entry.start && offset < entry.end) ??
    entries.find((entry) => entry.start > offset) ??
    entries.at(-1) ??
    null
  );
}

function sentenceAtPoint(
  pageNode: HTMLElement,
  model: TextLayerModel | null,
  target: HTMLElement,
  clientX: number,
  clientY: number,
): SentenceHit | null {
  if (!model) return null;
  const entry = model.entryBySpan.get(target);
  if (!entry) return null;
  const caret = document.caretPositionFromPoint(clientX, clientY);
  const targetRect = target.getBoundingClientRect();
  const estimatedOffset = Math.round(
    Math.max(
      0,
      Math.min(
        entry.node.length,
        ((clientX - targetRect.left) / Math.max(1, targetRect.width)) *
          entry.node.length,
      ),
    ),
  );
  const localOffset =
    caret?.offsetNode === entry.node ? caret.offset : estimatedOffset;
  const textOffset = Math.min(entry.end - 1, entry.start + localOffset);
  const sentence =
    model.sentences.find(
      (candidate) =>
        textOffset >= candidate.start && textOffset < candidate.end,
    ) ?? null;
  if (!sentence) return null;
  const cachedSelection = model.selectionBySentence.get(sentence.key);
  if (cachedSelection) return { key: sentence.key, selection: cachedSelection };
  const startEntry = entryAtOffset(model.entries, sentence.start);
  const endEntry = entryAtOffset(model.entries, sentence.end - 1);
  if (!startEntry || !endEntry) return null;

  const range = document.createRange();
  range.setStart(
    startEntry.node,
    Math.max(
      0,
      Math.min(startEntry.node.length, sentence.start - startEntry.start),
    ),
  );
  range.setEnd(
    endEntry.node,
    Math.max(0, Math.min(endEntry.node.length, sentence.end - endEntry.start)),
  );
  const rects = normalizedRects(
    Array.from(range.getClientRects()),
    pageNode.getBoundingClientRect(),
  );
  if (!rects.length) return null;
  const selection = { page: model.page, text: sentence.text, rects };
  model.selectionBySentence.set(sentence.key, selection);
  return { key: sentence.key, selection };
}

function entryIndexForBoundary(entries: TextSpanEntry[], node: Node) {
  return entries.findIndex(
    (entry) => entry.node === node || entry.span.contains(node),
  );
}

function boundaryOffsetInEntry(
  entry: TextSpanEntry,
  container: Node,
  offset: number,
  fallback: number,
) {
  if (container === entry.node)
    return Math.max(0, Math.min(entry.node.length, offset));
  if (container === entry.span) {
    const textNodeIndex = Array.from(entry.span.childNodes).indexOf(entry.node);
    return offset <= textNodeIndex ? 0 : entry.node.length;
  }
  if (!entry.span.contains(container)) return fallback;
  try {
    const prefix = document.createRange();
    prefix.setStart(entry.node, 0);
    prefix.setEnd(container, offset);
    return Math.max(0, Math.min(entry.node.length, prefix.toString().length));
  } catch {
    return fallback;
  }
}

function textFromNativeRange(model: TextLayerModel, range: Range) {
  const startIndex = entryIndexForBoundary(
    model.entries,
    range.startContainer,
  );
  const endIndex = entryIndexForBoundary(model.entries, range.endContainer);
  if (startIndex < 0 || endIndex < startIndex) return range.toString();

  return model.entries
    .slice(startIndex, endIndex + 1)
    .map((entry, index, selectedEntries) => {
      const startOffset =
        index === 0
          ? boundaryOffsetInEntry(
              entry,
              range.startContainer,
              range.startOffset,
              0,
            )
          : 0;
      const endOffset =
        index === selectedEntries.length - 1
          ? boundaryOffsetInEntry(
              entry,
              range.endContainer,
              range.endOffset,
              entry.node.length,
            )
          : entry.node.length;
      return entry.node.data.slice(startOffset, endOffset);
    })
    .join(" ");
}

function selectionFromNativeRange(
  pageNode: HTMLElement,
  model: TextLayerModel | null,
  range: Range,
): ReaderSelection | null {
  if (
    !model ||
    range.collapsed ||
    !pageNode.contains(range.startContainer) ||
    !pageNode.contains(range.endContainer)
  )
    return null;
  const text = textFromNativeRange(model, range).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const rects = normalizedRects(
    Array.from(range.getClientRects()),
    pageNode.getBoundingClientRect(),
  );
  if (!rects.length) return null;
  return { page: model.page, text, rects };
}

function HighlightLayer({
  highlights,
  selection,
  activeFocus,
}: {
  highlights: Highlight[];
  selection: ReaderSelection | null;
  activeFocus: ReaderFocus | null;
}) {
  const foregroundPassages = new Set(
    [selection?.text, activeFocus?.text]
      .filter((text): text is string => Boolean(text))
      .map(normalizePdfText),
  );
  const backgroundHighlights = highlights.filter(
    (highlight) =>
      highlight.id !== activeFocus?.id &&
      !foregroundPassages.has(normalizePdfText(highlight.text)),
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {backgroundHighlights.flatMap((highlight) =>
        highlight.rects.map((rect, index) => (
          <span
            key={`${highlight.id}-${index}`}
            className="absolute rounded-[0.16rem] bg-reader-highlight/55 mix-blend-multiply"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
          />
        )),
      )}
      {selection?.rects.map((rect, index) => (
        <span
          key={`current-selection-${index}`}
          className="absolute rounded-[0.16rem] bg-reader-highlight/45 mix-blend-multiply"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        />
      ))}
      {activeFocus?.rects.map((rect, index) => (
        <span
          key={`${activeFocus.id}-${index}`}
          data-reader-focus={index === 0 ? "true" : undefined}
          className="pdf-reader-focus absolute rounded-[0.16rem]"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

export default function PdfReader({
  fileUrl,
  page,
  viewport,
  zoom,
  voiceState,
  highlights,
  selection,
  activeFocus,
  focusRequest,
  onDocumentReady,
  onVisibleTextChange,
  onPageCaptureReady,
  onPointerChange,
  onSelectionChange,
  onFocusResolved,
}: PdfReaderProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const zoomSnapshotRef = useRef<HTMLCanvasElement>(null);
  const pointerVisualRef = useRef<HTMLSpanElement>(null);
  const snapshotVisibleRef = useRef(false);
  const snapshotReleaseFrameRef = useRef<number | null>(null);
  const renderedPageRef = useRef<number | null>(null);
  const livePointerRef = useRef<PointerContext>(null);
  const textLayerModelRef = useRef<TextLayerModel | null>(null);
  const hoveredSentenceKeyRef = useRef<string | null>(null);
  const nativeSelectionActiveRef = useRef(false);
  const selectionFrameRef = useRef<number | null>(null);
  const inspectionTimeoutRef = useRef<number | null>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const [attempt, setAttempt] = useState(0);
  const [renderZoom, setRenderZoom] = useState(zoom);
  const [snapshotVisible, setSnapshotVisible] = useState(false);
  const [liveSelection, setLiveSelection] = useState<ReaderSelection | null>(
    null,
  );
  const [selectionGestureActive, setSelectionGestureActive] = useState(false);
  const [inspectionTarget, setInspectionTarget] =
    useState<ReaderInspectionTarget | null>(null);
  const [failedPage, setFailedPage] = useState<{
    fileUrl: string;
    page: number;
  } | null>(null);
  const [textLayerPage, setTextLayerPage] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<{
    fileUrl: string;
    page: number;
    width: number;
    height: number;
  } | null>(null);
  const hasError = failedPage?.fileUrl === fileUrl && failedPage.page === page;
  const currentPageSize =
    pageSize?.fileUrl === fileUrl && pageSize.page === page ? pageSize : null;
  const aspectRatio = currentPageSize
    ? currentPageSize.width / currentPageSize.height
    : 1 / Math.SQRT2;
  const fittedWidth = Math.min(viewport.width, viewport.height * aspectRatio);
  const targetWidth = Math.max(1, Math.floor(fittedWidth * zoom));
  const targetHeight = Math.max(1, Math.floor(targetWidth / aspectRatio));
  const renderWidth = Math.max(1, Math.floor(fittedWidth * renderZoom));
  const renderHeight = Math.max(1, Math.floor(renderWidth / aspectRatio));
  const renderScale = targetWidth / renderWidth;
  const auraMode: ReaderAuraMode =
    voiceState === "listening" ||
    voiceState === "thinking" ||
    voiceState === "inspecting" ||
    voiceState === "speaking"
      ? voiceState
      : "idle";

  const cancelSnapshotRelease = useCallback(() => {
    if (snapshotReleaseFrameRef.current === null) return;
    window.cancelAnimationFrame(snapshotReleaseFrameRef.current);
    snapshotReleaseFrameRef.current = null;
  }, []);

  const hideZoomSnapshot = useCallback(() => {
    cancelSnapshotRelease();
    snapshotVisibleRef.current = false;
    setSnapshotVisible(false);
  }, [cancelSnapshotRelease]);

  const releaseZoomSnapshot = useCallback(() => {
    if (!snapshotVisibleRef.current) return;
    cancelSnapshotRelease();
    snapshotReleaseFrameRef.current = window.requestAnimationFrame(() => {
      snapshotReleaseFrameRef.current = window.requestAnimationFrame(() => {
        snapshotReleaseFrameRef.current = null;
        snapshotVisibleRef.current = false;
        setSnapshotVisible(false);
      });
    });
  }, [cancelSnapshotRelease]);

  useEffect(() => cancelSnapshotRelease, [cancelSnapshotRelease]);

  const locatePassage = useCallback((passage: string) => {
    const pageNode = pageRef.current;
    const model = textLayerModelRef.current;
    if (!pageNode || !model) return [];
    const match = findMatchingTextRange(model.fullText, passage);
    if (!match) return [];
    const startEntry = entryAtOffset(model.entries, match.start);
    const endEntry = entryAtOffset(
      model.entries,
      Math.max(match.start, match.end - 1),
    );
    if (!startEntry || !endEntry) return [];
    const range = document.createRange();
    range.setStart(
      startEntry.node,
      Math.max(
        0,
        Math.min(startEntry.node.length, match.start - startEntry.start),
      ),
    );
    range.setEnd(
      endEntry.node,
      Math.max(
        0,
        Math.min(endEntry.node.length, match.end - endEntry.start),
      ),
    );
    const pageRect = pageNode.getBoundingClientRect();
    return normalizedRects(Array.from(range.getClientRects()), pageRect);
  }, []);

  useEffect(() => {
    if (!focusRequest || focusRequest.page !== page || textLayerPage !== page)
      return;
    const frame = window.requestAnimationFrame(() =>
      onFocusResolved(focusRequest, locatePassage(focusRequest.text)),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, locatePassage, onFocusResolved, page, textLayerPage]);

  useEffect(() => {
    if (!activeFocus || activeFocus.page !== page) return;
    const frame = window.requestAnimationFrame(() => {
      pageRef.current
        ?.querySelector<HTMLElement>('[data-reader-focus="true"]')
        ?.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "center",
          inline: "nearest",
        });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeFocus, page, reduceMotion]);

  const showInspectionTarget = useCallback((pointer: PointerContext) => {
    if (inspectionTimeoutRef.current !== null)
      window.clearTimeout(inspectionTimeoutRef.current);
    setInspectionTarget({
      id: crypto.randomUUID(),
      x: pointer?.x ?? 0.5,
      y: pointer?.y ?? 0.5,
      label: pointer ? "Looking here" : "Reading this page",
    });
    inspectionTimeoutRef.current = window.setTimeout(() => {
      setInspectionTarget(null);
      inspectionTimeoutRef.current = null;
    }, 2_400);
  }, []);

  useEffect(
    () => () => {
      if (inspectionTimeoutRef.current !== null)
        window.clearTimeout(inspectionTimeoutRef.current);
    },
    [],
  );

  const loadError = useCallback(() => {
    setFailedPage({ fileUrl, page });
    renderedPageRef.current = null;
    hideZoomSnapshot();
    onVisibleTextChange("");
  }, [fileUrl, hideZoomSnapshot, onVisibleTextChange, page]);

  const handlePageRender = useCallback(() => {
    renderedPageRef.current = page;
    releaseZoomSnapshot();
  }, [page, releaseZoomSnapshot]);

  const capturePageImage = useCallback<ReaderControls["capturePageImage"]>(
    ({ markPointer }) => {
      if (renderedPageRef.current !== page) return null;
      const canvas = pageRef.current?.querySelector<HTMLCanvasElement>(
        "[data-pdf-render-layer] canvas",
      );
      if (!canvas) return null;
      try {
        const pointer = livePointerRef.current;
        const dataUrl = captureRealtimePageImage(
          canvas,
          markPointer ? pointer : null,
        );
        if (!dataUrl) return null;
        if (markPointer) showInspectionTarget(pointer);
        return { dataUrl, page, pointer };
      } catch {
        return null;
      }
    },
    [page, showInspectionTarget],
  );

  useEffect(() => {
    onPageCaptureReady(capturePageImage);
    return () => onPageCaptureReady(null);
  }, [capturePageImage, onPageCaptureReady]);

  useEffect(() => {
    renderedPageRef.current = null;
    nativeSelectionActiveRef.current = false;
    window.getSelection()?.removeAllRanges();
    const frame = window.requestAnimationFrame(() => {
      setLiveSelection(null);
      setSelectionGestureActive(false);
      setInspectionTarget(null);
      hideZoomSnapshot();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fileUrl, hideZoomSnapshot, page]);

  useEffect(() => {
    if (zoom === renderZoom) return;
    const timeout = window.setTimeout(() => {
      cancelSnapshotRelease();
      const source = pageRef.current?.querySelector<HTMLCanvasElement>(
        "[data-pdf-render-layer] canvas",
      );
      const snapshot = zoomSnapshotRef.current;
      if (source && snapshot && !snapshotVisibleRef.current) {
        const context = snapshot.getContext("2d", { alpha: false });
        if (context && source.width > 0 && source.height > 0) {
          snapshot.width = source.width;
          snapshot.height = source.height;
          context.drawImage(source, 0, 0);
          snapshotVisibleRef.current = true;
          setSnapshotVisible(true);
        }
      }
      setRenderZoom(zoom);
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [cancelSnapshotRelease, renderZoom, zoom]);

  const handlePageLoad = useCallback<
    NonNullable<ComponentProps<typeof Page>["onLoadSuccess"]>
  >(
    (loadedPage) => {
      const nextSize = {
        fileUrl,
        page,
        width: loadedPage.originalWidth,
        height: loadedPage.originalHeight,
      };
      setPageSize((current) =>
        current?.fileUrl === nextSize.fileUrl &&
        current.page === nextSize.page &&
        current.width === nextSize.width &&
        current.height === nextSize.height
          ? current
          : nextSize,
      );
    },
    [fileUrl, page],
  );

  const handleTextSuccess = useCallback<
    NonNullable<ComponentProps<typeof Page>["onGetTextSuccess"]>
  >(
    (content) =>
      onVisibleTextChange(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 16000),
      ),
    [onVisibleTextChange],
  );

  const handleTextLayerRender = useCallback(() => {
    const pageNode = pageRef.current;
    textLayerModelRef.current = pageNode
      ? buildTextLayerModel(pageNode, page)
      : null;
    livePointerRef.current = null;
    hoveredSentenceKeyRef.current = null;
    nativeSelectionActiveRef.current = false;
    setLiveSelection(null);
    setSelectionGestureActive(false);
    onPointerChange(null);
    setTextLayerPage(page);
  }, [onPointerChange, page]);

  useEffect(() => {
    const readNativeSelection = () => {
      if (!nativeSelectionActiveRef.current) return;
      if (selectionFrameRef.current !== null) return;
      selectionFrameRef.current = window.requestAnimationFrame(() => {
        selectionFrameRef.current = null;
        const pageNode = pageRef.current;
        const nativeSelection = window.getSelection();
        if (!pageNode || !nativeSelection || nativeSelection.rangeCount === 0) {
          setLiveSelection(null);
          return;
        }
        setLiveSelection(
          selectionFromNativeRange(
            pageNode,
            textLayerModelRef.current,
            nativeSelection.getRangeAt(0),
          ),
        );
      });
    };
    document.addEventListener("selectionchange", readNativeSelection);
    return () => {
      document.removeEventListener("selectionchange", readNativeSelection);
      if (selectionFrameRef.current !== null)
        window.cancelAnimationFrame(selectionFrameRef.current);
      selectionFrameRef.current = null;
    };
  }, []);

  const finishNativeSelection = useCallback(() => {
    if (!nativeSelectionActiveRef.current) return;
    nativeSelectionActiveRef.current = false;
    setSelectionGestureActive(false);
    const pageNode = pageRef.current;
    const nativeSelection = window.getSelection();
    if (!pageNode || !nativeSelection || nativeSelection.rangeCount === 0) {
      onSelectionChange(null);
      return;
    }
    const nextSelection = selectionFromNativeRange(
      pageNode,
      textLayerModelRef.current,
      nativeSelection.getRangeAt(0),
    );
    setLiveSelection(nextSelection);
    onPointerChange(livePointerRef.current);
    onSelectionChange(nextSelection);
  }, [onPointerChange, onSelectionChange]);

  useEffect(() => {
    const cancelNativeSelection = () => {
      nativeSelectionActiveRef.current = false;
      setSelectionGestureActive(false);
    };
    window.addEventListener("mouseup", finishNativeSelection);
    window.addEventListener("blur", cancelNativeSelection);
    return () => {
      window.removeEventListener("mouseup", finishNativeSelection);
      window.removeEventListener("blur", cancelNativeSelection);
    };
  }, [finishNativeSelection]);

  const updatePointerAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const pageNode = pageRef.current;
      if (!pageNode) return;
      const rect = pageNode.getBoundingClientRect();
      const element = document.elementFromPoint(clientX, clientY);
      const candidate = element?.closest<HTMLElement>(
        ".react-pdf__Page__textContent span",
      );
      const span = candidate && pageNode.contains(candidate) ? candidate : null;
      const hit =
        span && !nativeSelectionActiveRef.current
          ? sentenceAtPoint(
              pageNode,
              textLayerModelRef.current,
              span,
              clientX,
              clientY,
            )
          : null;
      livePointerRef.current = {
        x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
        text: hit?.selection.text.slice(0, 320) || undefined,
      };
      if (pointerVisualRef.current) {
        pointerVisualRef.current.style.opacity = "1";
        pointerVisualRef.current.style.transform = `translate3d(${clientX - rect.left}px, ${clientY - rect.top}px, 0)`;
      }

      if (nativeSelectionActiveRef.current) return;
      if (hit?.key === hoveredSentenceKeyRef.current) return;
      hoveredSentenceKeyRef.current = hit?.key ?? null;
      onPointerChange(livePointerRef.current);
    },
    [onPointerChange],
  );

  if (hasError)
    return (
      <div
        style={{ width: targetWidth, height: targetHeight }}
        className="grid place-items-center bg-reader-paper p-8"
      >
        <div className="max-w-sm text-center">
          <p className="font-display text-2xl font-semibold">
            This page couldn’t be rendered.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-reader-muted">
            The PDF may be locked, damaged, or temporarily unavailable.
          </p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => {
              setFailedPage(null);
              setAttempt((value) => value + 1);
            }}
          >
            <RefreshCw />
            Retry page
          </Button>
        </div>
      </div>
    );

  return (
    <div
      style={{ width: targetWidth, height: targetHeight }}
      className="pdf-reader-shell relative mx-auto w-fit"
    >
      <ReaderStateAura mode={auraMode} />
      <div
        ref={pageRef}
        className="pdf-reader-surface relative z-10 size-full cursor-none select-text overflow-hidden bg-card shadow-float"
        onMouseMove={(event) =>
          updatePointerAtPoint(event.clientX, event.clientY)
        }
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          nativeSelectionActiveRef.current = true;
          setLiveSelection(null);
          setSelectionGestureActive(true);
          onSelectionChange(null);
        }}
        onMouseLeave={() => {
          if (pointerVisualRef.current)
            pointerVisualRef.current.style.opacity = "0";
          livePointerRef.current = null;
          hoveredSentenceKeyRef.current = null;
          onPointerChange(null);
        }}
      >
        <div
          data-pdf-render-layer="true"
          className="absolute left-0 top-0 origin-top-left will-change-transform"
          style={{
            width: renderWidth,
            height: renderHeight,
            transform: `scale(${renderScale})`,
          }}
        >
          <Document
            key={attempt}
            file={fileUrl}
            options={PDF_DOCUMENT_OPTIONS}
            loading={
              <div
                style={{ width: renderWidth, height: renderHeight }}
                className="grid place-items-center bg-reader-paper"
              >
                <LoaderCircle className="size-5 animate-spin text-coral" />
              </div>
            }
            onLoadSuccess={(document) => {
              setFailedPage(null);
              onDocumentReady(document);
            }}
            onLoadError={loadError}
            onSourceError={loadError}
          >
            <Page
              pageNumber={page}
              width={renderWidth}
              renderAnnotationLayer={false}
              onLoadSuccess={handlePageLoad}
              onRenderError={loadError}
              onRenderSuccess={handlePageRender}
              onGetTextSuccess={handleTextSuccess}
              onRenderTextLayerSuccess={handleTextLayerRender}
            />
          </Document>
        </div>
        <canvas
          ref={zoomSnapshotRef}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 z-[3] size-full will-change-[opacity] ${
            snapshotVisible
              ? "opacity-100"
              : reduceMotion
                ? "opacity-0"
                : "opacity-0 transition-opacity duration-75"
          }`}
        />
        <ReadingAura mode={auraMode} inspectionTarget={inspectionTarget} />
        <HighlightLayer
          highlights={highlights}
          selection={selectionGestureActive ? liveSelection : selection}
          activeFocus={activeFocus}
        />
        <span
          ref={pointerVisualRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 z-20 opacity-0 transition-opacity duration-100"
        >
          <MousePointer2 className="size-5 fill-gold text-foreground drop-shadow-md" />
        </span>
      </div>
    </div>
  );
}
