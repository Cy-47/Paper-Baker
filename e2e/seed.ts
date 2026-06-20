// E2E seeding helper. The web no longer stores paper metadata in savedPapers —
// it lives once in the global papers/{id} cache, which clients can't write
// (backend-only). So the dev __pbSaveToLibrary hook writes only the thin
// savedPapers record, and the test seeds the matching papers/{id} metadata
// straight into the emulator here (admin REST, bypassing rules). This survives a
// page reload, unlike an in-memory shim, so the read-path join keeps rendering.

const PROJECT_ID = "paper-baker";

function host(): string {
  return process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
}

// Encode a plain JS value as a Firestore REST "Value".
function toValue(v: unknown): unknown {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
}

function toFields(obj: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val !== undefined) fields[k] = toValue(val);
  }
  return fields;
}

/**
 * Seed a paper's canonical metadata into the global papers/{paperId} cache via
 * the Firestore emulator's admin REST endpoint (the `Bearer owner` token
 * bypasses security rules, exactly as the Admin SDK does).
 */
export async function seedPaperMeta(paper: { paperId: string }): Promise<void> {
  const name = `projects/${PROJECT_ID}/databases/(default)/documents/papers/${paper.paperId}`;
  const res = await fetch(
    `http://${host()}/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner",
      },
      body: JSON.stringify({
        writes: [{ update: { name, fields: toFields(paper) } }],
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`seedPaperMeta failed (${res.status}): ${await res.text()}`);
  }
}
