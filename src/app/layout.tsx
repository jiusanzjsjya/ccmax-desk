import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "CCMax 登录验证台",
  description: "CCMax Sub2 OAuth 登录验证与账号工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
