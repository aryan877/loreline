import { headers } from "next/headers";
import { AppHeader } from "@/components/app/app-header";
import { LibraryView } from "@/components/library/library-view";
import { auth } from "@/lib/auth";

export default async function LibraryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <div className="min-h-screen bg-background">
      <AppHeader user={session!.user} />
      <LibraryView />
    </div>
  );
}
