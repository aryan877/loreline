import { AppHeader } from "@/components/app/app-header";
import { LibraryView } from "@/components/library/library-view";
import { getCurrentUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function LibraryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/library");

  return (
    <div className="min-h-screen bg-background">
      <AppHeader user={user} />
      <LibraryView />
    </div>
  );
}
