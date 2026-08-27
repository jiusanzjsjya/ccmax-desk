"use client";

import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

const STORAGE_KEY = "ccmax-theme";
const OPTIONS: { mode: Mode; label: string }[] = [
  { mode: "light", label: "浅色" },
  { mode: "dark", label: "深色" },
  { mode: "system", label: "系统" },
];

/** Applied before paint by the inline script in layout; mirrored here on click. */
function apply(mode: Mode) {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  // Sync the highlighted option from the client-only store after hydration.
  // Reading it in the initializer instead would mismatch the server render.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "light" || saved === "dark" || saved === "system") setMode(saved);
  }, []);

  function choose(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the choice still applies for this view.
    }
    apply(next);
  }

  return (
    <div className="theme-toggle" role="group" aria-label="配色主题">
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className={mode === option.mode ? "is-active" : ""}
          aria-pressed={mode === option.mode}
          onClick={() => choose(option.mode)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
