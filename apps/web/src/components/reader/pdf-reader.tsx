"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
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
import { ReadingAura, type ReaderAuraMode } from "./reading-aura";
import {
  edgeAutoScrollVelocity,
  findMatchingTextRunRange,
  sentenceTextRanges,
} from "@/lib/pdf-text";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

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
  activeFocus: ReaderFocus | null;
  focusRequest: ReaderFocusRequest | null;
  pointer: PointerContext;
  onDocumentReady: (pages: number) => void;
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

function mergeSelections(
  base: ReaderSelection | null,
  addition: ReaderSelection | null,
): ReaderSelection | null {
  if (!base) return addition;
  if (!addition || addition.page !== base.page) return base;
  const alreadyIncluded = addition.rects.every((rect) =>
    base.rects.some(
      (candidate) =>
        Math.abs(candidate.x - rect.x) < 0.0001 &&
        Math.abs(candidate.y - rect.y) < 0.0001 &&
        Math.abs(candidate.width - rect.width) < 0.0001 &&
        Math.abs(candidate.height - rect.height) < 0.0001,
    ),
  );
  if (alreadyIncluded) return base;
  const rects = [...base.rects, ...addition.rects]
    .filter(
      (rect, index, all) =>
        all.findIndex(
          (candidate) =>
            Math.abs(candidate.x - rect.x) < 0.0001 &&
            Math.abs(candidate.y - rect.y) < 0.0001 &&
            Math.abs(candidate.width - rect.width) < 0.0001 &&
            Math.abs(candidate.height - rect.height) < 0.0001,
        ) === index,
    )
    .sort((left, right) => left.y - right.y || left.x - right.x);
  return {
    page: base.page,
    text: `${base.text}\n${addition.text}`.trim(),
    rects,
  };
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

function HighlightLayer({
  highlights,
  activeFocus,
  hoverSelection,
}: {
  highlights: Highlight[];
  activeFocus: ReaderFocus | null;
  hoverSelection: ReaderSelection | null;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {highlights.flatMap((highlight) =>
        highlight.rects.map((rect, index) => (
          <span
            key={`${highlight.id}-${index}`}
            className="absolute rounded-[0.16rem] bg-reader-highlight/65 mix-blend-multiply"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
          />
        )),
      )}
      {activeFocus?.rects.map((rect, index) => (
        <span
          key={`${activeFocus.id}-${index}`}
          className={
            activeFocus.id === "current-selection"
              ? "absolute rounded-[0.16rem] bg-reader-highlight/55 mix-blend-multiply"
              : "absolute animate-pulse rounded-[0.16rem] bg-coral/30 ring-1 ring-coral/55 mix-blend-multiply"
          }
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        />
      ))}
      {hoverSelection?.rects.map((rect, index) => (
        <span
          key={`hover-sentence-${index}`}
          className="absolute rounded-[0.16rem] bg-reader-highlight/30 mix-blend-multiply"
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
  activeFocus,
  focusRequest,
  pointer,
  onDocumentReady,
  onVisibleTextChange,
  onPageCaptureReady,
  onPointerChange,
  onSelectionChange,
  onFocusResolved,
}: PdfReaderProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const zoomSnapshotRef = useRef<HTMLCanvasElement>(null);
  const snapshotVisibleRef = useRef(false);
  const renderedPageRef = useRef<number | null>(null);
  const livePointerRef = useRef<PointerContext>(null);
  const textLayerModelRef = useRef<TextLayerModel | null>(null);
  const hoveredSentenceKeyRef = useRef<string | null>(null);
  const modifierActiveRef = useRef(false);
  const modifierSelectionRef = useRef<ReaderSelection | null>(null);
  const sweptSentenceKeysRef = useRef(new Set<string>());
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollPointerRef = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [renderZoom, setRenderZoom] = useState(zoom);
  const [snapshotVisible, setSnapshotVisible] = useState(false);
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
  const [hoverSelection, setHoverSelection] = useState<ReaderSelection | null>(
    null,
  );
  const pdfOptions = useMemo(
    () => ({
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
    }),
    [],
  );
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
    voiceState === "inspecting" ||
    voiceState === "speaking"
      ? voiceState
      : "idle";

  const stopAutoScroll = useCallback(() => {
    autoScrollPointerRef.current = null;
    if (autoScrollFrameRef.current === null) return;
    window.cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = null;
  }, []);

  const hideZoomSnapshot = useCallback(() => {
    snapshotVisibleRef.current = false;
    setSnapshotVisible(false);
  }, []);

  useEffect(() => {
    const finishModifierSweep = (event: KeyboardEvent) => {
      if (event.key !== "Meta" && event.key !== "Control") return;
      modifierActiveRef.current = false;
      modifierSelectionRef.current = null;
      sweptSentenceKeysRef.current.clear();
      stopAutoScroll();
    };
    const finishOnBlur = () => {
      modifierActiveRef.current = false;
      modifierSelectionRef.current = null;
      sweptSentenceKeysRef.current.clear();
      stopAutoScroll();
    };
    window.addEventListener("keyup", finishModifierSweep);
    window.addEventListener("blur", finishOnBlur);
    return () => {
      window.removeEventListener("keyup", finishModifierSweep);
      window.removeEventListener("blur", finishOnBlur);
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  const locatePassage = useCallback((passage: string) => {
    const pageNode = pageRef.current;
    if (!pageNode) return [];
    const spans = Array.from(
      pageNode.querySelectorAll<HTMLElement>(
        ".react-pdf__Page__textContent span",
      ),
    );
    const match = findMatchingTextRunRange(
      spans.map((span) => span.textContent ?? ""),
      passage,
    );
    if (!match) return [];
    const pageRect = pageNode.getBoundingClientRect();
    return normalizedRects(
      spans
        .slice(match.start, match.end + 1)
        .map((span) => span.getBoundingClientRect()),
      pageRect,
    );
  }, []);

  useEffect(() => {
    if (!focusRequest || focusRequest.page !== page || textLayerPage !== page)
      return;
    const frame = window.requestAnimationFrame(() =>
      onFocusResolved(focusRequest, locatePassage(focusRequest.text)),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, locatePassage, onFocusResolved, page, textLayerPage]);

  const loadError = useCallback(() => {
    setFailedPage({ fileUrl, page });
    renderedPageRef.current = null;
    hideZoomSnapshot();
    onVisibleTextChange("");
  }, [fileUrl, hideZoomSnapshot, onVisibleTextChange, page]);

  const handlePageRender = useCallback(() => {
    renderedPageRef.current = page;
    hideZoomSnapshot();
  }, [hideZoomSnapshot, page]);

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
        return dataUrl ? { dataUrl, page, pointer } : null;
      } catch {
        return null;
      }
    },
    [page],
  );

  useEffect(() => {
    onPageCaptureReady(capturePageImage);
    return () => onPageCaptureReady(null);
  }, [capturePageImage, onPageCaptureReady]);

  useEffect(() => {
    renderedPageRef.current = null;
    stopAutoScroll();
    const frame = window.requestAnimationFrame(hideZoomSnapshot);
    return () => window.cancelAnimationFrame(frame);
  }, [fileUrl, hideZoomSnapshot, page, stopAutoScroll]);

  useEffect(() => {
    if (zoom === renderZoom) return;
    const timeout = window.setTimeout(() => {
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
  }, [renderZoom, zoom]);

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
    modifierActiveRef.current = false;
    modifierSelectionRef.current = null;
    sweptSentenceKeysRef.current.clear();
    setHoverSelection(null);
    onPointerChange(null);
    setTextLayerPage(page);
    stopAutoScroll();
  }, [onPointerChange, page, stopAutoScroll]);

  const updatePointerAtPoint = useCallback(
    (clientX: number, clientY: number, modifierPressed: boolean) => {
      const pageNode = pageRef.current;
      if (!pageNode) return;
      const rect = pageNode.getBoundingClientRect();
      const element = document.elementFromPoint(clientX, clientY);
      const candidate = element?.closest<HTMLElement>(
        ".react-pdf__Page__textContent span",
      );
      const span = candidate && pageNode.contains(candidate) ? candidate : null;
      const hit = span
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

      if (modifierPressed) {
        if (!modifierActiveRef.current) {
          modifierActiveRef.current = true;
          modifierSelectionRef.current =
            activeFocus?.id === "current-selection" ? activeFocus : null;
          sweptSentenceKeysRef.current.clear();
        }
        if (hit && !sweptSentenceKeysRef.current.has(hit.key)) {
          sweptSentenceKeysRef.current.add(hit.key);
          const nextSelection = mergeSelections(
            modifierSelectionRef.current,
            hit.selection,
          );
          modifierSelectionRef.current = nextSelection;
          onSelectionChange(nextSelection);
        }
      } else if (modifierActiveRef.current) {
        modifierActiveRef.current = false;
        modifierSelectionRef.current = null;
        sweptSentenceKeysRef.current.clear();
      }

      if (hit?.key === hoveredSentenceKeyRef.current) return;
      hoveredSentenceKeyRef.current = hit?.key ?? null;
      setHoverSelection(hit?.selection ?? null);
      onPointerChange(livePointerRef.current);
    },
    [activeFocus, onPointerChange, onSelectionChange],
  );

  const startAutoScroll = useCallback(
    (clientX: number, clientY: number) => {
      autoScrollPointerRef.current = { clientX, clientY };
      if (autoScrollFrameRef.current !== null) return;

      const tick = () => {
        const pointerPosition = autoScrollPointerRef.current;
        const viewportNode = pageRef.current?.closest<HTMLElement>(
          "[data-reader-viewport]",
        );
        if (!pointerPosition || !viewportNode || !modifierActiveRef.current) {
          autoScrollFrameRef.current = null;
          return;
        }

        const viewportRect = viewportNode.getBoundingClientRect();
        const velocity = edgeAutoScrollVelocity(
          pointerPosition.clientY,
          viewportRect.top,
          viewportRect.height,
        );
        if (velocity === 0) {
          autoScrollFrameRef.current = null;
          return;
        }

        const previousScrollTop = viewportNode.scrollTop;
        viewportNode.scrollTop += velocity;
        if (viewportNode.scrollTop === previousScrollTop) {
          autoScrollFrameRef.current = null;
          return;
        }
        updatePointerAtPoint(
          pointerPosition.clientX,
          pointerPosition.clientY,
          true,
        );
        autoScrollFrameRef.current = window.requestAnimationFrame(tick);
      };

      autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    },
    [updatePointerAtPoint],
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
      ref={pageRef}
      style={{ width: targetWidth, height: targetHeight }}
      className="relative mx-auto w-fit select-none overflow-hidden bg-card shadow-float"
      onMouseMove={(event) => {
        const modifierPressed = event.metaKey || event.ctrlKey;
        updatePointerAtPoint(event.clientX, event.clientY, modifierPressed);
        if (modifierPressed) {
          startAutoScroll(event.clientX, event.clientY);
        } else {
          stopAutoScroll();
        }
      }}
      onMouseDown={(event) => {
        if (event.metaKey || event.ctrlKey) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) return;
        if (activeFocus?.id !== "current-selection") return;
        onSelectionChange(null);
        hoveredSentenceKeyRef.current = null;
        setHoverSelection(null);
        window.getSelection()?.removeAllRanges();
      }}
      onMouseLeave={() => {
        livePointerRef.current = null;
        hoveredSentenceKeyRef.current = null;
        modifierActiveRef.current = false;
        modifierSelectionRef.current = null;
        sweptSentenceKeysRef.current.clear();
        stopAutoScroll();
        setHoverSelection(null);
        onPointerChange(null);
      }}
    >
      <div
        data-pdf-render-layer="true"
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: renderWidth,
          height: renderHeight,
          transform: `scale(${renderScale})`,
        }}
      >
        <Document
          key={attempt}
          file={fileUrl}
          options={pdfOptions}
          loading={
            <div
              style={{ width: renderWidth, height: renderHeight }}
              className="grid place-items-center bg-reader-paper"
            >
              <LoaderCircle className="size-5 animate-spin text-coral" />
            </div>
          }
          onLoadSuccess={({ numPages }) => {
            setFailedPage(null);
            onDocumentReady(numPages);
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
        className={`pointer-events-none absolute inset-0 z-[3] size-full transition-opacity duration-100 ${snapshotVisible ? "opacity-100" : "opacity-0"}`}
      />
      <ReadingAura mode={auraMode} />
      <HighlightLayer
        highlights={highlights}
        hoverSelection={hoverSelection}
        activeFocus={activeFocus}
      />
      {pointer && (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }}
        >
          <span className="absolute left-1 top-1 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[0.6rem] font-semibold text-primary-foreground shadow-sm">
            You&apos;re here
          </span>
        </div>
      )}
    </div>
  );
}
