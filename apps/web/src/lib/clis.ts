import { collection, onSnapshot } from "firebase/firestore";
import { db, auth } from "./firebase";
import { getApiClient } from "./api";

// A CLI connected to this account via the device-link flow. Created backend-side
// (Admin SDK) when `pb login` completes; its doc id is the connectionId. Read
// here via a snapshot; deleting goes through the API (which makes requireAuth
// reject that CLI's next call). Timestamps are ISO strings.
export interface CliConnection {
  connectionId: string;
  device: { hostname?: string; platform?: string; cliVersion?: string };
  createdAt: string;
  lastSeenAt: string;
}

// One entry in the append-only activity log below the connection list. Written
// backend-side on connect/delete; read-only here.
export interface CliEvent {
  id: string;
  type: "connected" | "deleted";
  device: { hostname?: string; platform?: string; cliVersion?: string };
  at: string;
}

function uid(): string {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in");
  return u.uid;
}

function clisCol() {
  return collection(db, "users", uid(), "clis");
}

function eventsCol() {
  return collection(db, "users", uid(), "cliEvents");
}

export function subscribeClis(cb: (clis: CliConnection[]) => void) {
  return onSnapshot(
    clisCol(),
    (snap) => {
      const items = snap.docs.map((d) => {
        const data = d.data();
        return {
          connectionId: d.id,
          device: data.device ?? {},
          createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
          lastSeenAt: typeof data.lastSeenAt === "string" ? data.lastSeenAt : "",
        } as CliConnection;
      });
      // Most recently active first.
      items.sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));
      cb(items);
    },
    // A listener error (e.g. a permission-denied if the token isn't ready yet)
    // is terminal — the listener detaches. Surface it and resolve to an empty
    // list so the UI leaves its loading state instead of hanging on null.
    (err) => {
      console.error("[clis] subscribeClis failed:", err);
      cb([]);
    }
  );
}

export function subscribeCliEvents(cb: (events: CliEvent[]) => void) {
  return onSnapshot(
    eventsCol(),
    (snap) => {
      const items = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          type: data.type === "deleted" ? "deleted" : "connected",
          device: data.device ?? {},
          at: typeof data.at === "string" ? data.at : "",
        } as CliEvent;
      });
      // Newest first.
      items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
      cb(items);
    },
    (err) => {
      console.error("[clis] subscribeCliEvents failed:", err);
      cb([]);
    }
  );
}

// Delete drops the record entirely. A still-live CLI is also rejected (its
// connection no longer resolves), so this both forgets and revokes; the backend
// appends a "deleted" entry to the activity log.
export async function deleteCli(connectionId: string): Promise<void> {
  await (await getApiClient()).deleteConnection(connectionId);
}
