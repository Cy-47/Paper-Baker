import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, Modal } from "@heroui/react";
import { useAuth } from "../hooks/useAuth";
import { getApiClient } from "../lib/api";

/**
 * Ensures the signed-in user has claimed a handle before they reach the app.
 *
 * On mount it asks the backend for the caller's profile; if no handle is set yet
 * (a fresh account), it renders a blocking modal that claims one via updateMe.
 * The server owns handle validation + uniqueness, so we just surface its
 * 400/409 message inline and let the user retry. Once a handle exists (or the
 * check is still in flight) the children render normally — the gate only blocks
 * for users who genuinely need to onboard.
 */
export default function OnboardingGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // null = not yet checked; true/false = whether the user still needs a handle.
  const [needsHandle, setNeedsHandle] = useState<boolean | null>(null);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await (await getApiClient()).getMe();
        if (cancelled) return;
        setNeedsHandle(me.handle === null);
        if (me.displayName) setDisplayName(me.displayName);
      } catch {
        // If the profile check fails (offline/transient), don't trap the user
        // behind the gate — let the app load; mutations will surface their own
        // errors and a reload re-runs the check.
        if (!cancelled) setNeedsHandle(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const submit = async () => {
    const h = handle.trim();
    if (!h) {
      setError("Please choose a handle.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await (await getApiClient()).updateMe({
        handle: h,
        displayName: displayName.trim() || undefined,
      });
      setNeedsHandle(false);
    } catch (err) {
      // The api-client surfaces the backend's message (e.g. invalid/reserved/taken).
      setError(err instanceof Error ? stripHttp(err.message) : "Could not claim that handle.");
    } finally {
      setSaving(false);
    }
  };

  if (needsHandle !== true) return <>{children}</>;

  return (
    <>
      {children}
      {/* No onOpenChange handler: the modal can't be dismissed until a handle is
          claimed (which flips needsHandle to false and unmounts it). */}
      <Modal isOpen>
        <Modal.Backdrop>
          <Modal.Container placement="center">
            <Modal.Dialog className="w-full max-w-md">
              <Modal.Header>
                <Modal.Heading className="text-base font-medium leading-snug text-[var(--foreground)]">
                  Choose your handle
                </Modal.Heading>
              </Modal.Header>

              <Modal.Body>
                <p className="text-sm text-[var(--muted)]">
                  Your handle is your public, GitHub-style name — it addresses your
                  projects as <span className="font-mono">handle/project</span>.
                </p>

                <form
                  className="mt-3 flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <Input
                    autoFocus
                    aria-label="Handle"
                    placeholder="handle"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    fullWidth
                  />
                  <Input
                    aria-label="Display name"
                    placeholder="Display name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    fullWidth
                  />
                  {error && (
                    <p className="text-sm text-[var(--danger,#dc2626)]">{error}</p>
                  )}
                </form>
              </Modal.Body>

              <Modal.Footer>
                <Button
                  variant="primary"
                  onPress={() => void submit()}
                  isDisabled={saving}
                >
                  {saving ? "Claiming…" : "Continue"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}

/** Drop the trailing "(HTTP 409)" the api-client appends, for a cleaner message. */
function stripHttp(message: string): string {
  return message.replace(/\s*\(HTTP \d+\)\s*$/, "");
}
