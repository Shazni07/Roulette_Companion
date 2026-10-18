import { create } from "zustand";
import { setChangeListener } from "@/lib/state/db";
import { useStore } from "@/lib/state/store";
import { cloudConfigured, getSupabase, supabaseRemote } from "./client";
import { enqueueAll, pendingCount, pull, push, wipeLocal, type Remote } from "./engine";

/** Which account the data on this phone belongs to. */
const OWNER_KEY = "roulette-companion-cloud-user";
const PUSH_DELAY_MS = 1500;
const FOCUS_SYNC_MS = 60_000;

export interface CloudUser {
  id: string;
  email: string;
}

export type CloudStatus = "idle" | "syncing" | "offline" | "error";

interface CloudState {
  enabled: boolean;
  /** True once we know whether someone is signed in. */
  checked: boolean;
  user: CloudUser | null;
  status: CloudStatus;
  /** Changes made on this phone that are not online yet. */
  pending: number;
  lastSyncedAt: number | null;
  message: string | null;

  start: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  /** Returns an error text, or null; `needsConfirm` is true when a confirmation email must be opened first. */
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsConfirm: boolean }>;
  signOut: (force?: boolean) => Promise<{ ok: boolean; pending: number }>;
  syncNow: (mode?: "full" | "push") => Promise<void>;
}

/** Plain-language versions of the messages Supabase gives. */
export function friendlyError(e: unknown): string {
  const m = (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)) || "";
  const lower = m.toLowerCase();
  if (lower.includes("invalid login")) return "Wrong email or password.";
  if (lower.includes("email not confirmed")) return "Please open the confirmation email we sent you, then sign in.";
  if (lower.includes("already registered")) return "That email already has an account. Use Sign In instead.";
  if (lower.includes("at least") && lower.includes("password")) return "Use a password with at least 6 characters.";
  if (lower.includes("valid email") || lower.includes("invalid email")) return "Please type a real email address.";
  if (lower.includes("rate limit") || lower.includes("too many")) return "Too many tries. Please wait a few minutes and try again.";
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network request failed") || lower.includes("load failed")) return "No internet connection.";
  if (lower.includes("could not find the table") || lower.includes("relation") || lower.includes("pgrst205")) return "Online storage is not ready yet: the database set-up file has not been run in Supabase.";
  return m || "Something went wrong.";
}

const isNetwork = (e: unknown) => friendlyError(e) === "No internet connection.";

const readOwner = () => {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
};
const writeOwner = (id: string) => {
  try {
    localStorage.setItem(OWNER_KEY, id);
  } catch {
    /* private window: harmless */
  }
};

export const useCloud = create<CloudState>((set, get) => {
  let started = false;
  let running: Promise<void> | null = null;
  let again: "full" | "push" | null = null;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFocusSync = 0;

  const remoteFor = (user: CloudUser): Remote => supabaseRemote(getSupabase(), user.id);
  const refreshPending = async () => set({ pending: await pendingCount().catch(() => 0) });

  /** First sign-in on this phone uploads what is already here; a different account gets a clean phone. */
  async function adopt(user: CloudUser) {
    const owner = readOwner();
    if (owner && owner !== user.id) {
      await wipeLocal();
      await useStore.getState().init();
    } else if (!owner) {
      await enqueueAll();
    }
    writeOwner(user.id);
  }

  async function runSync(mode: "full" | "push") {
    const user = get().user;
    if (!user) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await refreshPending();
      return set({ status: "offline", message: null });
    }
    set({ status: "syncing", message: null });
    try {
      const remote = remoteFor(user);
      await push(remote);
      if (mode === "full") {
        const changed = await pull(remote);
        if (changed) await useStore.getState().refreshSessions();
      }
      await refreshPending();
      set({ status: "idle", lastSyncedAt: Date.now(), message: null });
    } catch (e) {
      await refreshPending();
      set(isNetwork(e) ? { status: "offline", message: null } : { status: "error", message: friendlyError(e) });
    }
  }

  function syncNow(mode: "full" | "push" = "full"): Promise<void> {
    if (!get().user) return Promise.resolve();
    if (running) {
      // already sending: run once more afterwards so the newest changes are included
      again = mode === "full" || again === "full" ? "full" : "push";
      return running;
    }
    running = (async () => {
      try {
        await runSync(mode);
        while (again) {
          const next = again;
          again = null;
          await runSync(next);
        }
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function schedulePush() {
    void refreshPending();
    if (!get().user) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void syncNow("push"), PUSH_DELAY_MS);
  }

  async function signedIn(user: CloudUser) {
    set({ user, status: "syncing", message: null });
    try {
      await adopt(user);
    } catch (e) {
      set({ status: "error", message: friendlyError(e) });
      return;
    }
    await syncNow("full");
  }

  const toUser = (u: { id: string; email?: string | null } | null | undefined): CloudUser | null => (u ? { id: u.id, email: u.email ?? "" } : null);

  return {
    enabled: cloudConfigured(),
    checked: false,
    user: null,
    status: "idle",
    pending: 0,
    lastSyncedAt: null,
    message: null,

    start: async () => {
      if (started || !get().enabled) return;
      started = true;
      setChangeListener(schedulePush);
      const sb = getSupabase();
      try {
        const { data } = await sb.auth.getSession();
        const user = toUser(data.session?.user);
        set({ checked: true, user });
        if (user) void signedIn(user);
        else void refreshPending();
      } catch {
        set({ checked: true });
      }
      // signed out from elsewhere (for example the password was changed): go back to local-only
      sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT" && get().user) setTimeout(() => set({ user: null, status: "idle", message: null }), 0);
      });
      window.addEventListener("online", () => void syncNow("full"));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || !get().user || Date.now() - lastFocusSync < FOCUS_SYNC_MS) return;
        lastFocusSync = Date.now();
        void syncNow("full");
      });
    },

    signIn: async (email, password) => {
      try {
        const { data, error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
        if (error) return friendlyError(error);
        const user = toUser(data.user);
        if (!user) return "Could not sign in. Please try again.";
        void signedIn(user);
        return null;
      } catch (e) {
        return friendlyError(e);
      }
    },

    signUp: async (email, password) => {
      try {
        const { data, error } = await getSupabase().auth.signUp({ email: email.trim(), password });
        if (error) return { error: friendlyError(error), needsConfirm: false };
        // an address that already has an account comes back with no identities and no error
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { error: friendlyError(new Error("User already registered")), needsConfirm: false };
        const user = toUser(data.session?.user);
        if (user) {
          void signedIn(user);
          return { error: null, needsConfirm: false };
        }
        return { error: null, needsConfirm: true };
      } catch (e) {
        return { error: friendlyError(e), needsConfirm: false };
      }
    },

    signOut: async (force = false) => {
      if (!force) {
        await syncNow("push");
        const pending = await pendingCount().catch(() => 0);
        if (pending > 0) {
          set({ pending });
          return { ok: false, pending };
        }
      }
      try {
        await getSupabase().auth.signOut();
      } catch {
        /* the phone still forgets the sign-in below */
      }
      set({ user: null, status: "idle", message: null });
      return { ok: true, pending: 0 };
    },

    syncNow,
  };
});
