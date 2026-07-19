"use client";

import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import { PDF_DOCUMENT_OPTIONS } from "@/lib/pdfjs-client";

function PreviewPlaceholder({ failed = false }: { failed?: boolean }) {
  return (
    <div className="grid size-full place-items-center bg-control text-muted-foreground">
      <div className="flex flex-col items-center gap-2 text-center">
        <FileText className="size-6 opacity-55" />
        {failed ? (
          <span className="text-[0.65rem] font-medium">Preview unavailable</span>
        ) : (
          <span className="h-1.5 w-14 animate-pulse rounded-full bg-muted" />
        )}
      </div>
    </div>
  );
}

export default function BookThumbnail({
  bookId,
  title,
}: {
  bookId: string;
  title: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "320px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="size-full bg-reader-paper [&_.react-pdf__Document]:size-full [&_.react-pdf__Page]:size-full [&_.react-pdf__Page]:grid [&_.react-pdf__Page]:place-items-center [&_canvas]:!h-full [&_canvas]:!w-full [&_canvas]:object-contain"
    >
      {!visible || failed ? (
        <PreviewPlaceholder failed={failed} />
      ) : (
        <Document
          file={`/api/books/${bookId}/file`}
          options={PDF_DOCUMENT_OPTIONS}
          loading={<PreviewPlaceholder />}
          error={<PreviewPlaceholder failed />}
          onLoadError={() => setFailed(true)}
        >
          <Page
            pageNumber={1}
            width={420}
            devicePixelRatio={1}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={<PreviewPlaceholder />}
            aria-label={`First page of ${title}`}
          />
        </Document>
      )}
    </div>
  );
}
