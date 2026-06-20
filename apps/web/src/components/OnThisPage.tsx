import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

type Heading = { id: string; text: string; level: 2 | 3 };

/**
 * Right-rail "On this page" table of contents. Reads the `h2`/`h3` headings inside
 * the `[data-docs-content]` region (markdown headings get ids from rehype-slug;
 * JSX pages set them explicitly), links to them with h3s indented under their
 * section, and highlights the one in view. Hidden below xl and when a page has
 * fewer than two headings.
 */
export function OnThisPage() {
  const { pathname } = useLocation();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const root = document.querySelector("[data-docs-content]");
    if (!root) return;

    const els = [...root.querySelectorAll<HTMLElement>("h2, h3")].filter((h) => h.id);
    setHeadings(
      els.map((h) => {
        // Exclude the hover "#" anchor the Markdown renderer appends to headings.
        const clone = h.cloneNode(true) as HTMLElement;
        clone.querySelector(".heading-anchor")?.remove();
        return {
          id: h.id,
          text: (clone.textContent ?? "").trim(),
          level: h.tagName === "H3" ? 3 : 2,
        };
      }),
    );
    if (els.length) setActive(els[0].id);

    // Scroll-spy: mark the heading nearest the top of the viewport as active.
    const observer = new IntersectionObserver(
      (entries) => {
        const onscreen = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (onscreen[0]) setActive((onscreen[0].target as HTMLElement).id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pathname]);

  if (headings.length < 2) return null;

  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 flex-none self-start overflow-y-auto py-10 xl:block">
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        On this page
      </p>
      <nav className="flex flex-col gap-0.5">
        {headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth" });
              history.replaceState(null, "", `#${h.id}`);
              setActive(h.id);
            }}
            className={`rounded-md py-1 pr-3 text-sm no-underline transition-colors ${
              h.level === 3 ? "pl-6 text-[13px]" : "pl-3"
            } ${
              active === h.id
                ? "font-medium text-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {h.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}
