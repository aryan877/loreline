"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
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
  ReaderFocus,
  ReaderFocusRequest,
  ReaderSelection,
} from "@loreline/contracts/reader";
import { Button } from "@/components/ui/button";
import { findMatchingTextRunRange } from "@/lib/pdf-text";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const pdfOptions = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
};

type PdfReaderProps = {
  fileUrl: string;
  page: number;
  viewport: { width: number; height: number };
  zoom: number;
  highlights: Highlight[];
  activeFocus: ReaderFocus | null;
  focusRequest: ReaderFocusRequest | null;
  pointer: PointerContext;
  onDocumentReady: (pages: number) => void;
  onVisibleTextChange: (text: string) => void;
  onScreenshotChange: (screenshot: string | null) => void;
  onPointerChange: (pointer: PointerContext) => void;
  onSelectionChange: (selection: ReaderSelection | null) => void;
  onFocusResolved: (request: ReaderFocusRequest, rects: HighlightRect[]) => void;
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

function HighlightLayer({
  highlights,
  activeFocus,
}: {
  highlights: Highlight[];
  activeFocus: ReaderFocus | null;
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
    </div>
  );
}

export default function PdfReader({
  fileUrl,
  page,
  viewport,
  zoom,
  highlights,
  activeFocus,
  focusRequest,
  pointer,
  onDocumentReady,
  onVisibleTextChange,
  onScreenshotChange,
  onPointerChange,
  onSelectionChange,
  onFocusResolved,
}: PdfReaderProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const selectingRef = useRef(false);
  const selectionFrameRef = useRef<number | null>(null);
  const [attempt, setAttempt] = useState(0);
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
  const [liveSelection, setLiveSelection] = useState<ReaderSelection | null>(
    null,
  );
  const hasError =
    failedPage?.fileUrl === fileUrl && failedPage.page === page;
  const currentPageSize =
    pageSize?.fileUrl === fileUrl && pageSize.page === page ? pageSize : null;
  const aspectRatio = currentPageSize
    ? currentPageSize.width / currentPageSize.height
    : 1 / Math.SQRT2;
  const fittedWidth = Math.min(
    viewport.width,
    viewport.height * aspectRatio,
  );
  const renderWidth = Math.max(1, Math.floor(fittedWidth * zoom));
  const renderHeight = Math.max(1, Math.floor(renderWidth / aspectRatio));

  const readSelection = useCallback((): ReaderSelection | null => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const pageNode = pageRef.current;
    if (!selection || !range || !pageNode) return null;
    const text = selection
      .toString()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    if (!text || !pageNode.contains(range.commonAncestorContainer)) return null;
    const rects = normalizedRects(
      Array.from(range.getClientRects()),
      pageNode.getBoundingClientRect(),
    );
    return rects.length ? { page, text, rects } : null;
  }, [page]);

  const finishSelection = useCallback(() => {
    if (!selectingRef.current) return;
    selectingRef.current = false;
    if (selectionFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionFrameRef.current);
      selectionFrameRef.current = null;
    }
    const nextSelection = readSelection();
    setLiveSelection(null);
    window.getSelection()?.removeAllRanges();
    onPointerChange(null);
    onSelectionChange(nextSelection);
  }, [onPointerChange, onSelectionChange, readSelection]);

  useEffect(() => {
    const updateLiveSelection = () => {
      if (!selectingRef.current || selectionFrameRef.current !== null) return;
      selectionFrameRef.current = window.requestAnimationFrame(() => {
        selectionFrameRef.current = null;
        setLiveSelection(readSelection());
      });
    };
    document.addEventListener("selectionchange", updateLiveSelection);
    return () => {
      document.removeEventListener("selectionchange", updateLiveSelection);
      if (selectionFrameRef.current !== null)
        window.cancelAnimationFrame(selectionFrameRef.current);
    };
  }, [readSelection]);

  useEffect(() => {
    document.addEventListener("mouseup", finishSelection);
    return () => document.removeEventListener("mouseup", finishSelection);
  }, [finishSelection]);

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
      spans.slice(match.start, match.end + 1).map((span) =>
        span.getBoundingClientRect(),
      ),
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
    onVisibleTextChange("");
    onScreenshotChange(null);
  }, [fileUrl, onScreenshotChange, onVisibleTextChange, page]);

  const handlePageRender = useCallback(() => {
    const canvas = pageRef.current?.querySelector("canvas");
    let screenshot: string | null = null;
    if (canvas) {
      try {
        screenshot = canvas.toDataURL("image/jpeg", 0.58);
      } catch {
        screenshot = null;
      }
    }
    onScreenshotChange(screenshot);
  }, [onScreenshotChange]);

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

  const handleTextLayerRender = useCallback(() => setTextLayerPage(page), [page]);

  if (hasError)
    return (
      <div
        style={{ width: renderWidth, height: renderHeight }}
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
      className="relative mx-auto w-fit overflow-hidden bg-card shadow-float"
      onMouseDown={() => {
        selectingRef.current = true;
        setLiveSelection(null);
        onPointerChange(null);
        onSelectionChange(null);
      }}
      onMouseMove={(event) => {
        if (selectingRef.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const text = element
          ?.closest(".react-pdf__Page__textContent span")
          ?.textContent?.trim();
        onPointerChange({
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
          text: text?.slice(0, 320) || undefined,
        });
      }}
      onMouseLeave={() => onPointerChange(null)}
      onMouseUp={finishSelection}
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
      <HighlightLayer
        highlights={highlights}
        activeFocus={
          liveSelection
            ? { id: "current-selection", ...liveSelection }
            : activeFocus
        }
      />
      {pointer && (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }}
        >
          <span className="absolute -left-2 -top-2 size-4 rounded-full border-2 border-card bg-coral shadow-sm" />
          <span className="absolute left-2 top-2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[0.6rem] font-semibold text-primary-foreground shadow-sm">
            You&apos;re here
          </span>
        </div>
      )}
    </div>
  );
}
