import { AppHeader } from "@/components/app/app-header";
import { LibraryView } from "@/components/library/library-view";
import { getCurrentUser } from "@/lib/session";

export default async function LibraryPage() {
  const user = await getCurrentUser();
  return (
    <div className="min-h-screen bg-background">
      <AppHeader user={user!} />
      <LibraryView />
    </div>
  );
}
