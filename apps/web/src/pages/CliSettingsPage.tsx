import { useEffect, useState } from "react";
import { TerminalSquare, Trash2, LogIn } from "lucide-react";
import { Button, Card, Chip } from "@heroui/react";
import { useAuth } from "../hooks/useAuth";
import {
  subscribeClis,
  subscribeCliEvents,
  deleteCli,
  type CliConnection,
  type CliEvent,
} from "../lib/clis";

function relativeTime(iso: string): string {
  if (!iso) return "unknown";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function deviceLabel(d: { hostname?: string; platform?: string }): string {
  const host = d.hostname?.trim();
  const platform = d.platform?.trim();
  if (host && platform) return `${host} · ${platform}`;
  return host || platform || "Unknown device";
}

export default function CliSettingsPage() {
  const { user } = useAuth();
  const [clis, setClis] = useState<CliConnection[] | null>(null);
  const [events, setEvents] = useState<CliEvent[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Subscribe only once auth is resolved, and re-subscribe if the user changes.
  // Gating on `user` (rather than reading auth.currentUser on mount) ensures the
  // token is in place before the listener attaches, so it doesn't get a terminal
  // permission-denied that would leave the page stuck loading until a refresh.
  useEffect(() => {
    if (!user) return;
    const unsubClis = subscribeClis(setClis);
    const unsubEvents = subscribeCliEvents(setEvents);
    return () => {
      unsubClis();
      unsubEvents();
    };
  }, [user]);

  const onDelete = async (id: string) => {
    setBusy(id);
    try {
      await deleteCli(id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-medium text-[var(--foreground)]">Connected CLIs</h1>
        {clis && (
          <Chip size="sm" variant="soft">
            {clis.length} active
          </Chip>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Each device you sign into with the Paper Baker CLI appears here. Delete one
        to sign that device out on its next request.
      </p>

      <Card className="mt-4">
        <Card.Content>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]">
              <TerminalSquare size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">Connect a new CLI</p>
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                Run{" "}
                <code className="rounded bg-[var(--background-secondary)] px-1.5 py-0.5 text-[13px]">
                  pb login
                </code>{" "}
                in your terminal and approve the code it prints.
              </p>
            </div>
          </div>
        </Card.Content>
      </Card>

      {clis === null ? (
        <p className="mt-8 text-sm text-[var(--muted)]">Loading…</p>
      ) : clis.length === 0 ? (
        <div className="mt-10 text-center">
          <p className="text-sm text-[var(--muted)]">No CLIs are connected yet.</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col">
          {clis.map((c) => {
            const isBusy = busy === c.connectionId;
            return (
              <div
                key={c.connectionId}
                className="flex items-center gap-3 border-b border-solid border-[var(--border)] py-3 last:border-b-0"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[var(--background-secondary)] text-[var(--muted)]">
                  <TerminalSquare size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-[var(--foreground)]">
                    {deviceLabel(c.device)}
                  </span>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    Connected {relativeTime(c.createdAt)} · Last active{" "}
                    {relativeTime(c.lastSeenAt)}
                    {c.device.cliVersion ? ` · v${c.device.cliVersion}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[var(--danger,inherit)]"
                  isDisabled={isBusy}
                  onPress={() => onDelete(c.connectionId)}
                >
                  <Trash2 size={15} /> Delete
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Append-only activity log: survives deletion, so you can see what was
          connected and when it was removed. Pinned to the bottom of the screen
          via mt-auto so it stays put and stays out of the way as the connection
          list above it grows or shrinks. */}
      {events && events.length > 0 && (
        <div className="mt-auto border-t border-solid border-[var(--border)] pt-5">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Activity
          </h2>
          <div className="mt-1 flex flex-col">
            {events.map((e) => {
              const deleted = e.type === "deleted";
              return (
                <div key={e.id} className="flex items-center gap-3 py-1.5 text-[13px]">
                  <span
                    className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${
                      deleted
                        ? "bg-[var(--danger-soft,var(--background-secondary))] text-[var(--danger,var(--muted))]"
                        : "bg-[var(--background-secondary)] text-[var(--muted)]"
                    }`}
                  >
                    {deleted ? <Trash2 size={13} /> : <LogIn size={13} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">
                    {deleted ? "Removed" : "Connected"}{" "}
                    <span className="text-[var(--muted)]">{deviceLabel(e.device)}</span>
                  </span>
                  <span className="flex-none text-xs text-[var(--muted)]">
                    {relativeTime(e.at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
