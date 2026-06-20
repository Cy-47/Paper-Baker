import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * A copyable terminal-style code/command block: click anywhere to copy. The
 * shared primitive behind InstallCommand, the Quickstart snippets, and the
 * fenced code blocks in rendered markdown, so every block looks and behaves
 * alike.
 *
 * With a `prompt` (default `$`) each line is prefixed like a shell command and
 * the prompt is excluded from the copied text. Pass `prompt=""` for plain code
 * (e.g. a file tree): the lines render verbatim with whitespace preserved.
 */
export function CommandBlock({
  lines,
  prompt = "$",
  size = "md",
  truncate = false,
  className = "",
}: {
  lines: string[];
  /** Prompt prefix per line (e.g. ">" for PowerShell); "" for plain code. */
  prompt?: string;
  size?: "sm" | "md";
  /** Single-line commands that may overflow (copy to get the full text). */
  truncate?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard?.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const text = size === "sm" ? "text-[13px]" : "text-sm";
  const pad = size === "sm" ? "px-4 py-2.5" : "px-4 py-3";
  const icon = size === "sm" ? 15 : 16;
  const hasPrompt = prompt !== "";
  const centered = hasPrompt && lines.length <= 1;

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label="Copy to clipboard"
      className={`group flex w-full gap-3 rounded-lg border border-solid border-[var(--border)] bg-[var(--surface)] text-left font-mono ${text} ${pad} text-[var(--foreground)] transition-colors hover:border-[var(--accent)] ${
        centered ? "items-center" : "items-start"
      } ${className}`}
    >
      {/* No horizontal scroll when truncating (the line ellipses instead). */}
      <div className={`min-w-0 flex-1 ${truncate ? "" : "overflow-x-auto"}`}>
        {hasPrompt ? (
          <div className="space-y-0.5">
            {lines.map((line, i) => (
              <div key={i} className="flex gap-3">
                <span className="flex-none select-none text-[var(--accent)]">{prompt}</span>
                <span className={truncate ? "min-w-0 flex-1 truncate" : "whitespace-pre"}>
                  {line}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="whitespace-pre leading-relaxed">{lines.join("\n")}</div>
        )}
      </div>
      <span
        className={`flex-none text-[var(--muted)] group-hover:text-[var(--accent)] ${
          centered ? "" : "pt-0.5"
        }`}
      >
        {copied ? <Check size={icon} /> : <Copy size={icon} />}
      </span>
    </button>
  );
}
