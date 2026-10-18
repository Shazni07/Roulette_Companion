import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SyncTable } from "@/lib/state/db";
import type { Remote, RemoteRow } from "./engine";

// These must be written out like this so Next.js can put the values into the app when it is built.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** False when the two settings are missing: the app then works fully on the phone and shows no sign-in. */
export const cloudConfigured = () => !!SUPABASE_URL && !!SUPABASE_KEY;

let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Online storage is not set up.");
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return client;
}

const PAGE = 1000;

/** The Supabase tables, seen through the small `Remote` interface the sync code uses. */
export function supabaseRemote(sb: SupabaseClient, userId: string): Remote {
  return {
    async upsert(table: SyncTable, rows: RemoteRow[]) {
      if (rows.length === 0) return;
      const { error } = await sb.from(table).upsert(
        rows.map((r) => ({ ...r, user_id: userId })),
        { onConflict: "user_id,id" },
      );
      if (error) throw error;
    },
    async deleteSessionChildren(sessionId: string) {
      for (const table of ["rounds", "transactions"] as const) {
        const { error } = await sb.from(table).delete().eq("session_id", sessionId);
        if (error) throw error;
      }
    },
    async fetchAll(table: SyncTable) {
      const out: RemoteRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const cols = table === "sessions" ? "id, data, updated_at, deleted" : "id, session_id, data, updated_at";
        const { data, error } = await sb.from(table).select(cols).order("id").range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as unknown as RemoteRow[];
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    },
  };
}
