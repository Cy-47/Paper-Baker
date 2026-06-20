import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * A bordered block with a copy button in its header. The button always copies
 * `copyText` (the raw source). By default the body shows that raw text in a code
 * block; pass `children` to render something else (e.g. rendered markdown) while
 * still copying the raw source.
 */
export function CopyBlock({
  copyText,
  label,
  children,
}: {
  copyText: string;
  /** Optional caption shown in the header, e.g. a filename. */
  label?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard?.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-solid border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-solid border-[var(--border)] bg-[var(--surface-secondary)] px-3.5 py-2">
        <span className="truncate font-mono text-xs text-[var(--muted)]">{label ?? ""}</span>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy to clipboard"
          className="group flex flex-none items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--background-secondary)] hover:text-[var(--accent)]"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="px-4 py-3.5">
        {children ?? (
          <pre className="overflow-x-auto font-mono text-[12.5px] leading-relaxed text-[var(--foreground)]">
            <code>{copyText}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
