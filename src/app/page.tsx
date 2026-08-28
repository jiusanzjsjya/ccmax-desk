import LoginDesk from "@/components/login-desk";
import { env } from "@/lib/env";
import { getCurrentSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getCurrentSession();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="shell">
      <div className="grain" />
      <LoginDesk configured={env.isSuperadminConfigured} />
    </main>
  );
}
