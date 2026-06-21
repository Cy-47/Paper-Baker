import { stdout } from "node:process";

// ---------------------------------------------------------------------------
// Minimal ANSI styling — no dependency, gh-CLI flavored. Color is emitted only
// when stdout is a real terminal and NO_COLOR isn't set (https://no-color.org),
// so piped output and agent/CI runs stay plain and parseable. Because color is
// decided per-call at write time, the same code prints bare text under a pipe.
// ---------------------------------------------------------------------------

function colorOn(): boolean {
  return Boolean(stdout.isTTY) && !process.env["NO_COLOR"];
}

function sgr(open: number, close: number): (s: string) => string {
  return (s) => (colorOn() ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const bold = sgr(1, 22);
const green = sgr(32, 39);
const yellow = sgr(33, 39);

/** Success line: green "✓" then the message (e.g. "✓ Signed in as Cy-47"). */
export function tick(message: string): string {
  return `${green("✓")} ${message}`;
}

/** Attention line: yellow "!" then the message (matches gh's prompt prefix). */
export function bang(message: string): string {
  return `${yellow("!")} ${message}`;
}
