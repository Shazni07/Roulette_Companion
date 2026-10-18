import type { InventoryTransaction, Round, Session } from "@/lib/roulette/types";
import { getDB, type OutboxEntry, type SyncTable } from "@/lib/state/db";

/**
 * Local-first sync. Everything is saved on the phone first (that is what the app reads).
 * This file only copies it online and back: push what changed here, then pull what changed elsewhere.
 * The newest copy wins (every record carries `updatedAt`).
 */

export interface RemoteRow {
  id: string;
  /** Rounds and transactions only. */
  session_id?: string;
  data: unknown;
  updated_at: number;
  /** Sessions only: a deleted session stays online as a small "deleted" note so other phones remove it too. */
  deleted?: boolean;
}

/** What the online store must be able to do. Supabase implements it; the tests use a small fake. */
export interface Remote {
  upsert(table: SyncTable, rows: RemoteRow[]): Promise<void>;
  deleteSessionChildren(sessionId: string): Promise<void>;
  fetchAll(table: SyncTable): Promise<RemoteRow[]>;
}

const CHUNK = 100;
const ORDER: SyncTable[] = ["sessions", "rounds", "transactions"];

type Stored = Session | Round | InventoryTransaction;

/** Sends every waiting change online. Returns how many records were sent. Throws if the internet or the server fails; nothing is lost then. */
export async function push(remote: Remote): Promise<number> {
  const db = getDB();
  const entries = await db.outbox.toArray();
  if (entries.length === 0) return 0;
  const sent: OutboxEntry[] = [];

  for (const table of ORDER) {
    const puts = entries.filter((e) => e.table === table && e.op === "put");
    if (puts.length === 0) continue;
    const records = (await db.table(table).bulkGet(puts.map((e) => e.id))) as (Stored | undefined)[];
    const rows: RemoteRow[] = [];
    puts.forEach((e, i) => {
      const rec = records[i];
      if (!rec) return sent.push(e); // the record is gone locally; nothing to send
      rows.push({
        id: e.id,
        ...(table === "sessions" ? {} : { session_id: e.sessionId }),
        data: rec,
        updated_at: rec.updatedAt ?? e.at,
        ...(table === "sessions" ? { deleted: false } : {}),
      });
      sent.push(e);
    });
    for (let i = 0; i < rows.length; i += CHUNK) await remote.upsert(table, rows.slice(i, i + CHUNK));
  }

  for (const e of entries.filter((x) => x.op === "delete")) {
    await remote.deleteSessionChildren(e.id);
    await remote.upsert("sessions", [{ id: e.id, data: {}, updated_at: e.at, deleted: true }]);
    sent.push(e);
  }

  // forget only what was sent AND not changed again while sending
  await db.transaction("rw", db.outbox, async () => {
    for (const e of sent) {
      const cur = await db.outbox.get(e.key);
      if (cur && cur.at === e.at && cur.op === e.op) await db.outbox.delete(e.key);
    }
  });
  return sent.length;
}

/** Brings records that are newer online onto this phone. Returns true when something here changed. */
export async function pull(remote: Remote): Promise<boolean> {
  const [sessions, rounds, transactions] = await Promise.all(ORDER.map((t) => remote.fetchAll(t)));
  const db = getDB();
  const waiting = new Set((await db.outbox.toArray()).map((e) => e.key)); // changed here and not sent yet: this phone is newer
  let changed = false;

  await db.transaction("rw", db.sessions, db.rounds, db.transactions, async () => {
    const gone = new Set<string>();
    for (const row of sessions ?? []) {
      if (waiting.has(`sessions:${row.id}`)) continue;
      if (row.deleted) {
        gone.add(row.id);
        if (await db.sessions.get(row.id)) {
          await db.rounds.where("sessionId").equals(row.id).delete();
          await db.transactions.where("sessionId").equals(row.id).delete();
          await db.sessions.delete(row.id);
          changed = true;
        }
        continue;
      }
      const local = await db.sessions.get(row.id);
      if (!local || row.updated_at > (local.updatedAt ?? 0)) {
        await db.sessions.put({ ...(row.data as Session), updatedAt: row.updated_at });
        changed = true;
      }
    }
    for (const row of rounds ?? []) {
      if (waiting.has(`rounds:${row.id}`) || (row.session_id && gone.has(row.session_id))) continue;
      const local = await db.rounds.get(row.id);
      if (!local || row.updated_at > (local.updatedAt ?? 0)) {
        await db.rounds.put({ ...(row.data as Round), updatedAt: row.updated_at });
        changed = true;
      }
    }
    for (const row of transactions ?? []) {
      if (waiting.has(`transactions:${row.id}`) || (row.session_id && gone.has(row.session_id))) continue;
      const local = await db.transactions.get(row.id);
      if (!local || row.updated_at > (local.updatedAt ?? 0)) {
        await db.transactions.put({ ...(row.data as InventoryTransaction), updatedAt: row.updated_at });
        changed = true;
      }
    }
  });
  return changed;
}

/** Everything that is already on this phone (saved before online storage existed) is queued for the first upload. */
export async function enqueueAll(): Promise<number> {
  const db = getDB();
  const now = Date.now();
  let n = 0;
  await db.transaction("rw", db.sessions, db.rounds, db.transactions, db.outbox, async () => {
    for (const table of ORDER) {
      const records = (await db.table(table).toArray()) as (Stored & { id: string; sessionId?: string })[];
      const stamped = records.map((r) => (r.updatedAt ? r : { ...r, updatedAt: now }));
      await db.table(table).bulkPut(stamped);
      await db.outbox.bulkPut(
        stamped.map((r) => ({ key: `${table}:${r.id}`, table, id: r.id, op: "put" as const, sessionId: table === "sessions" ? r.id : (r.sessionId ?? ""), at: r.updatedAt ?? now })),
      );
      n += stamped.length;
    }
  });
  return n;
}

/** For when a different person signs in on the same phone: the phone's saved data belongs to the other account. */
export async function wipeLocal(): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.sessions, db.rounds, db.transactions, db.outbox, async () => {
    await Promise.all([db.sessions.clear(), db.rounds.clear(), db.transactions.clear(), db.outbox.clear()]);
  });
}

export const pendingCount = () => getDB().outbox.count();
