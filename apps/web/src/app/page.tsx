import { HomePage } from "@/components/marketing/home-page";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  return <HomePage user={user} />;
}
