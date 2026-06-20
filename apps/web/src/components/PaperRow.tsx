import { useState, type ReactNode } from "react";
import type { PaperMetadata } from "@paper-baker/core";

const clamp2 = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
} as const;

/**
 * A paper list row: title + a caller-supplied meta line and action controls.
 * Clicking the title/meta area toggles the paper's abstract. Shared across every
 * surface that lists papers (Home, Library, Project, Find, AddToProject).
 *
 * `abstract` controls how the abstract is shown:
 *  - "expand" (default): hidden until the row is opened, then shown in full.
 *    Used by the collection views (Home, Library, Project).
 *  - "preview": always shown as a 2-line clamp, expanding to full when opened.
 *    Used by the discovery views (Find, AddToProject) where a preview aids
 *    scanning of unfamiliar results.
 */
export default function PaperRow({
  paper,
  meta,
  chips,
  actions,
  abstract = "expand",
}: {
  paper: PaperMetadata;
  meta: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  abstract?: "expand" | "preview";
}) {
  const [open, setOpen] = useState(false);
  const preview = abstract === "preview";
  return (
    <div className="border-b border-solid border-[var(--border)] py-3">
      <div className={`flex gap-3 ${preview ? "items-start" : "items-center"}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left"
        >
          <span
            title={paper.title}
            className="block truncate text-sm font-medium text-[var(--foreground)]"
          >
            {paper.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
            <span>{meta}</span>
            {chips}
          </span>
          {preview && paper.abstract && (
            // Preview: a 2-line clamp is always shown, growing to full on open.
            // The collapsed height isn't zero, so we animate max-height (the
            // grid-rows trick only interpolates cleanly from a 0fr baseline).
            <span
              className="mt-1 block overflow-hidden text-[13px] leading-relaxed text-[var(--muted)] transition-[max-height] duration-200 ease-out"
              style={open ? { maxHeight: "30rem" } : { ...clamp2, maxHeight: "2.75rem" }}
            >
              {paper.abstract}
            </span>
          )}
        </button>
        {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
      </div>
      {!preview && (
        // Expand: hidden until open, then revealed in full. Animate via
        // grid-template-rows 0fr->1fr, which interpolates height with no
        // magic max-height value and no close-time jank.
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          {/*
           * overflow:hidden clips the height, but the text keeps its own
           * layout box, so it stays in the accessibility tree (and reads as
           * visible to assistive tech / Playwright) while collapsed. Gate it
           * with visibility:hidden, delayed until the collapse finishes so the
           * close still animates smoothly.
           */}
          <div
            className="overflow-hidden"
            style={{
              visibility: open ? "visible" : "hidden",
              transition: "visibility 0s linear",
              transitionDelay: open ? "0s" : "200ms",
            }}
          >
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              {paper.abstract || "No abstract available."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
