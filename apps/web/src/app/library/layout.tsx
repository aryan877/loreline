import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/library");
  return <>{children}</>;
}
