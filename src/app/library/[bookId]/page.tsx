import { ReaderWorkspace } from "@/components/reader/reader-workspace";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;
  return <ReaderWorkspace bookId={bookId} />;
}
