import { useState } from "react";
import { CommandBlock } from "./CommandBlock";

// One-line installers, served from Firebase Hosting (see repo-root install.sh /
// install.ps1, bundled into the web build by the copy-installer Vite plugin).
export const INSTALL_COMMANDS = {
  unix: "curl -LsSf https://paper-baker.web.app/install.sh | sh",
  windows: 'powershell -ExecutionPolicy ByPass -c "irm https://paper-baker.web.app/install.ps1 | iex"',
} as const;

type OsKey = keyof typeof INSTALL_COMMANDS;

const TABS: { key: OsKey; label: string }[] = [
  { key: "unix", label: "macOS / Linux" },
  { key: "windows", label: "Windows" },
];

/** Best-effort default tab from the visitor's platform; they can switch freely. */
function detectOs(): OsKey {
  if (typeof navigator === "undefined") return "unix";
  const ua = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  return /windows|win32|win64/.test(ua) ? "windows" : "unix";
}

/**
 * Install-command widget with a macOS/Linux ⇆ Windows toggle and a copy button.
 * Renders full-width; constrain it with a max-width wrapper at the call site.
 */
export function InstallCommand({
  size = "md",
  align = "start",
}: {
  size?: "sm" | "md";
  align?: "start" | "center";
}) {
  const [os, setOs] = useState<OsKey>(detectOs);
  const cmd = INSTALL_COMMANDS[os];

  return (
    <div className="w-full">
      <div
        className={`flex gap-1 ${align === "center" ? "justify-center" : ""}`}
        role="tablist"
        aria-label="Operating system"
      >
        {TABS.map((t) => {
          const active = t.key === os;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setOs(t.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <CommandBlock
        key={os}
        lines={[cmd]}
        prompt={os === "windows" ? ">" : "$"}
        size={size}
        truncate
        className="mt-1.5"
      />
    </div>
  );
}
