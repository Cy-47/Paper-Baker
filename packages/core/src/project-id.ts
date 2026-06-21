// ---------------------------------------------------------------------------
// Project identity: a hidden global `stableId` + a per-owner `id`.
//
// `stableId` is the durable key — plumbing that lives in config.json and as the
// Firestore doc id, never typed by users. Projects are now TOP-LEVEL
// (projects/{stableId}) and globally addressable, so the id is server-minted and
// must be unique across ALL projects (not just one user's) — hence a wider key
// than the old per-user 4-char one.
//
// `id` is derived from the name and is the only project identifier users see/type
// (the `id` in `handle/id`). Keeping it separate from `stableId` is what makes
// rename a one-field write that never breaks a bound directory. See DESIGN.md §3.2.
// ---------------------------------------------------------------------------

/** Max length of a user-facing project id — keeps URLs sane without being restrictive. */
export const PROJECT_ID_MAX_LENGTH = 64;

/** Fallback id base when a name yields nothing slug-able (e.g. all emoji). */
export const DEFAULT_PROJECT_ID = "untitled";

/**
 * Turn a human name into a URL-safe project id: lowercased, with runs of
 * punctuation and whitespace collapsed to single hyphens.
 *
 * Latin accents are folded to ASCII (café → cafe), but letters and digits from
 * any script are kept rather than stripped (机器学习 → 机器学习). Transliterating
 * CJK to pinyin is lossy — homophones collide and polyphonic characters get the
 * wrong reading — so a faithful Unicode id is both safer and more meaningful;
 * it's valid in URLs (percent-encoded on the wire) and Firestore handles it fine.
 *
 * Returns "" only when nothing slug-able remains (e.g. an all-emoji or
 * all-punctuation name); callers pair this with a fallback — the stable id at the
 * call sites, or {@link DEFAULT_PROJECT_ID} via {@link uniqueProjectId}.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD") // split accented letters into base char + combining mark
    .replace(/\p{Diacritic}/gu, "") // drop the combining marks → ASCII base
    .normalize("NFC") // recompose what's left (e.g. decomposed Hangul jamo)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-") // non-alphanumeric runs → one hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .slice(0, PROJECT_ID_MAX_LENGTH)
    .replace(/-+$/g, ""); // re-trim in case the slice landed on a hyphen
}

/**
 * Pick a project id unique within `taken`, suffixing `-2`, `-3`, … on collision.
 * An empty `base` falls back to {@link DEFAULT_PROJECT_ID}.
 */
export function uniqueProjectId(base: string, taken: Iterable<string>): string {
  const used = taken instanceof Set ? taken : new Set(taken);
  const root = base || DEFAULT_PROJECT_ID;
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Stable global key
// ---------------------------------------------------------------------------

/**
 * Crockford-style alphabet minus the visually ambiguous 0/1/l/o, so a glance at
 * an id in config.json is never misread. 32 symbols.
 */
export const STABLE_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

/**
 * Length of a stable id. 32^8 ≈ 1.1e12 — ample headroom for a single global
 * namespace, with collisions astronomically rare (the backend create path still
 * guards transactionally).
 */
export const STABLE_ID_LENGTH = 8;

/**
 * Generate a stable id. `randomIndex(maxExclusive)` returns an integer in
 * [0, maxExclusive); it defaults to a uniform, bias-free Web Crypto source and is
 * injectable for deterministic tests.
 */
export function generateStableId(
  randomIndex: (maxExclusive: number) => number = cryptoRandomIndex,
): string {
  let id = "";
  for (let i = 0; i < STABLE_ID_LENGTH; i++) {
    id += STABLE_ID_ALPHABET[randomIndex(STABLE_ID_ALPHABET.length)];
  }
  return id;
}

/**
 * True iff `value` is a well-formed stable id: exactly {@link STABLE_ID_LENGTH}
 * characters, all from {@link STABLE_ID_ALPHABET} (rejecting ids/handles too).
 */
export function isValidStableId(value: string): boolean {
  if (value.length !== STABLE_ID_LENGTH) return false;
  for (const ch of value) {
    if (!STABLE_ID_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * Uniform integer in [0, maxExclusive) from Web Crypto, using rejection sampling
 * to avoid the modulo bias a plain `% maxExclusive` would introduce.
 */
function cryptoRandomIndex(maxExclusive: number): number {
  const limit = 256 - (256 % maxExclusive); // largest multiple of max that fits a byte
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
}
