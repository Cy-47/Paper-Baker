// ---------------------------------------------------------------------------
// User handles — the public, GitHub-style alias for a Firebase uid.
//
// The Firebase uid stays the internal key everywhere (ownership, membership,
// auth). The handle is purely the public name users type and see — the `handle`
// in `handle/id` — resolved to a uid through the handles/{handle} registry.
// These helpers are pure shape/normalization checks; availability + reservation
// are enforced by the backend claim path (which also calls isReservedHandle).
// See DESIGN.md §3.2.
// ---------------------------------------------------------------------------

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 39; // matches GitHub's cap

/**
 * Handles that would collide with web routes / reserved paths, so they can't be
 * claimed (e.g. a `/settings` handle would shadow the settings page once project
 * URLs are `handle/id`). Compared against the normalized handle.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin", "api", "about", "app", "auth", "device", "docs", "find", "handle",
  "handles", "home", "install", "library", "login", "logout", "me", "new",
  "project", "projects", "settings", "signin", "signup", "u", "user", "users",
  "www",
]);

/** Lowercase + trim a raw handle to its canonical stored/compared form. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Shape check for a normalized handle: {@link HANDLE_MIN_LENGTH}–
 * {@link HANDLE_MAX_LENGTH} chars, ASCII alphanumerics and single internal
 * hyphens only (no leading/trailing/consecutive hyphens). Mirrors GitHub.
 * Expects an already-normalized (lowercase) handle; "Alice" is rejected so callers
 * normalize first. Does NOT check reservation/availability — see
 * {@link isReservedHandle} and the backend registry.
 */
export function isValidHandle(handle: string): boolean {
  if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH) {
    return false;
  }
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle);
}

/** True iff the handle is reserved (collides with a route/path). Normalizes first. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(normalizeHandle(handle));
}
