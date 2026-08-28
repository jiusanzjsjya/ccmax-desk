"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/context";

export default function LogoutButton() {
  const { t } = useI18n();
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
      {isLoggingOut ? t("正在退出...") : t("退出当前会话")}
    </button>
  );
}
