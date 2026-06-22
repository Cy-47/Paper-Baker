import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

// ---------------------------------------------------------------------------
// Minimal interactive prompts. Commands must guard with isInteractive() and
// hard-error (demanding an explicit flag) when there's no TTY — so CI/agent runs
// never hang waiting on stdin. See DESIGN.md §5.2.1.
// ---------------------------------------------------------------------------

/** True only when both stdin and stdout are attached to a terminal. */
export function isInteractive(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

/**
 * Ask a free-form question; returns the trimmed answer. Pass a `signal` to
 * cancel a pending question — `rl.question` rejects with an AbortError, which
 * callers can catch (e.g. login aborts the "Press Enter" prompt once the device
 * flow is approved out-of-band, so the CLI never stalls waiting on a keypress).
 */
export async function promptLine(
  question: string,
  signal?: AbortSignal,
): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question, signal ? { signal } : {})).trim();
  } finally {
    rl.close();
  }
}

/**
 * Ask the user to pick one of `choices` (matched case-insensitively by full
 * value or first letter). Re-asks until a valid choice is given.
 */
export async function promptChoice(
  question: string,
  choices: string[],
): Promise<string> {
  const hint = choices.map((c) => `[${c[0]}]${c.slice(1)}`).join(" / ");
  for (;;) {
    const answer = (await promptLine(`${question} ${hint}: `)).toLowerCase();
    const match = choices.find(
      (c) => c.toLowerCase() === answer || c[0].toLowerCase() === answer,
    );
    if (match) return match;
    stdout.write(`Please choose one of: ${choices.join(", ")}\n`);
  }
}
