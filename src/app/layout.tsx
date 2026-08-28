import type { Metadata } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";

import { LocaleProvider } from "@/lib/i18n/context";

import "./globals.css";

const displayFont = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CCMax 控制台",
  description: "CCMax 授权上号与多平台接入控制台",
};

// Applies the saved theme before first paint so there is no light/dark flash.
const themeScript = `(function(){try{var t=localStorage.getItem("ccmax-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${displayFont.variable} ${monoFont.variable}`}>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
