import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FlaskConical, Check, TerminalSquare } from "lucide-react";
import { Button, Card, Input } from "@heroui/react";
import { useAuth } from "../hooks/useAuth";
import { approveDeviceCode } from "../lib/device";

type Status = "idle" | "submitting" | "approved" | "error";

export default function DevicePage() {
  const { user, loading, signIn } = useAuth();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const approve = async () => {
    setStatus("submitting");
    setError("");
    try {
      await approveDeviceCode(code.trim());
      setStatus("approved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <Card.Content>
          <div className="flex flex-col items-center text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
              {status === "approved" ? <Check size={22} /> : <TerminalSquare size={22} />}
            </span>
            <h1 className="mt-4 text-lg font-medium text-[var(--foreground)]">
              {status === "approved" ? "Device connected" : "Authorize a device"}
            </h1>

            {status === "approved" ? (
              <p className="mt-1 text-sm text-[var(--muted)]">
                You can return to your terminal — the CLI is now signed in.
              </p>
            ) : loading ? (
              <p className="mt-3 text-sm text-[var(--muted)]">Loading…</p>
            ) : !user ? (
              <>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Sign in to connect the Paper Baker CLI to your account.
                </p>
                <Button variant="primary" fullWidth className="mt-6" onPress={signIn}>
                  <FlaskConical size={16} /> Sign in to continue
                </Button>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Enter the code shown in your terminal to connect the CLI.
                </p>
                <div className="mt-5 w-full">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="ABCD-2FGH"
                    aria-label="Device code"
                    fullWidth
                  />
                </div>
                {status === "error" && (
                  <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
                )}
                <Button
                  variant="primary"
                  fullWidth
                  className="mt-4"
                  isDisabled={!code.trim() || status === "submitting"}
                  onPress={approve}
                >
                  {status === "submitting" ? "Authorizing…" : "Authorize CLI"}
                </Button>
                <p className="mt-3 text-xs text-[var(--muted)]">
                  Signed in as {user.email ?? user.displayName ?? "your account"}
                </p>
              </>
            )}
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}
