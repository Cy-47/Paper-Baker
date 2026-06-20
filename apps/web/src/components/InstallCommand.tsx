import { useState } from "react";
import { Copy, Check } from "lucide-react";

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
  const [copied, setCopied] = useState(false);
  const cmd = INSTALL_COMMANDS[os];

  const onCopy = () => {
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const text = size === "sm" ? "text-[13px]" : "text-sm";
  const pad = size === "sm" ? "px-4 py-2.5" : "px-4 py-3";
  const icon = size === "sm" ? 15 : 16;

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
              onClick={() => {
                setOs(t.key);
                setCopied(false);
              }}
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

      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy install command"
        className={`group mt-1.5 flex w-full items-center gap-3 rounded-lg border border-solid border-[var(--border)] bg-[var(--surface)] text-left font-mono ${text} ${pad} text-[var(--foreground)] transition-colors hover:border-[var(--accent)]`}
      >
        <span className="select-none text-[var(--accent)]">{os === "windows" ? ">" : "$"}</span>
        <span className="flex-1 truncate">{cmd}</span>
        <span className="flex-none text-[var(--muted)] group-hover:text-[var(--accent)]">
          {copied ? <Check size={icon} /> : <Copy size={icon} />}
        </span>
      </button>
    </div>
  );
}
