// ---------------------------------------------------------------------------
// Project identity: a stable short id + a renamable slug.
//
// `projectId` is the durable key — plumbing that lives in config.json and as the
// Firestore doc id, never typed by users. Because projects are scoped per-user
// (users/{uid}/projects/{id}) it only needs to be unique within one user's
// handful of projects, so 4 chars is plenty (the backend create path still
// guards against the astronomically-rare collision).
//
// `slug` is derived from the name and is the only handle users see/type. Keeping
// the two separate is what makes rename a one-field write that never breaks a
// bound directory. See DESIGN.md §3.2.
// ---------------------------------------------------------------------------

/** Max slug length — keeps URLs and ids sane without being restrictive. */
export const SLUG_MAX_LENGTH = 64;

/** Fallback slug base when a name yields nothing slug-able (e.g. all CJK/emoji). */
export const DEFAULT_SLUG = "untitled";

/**
 * Turn a human name into a URL-safe slug: lowercase ASCII words joined by single
 * hyphens. Returns "" when nothing slug-able remains — callers pair this with
 * {@link uniqueSlug}, which substitutes {@link DEFAULT_SLUG}.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD") // split accented letters into base char + combining mark
    .replace(/\p{Diacritic}/gu, "") // drop the combining marks → ASCII base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // any run of non-alphanumerics → one hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, ""); // re-trim in case the slice landed on a hyphen
}

/**
 * Pick a slug unique within `taken`, suffixing `-2`, `-3`, … on collision.
 * An empty `base` falls back to {@link DEFAULT_SLUG}.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = taken instanceof Set ? taken : new Set(taken);
  const root = base || DEFAULT_SLUG;
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Stable short id
// ---------------------------------------------------------------------------

/**
 * Crockford-style alphabet minus the visually ambiguous 0/1/l/o, so a glance at
 * an id in config.json is never misread. 32 symbols → 32^4 ≈ 1.05M ids, far more
 * than one user's project count needs.
 */
export const PROJECT_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

export const PROJECT_ID_LENGTH = 4;

/**
 * Generate a stable project id. `randomIndex(maxExclusive)` returns an integer in
 * [0, maxExclusive); it defaults to a uniform, bias-free Web Crypto source and is
 * injectable for deterministic tests.
 */
export function generateProjectId(
  randomIndex: (maxExclusive: number) => number = cryptoRandomIndex,
): string {
  let id = "";
  for (let i = 0; i < PROJECT_ID_LENGTH; i++) {
    id += PROJECT_ID_ALPHABET[randomIndex(PROJECT_ID_ALPHABET.length)];
  }
  return id;
}

/** True iff `value` is a well-formed stable project id (not a slug or local-* id). */
export function isValidProjectId(value: string): boolean {
  if (value.length !== PROJECT_ID_LENGTH) return false;
  for (const ch of value) {
    if (!PROJECT_ID_ALPHABET.includes(ch)) return false;
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
