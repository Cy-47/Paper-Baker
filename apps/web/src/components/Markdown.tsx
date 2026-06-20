import { isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { CommandBlock } from "./CommandBlock";

/** Shell-ish languages get a "$" prompt; everything else renders verbatim. */
const SHELL_LANGS = new Set(["sh", "bash", "shell", "zsh", "console"]);

/** Flatten a React node tree to its text content. */
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

/**
 * Render a fenced code block via the shared CommandBlock. The `<pre>`'s child is
 * the `<code>` element carrying the `language-*` class and the raw text.
 */
function FencedCode({ children }: { children?: ReactNode }) {
  const code = isValidElement(children)
    ? (children as React.ReactElement<{ className?: string; children?: ReactNode }>)
    : null;
  const lang = /language-([\w-]+)/.exec(code?.props?.className ?? "")?.[1] ?? "";
  const text = nodeText(code?.props?.children).replace(/\n+$/, "");
  return (
    <CommandBlock
      lines={text.split("\n")}
      prompt={SHELL_LANGS.has(lang) ? "$" : ""}
      size="sm"
      className="my-4"
    />
  );
}

/** Heading with a hover "#" anchor (when rehype-slug has given it an id). */
function Heading({
  level,
  id,
  children,
}: {
  level: 2 | 3;
  id?: string;
  children?: React.ReactNode;
}) {
  const Tag = `h${level}` as "h2" | "h3";
  return (
    <Tag id={id}>
      {children}
      {id ? (
        <a href={`#${id}`} className="heading-anchor" aria-label="Link to this section">
          #
        </a>
      ) : null}
    </Tag>
  );
}

const components: Components = {
  a({ href, children }) {
    const external = /^https?:\/\//.test(href ?? "");
    return (
      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
        {children}
      </a>
    );
  },
  pre({ children }) {
    return <FencedCode>{children}</FencedCode>;
  },
  h2({ id, children }) {
    return (
      <Heading level={2} id={id}>
        {children}
      </Heading>
    );
  },
  h3({ id, children }) {
    return (
      <Heading level={3} id={id}>
        {children}
      </Heading>
    );
  },
};

/**
 * Render a markdown string into themed HTML. Styling lives in app.css under the
 * `.markdown` scope; GFM (tables, strikethrough, autolinks) is enabled. Raw HTML
 * in the source is NOT rendered (react-markdown's safe default). Headings get
 * hover anchors and fenced code blocks get a copy button.
 *
 * `slug` adds id anchors to headings (for the page TOC) — on by default, but turn
 * it off for embedded snippets whose headings shouldn't show up in the TOC.
 */
export function Markdown({ children, slug = true }: { children: string; slug?: boolean }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={slug ? [rehypeSlug] : []}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
