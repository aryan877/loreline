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
  width: number;
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
  return Array.from(clientRects)
    .map((rect) => {
      const left = Math.max(pageRect.left, rect.left);
      const top = Math.max(pageRect.top, rect.top);
      const right = Math.min(pageRect.right, rect.right);
      const bottom = Math.min(pageRect.bottom, rect.bottom);
      return {
        x: (left - pageRect.left) / pageRect.width,
        y: (top - pageRect.top) / pageRect.height,
        width: (right - left) / pageRect.width,
        height: (bottom - top) / pageRect.height,
      };
    })
    .filter((rect) => rect.width > 0.001 && rect.height > 0.001)
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
          className="absolute animate-pulse rounded-[0.16rem] bg-coral/30 ring-1 ring-coral/55 mix-blend-multiply"
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
  width,
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
  const [attempt, setAttempt] = useState(0);
  const [failedPage, setFailedPage] = useState<{
    fileUrl: string;
    page: number;
  } | null>(null);
  const [textLayerPage, setTextLayerPage] = useState<number | null>(null);
  const hasError =
    failedPage?.fileUrl === fileUrl && failedPage.page === page;

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
        style={{ width, minHeight: width * 1.3 }}
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
      onMouseMove={(event) => {
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
      onMouseUp={() => {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const pageNode = pageRef.current;
        if (!selection || !range || !pageNode) return onSelectionChange(null);
        const text = selection
          .toString()
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 4000);
        if (!text || !pageNode.contains(range.commonAncestorContainer))
          return onSelectionChange(null);
        const rects = normalizedRects(
          Array.from(range.getClientRects()),
          pageNode.getBoundingClientRect(),
        );
        onSelectionChange(rects.length ? { page, text, rects } : null);
      }}
    >
      <Document
        key={attempt}
        file={fileUrl}
        options={pdfOptions}
        loading={
          <div
            style={{ width, minHeight: width * 1.3 }}
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
          width={width * zoom}
          renderAnnotationLayer={false}
          onRenderError={loadError}
          onRenderSuccess={handlePageRender}
          onGetTextSuccess={handleTextSuccess}
          onRenderTextLayerSuccess={handleTextLayerRender}
        />
      </Document>
      <HighlightLayer highlights={highlights} activeFocus={activeFocus} />
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
