"use client";

import { Files, ListTree, PanelLeftClose } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Outline, Page } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function PageThumbnail({
  document,
  page,
  current,
  onSelect,
}: {
  document: PDFDocumentProxy;
  page: number;
  current: boolean;
  onSelect: (page: number) => void;
}) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { rootMargin: "240px 0px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!current) return;
    rootRef.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <button
      ref={rootRef}
      type="button"
      aria-label={`Go to page ${page}`}
      aria-current={current ? "page" : undefined}
      onClick={() => onSelect(page)}
      className={cn(
        "group/page w-full rounded-xl p-2 text-left transition-colors",
        current ? "bg-brand-soft" : "hover:bg-control",
      )}
    >
      <span
        className={cn(
          "block aspect-[1/1.414] overflow-hidden rounded-md border bg-reader-paper shadow-sm ring-offset-2 transition-shadow [&_.react-pdf__Page]:!bg-transparent [&_canvas]:!h-auto [&_canvas]:!w-full",
          current && "ring-2 ring-brand-ink",
        )}
      >
        {visible ? (
          <Page
            pdf={document}
            pageNumber={page}
            width={128}
            devicePixelRatio={1}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={
              <span className="block size-full animate-pulse bg-control" />
            }
          />
        ) : (
          <span className="block size-full bg-control" />
        )}
      </span>
      <span
        className={cn(
          "mt-1.5 block text-center font-mono text-[0.62rem]",
          current ? "font-semibold text-brand-ink" : "text-muted-foreground",
        )}
      >
        {page}
      </span>
    </button>
  );
}

function ChapterNavigator({
  document,
  onSelect,
}: {
  document: PDFDocumentProxy;
  onSelect: (page: number) => void;
}) {
  const [outlineStatus, setOutlineStatus] = useState<
    "loading" | "available" | "empty"
  >("loading");

  return (
    <div className="relative min-h-full">
      <Outline
        pdf={document}
        onItemClick={({ pageNumber }) => onSelect(pageNumber)}
        onLoadSuccess={(outline) =>
          setOutlineStatus(outline?.length ? "available" : "empty")
        }
        onLoadError={() => setOutlineStatus("empty")}
        className="[&_a]:block [&_a]:rounded-lg [&_a]:px-2.5 [&_a]:py-2 [&_a]:text-xs [&_a]:font-medium [&_a]:leading-snug [&_a]:text-foreground [&_a]:transition-colors hover:[&_a]:bg-control [&_li]:mt-0.5 [&_ul_ul]:ml-3 [&_ul_ul]:border-l [&_ul_ul]:pl-1"
      />
      {outlineStatus === "loading" ? (
        <div className="space-y-2 p-2">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="h-8 animate-pulse rounded-lg bg-control"
            />
          ))}
        </div>
      ) : null}
      {outlineStatus === "empty" ? (
        <div className="px-3 py-10 text-center">
          <ListTree className="mx-auto mb-3 size-5 text-muted-foreground" />
          <p className="text-xs font-semibold">No chapters embedded</p>
          <p className="mt-1 text-[0.68rem] leading-relaxed text-muted-foreground">
            This PDF does not include outline metadata.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function PageNavigator({
  document,
  page,
  totalPages,
  onSelect,
  onClose,
}: {
  document: PDFDocumentProxy | null;
  page: number;
  totalPages: number;
  onSelect: (page: number) => void;
  onClose: () => void;
}) {
  return (
    <aside className="absolute inset-y-0 left-0 z-30 flex w-56 shrink-0 flex-col border-r bg-background shadow-panel lg:relative lg:shadow-none">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <div>
          <p className="text-xs font-semibold">Document</p>
          <p className="text-[0.62rem] text-muted-foreground">
            {totalPages} total
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close page navigator"
          onClick={onClose}
        >
          <PanelLeftClose />
        </Button>
      </div>
      <Tabs defaultValue="pages" className="min-h-0 flex-1 gap-0">
        <TabsList
          variant="line"
          aria-label="Document navigation"
          className="h-10 w-full shrink-0 justify-stretch gap-0 border-b px-2"
        >
          <TabsTrigger value="pages" className="h-full rounded-none text-xs">
            <Files />
            Pages
          </TabsTrigger>
          <TabsTrigger value="chapters" className="h-full rounded-none text-xs">
            <ListTree />
            Chapters
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="pages"
          className="scrollbar-none min-h-0 overflow-y-auto p-2"
        >
          {document ? (
            Array.from({ length: totalPages }, (_, index) => index + 1).map(
              (pageNumber) => (
                <PageThumbnail
                  key={pageNumber}
                  document={document}
                  page={pageNumber}
                  current={pageNumber === page}
                  onSelect={onSelect}
                />
              ),
            )
          ) : (
            <div className="space-y-3 p-2">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className="aspect-[1/1.414] animate-pulse rounded-md bg-control"
                />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent
          value="chapters"
          className="scrollbar-none min-h-0 overflow-y-auto p-2"
        >
          {document ? (
            <ChapterNavigator
              key={document.fingerprints.join(":")}
              document={document}
              onSelect={onSelect}
            />
          ) : (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }, (_, index) => (
                <div
                  key={index}
                  className="h-8 animate-pulse rounded-lg bg-control"
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </aside>
  );
}
