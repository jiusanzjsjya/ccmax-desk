"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    setIsLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  return (
    <button className="secondary-button" type="button" disabled={isLoggingOut} onClick={handleLogout}>
      {isLoggingOut ? "正在退出..." : "退出当前会话"}
    </button>
  );
}
