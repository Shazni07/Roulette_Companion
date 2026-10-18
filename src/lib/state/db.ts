import Dexie, { type Table } from "dexie";
import type { InventoryTransaction, Round, Session } from "@/lib/roulette/types";

/** A new database name: this version stores a different shape than the first prototype. */
export const DB_NAME = "roulette-companion-v2";

/**
 * Local-first storage. The schema is versioned: when the stored shape changes,
 * add a `.version(n)` block with an `.upgrade()` callback.
 */
export type SyncTable = "sessions" | "rounds" | "transactions";

/** A change that still has to be sent online. One entry per record, so it never grows beyond the data itself. */
export interface OutboxEntry {
  key: string; // "rounds:abc"
  table: SyncTable;
  id: string;
  op: "put" | "delete";
  /** Which session the record belongs to (a session's own id for the session). */
  sessionId: string;
  at: number;
}

export class AppDB extends Dexie {
  sessions!: Table<Session, string>;
  rounds!: Table<Round, string>;
  transactions!: Table<InventoryTransaction, string>;
  outbox!: Table<OutboxEntry, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      sessions: "id, startedAt, sessionStatus",
      rounds: "id, sessionId, roundNumber, roundStatus, [sessionId+roundNumber]",
      transactions: "id, sessionId, roundId, createdAt",
    });
    // version 2: a list of changes waiting to be sent online (existing data is untouched)
    this.version(2).stores({
      sessions: "id, startedAt, sessionStatus",
      rounds: "id, sessionId, roundNumber, roundStatus, [sessionId+roundNumber]",
      transactions: "id, sessionId, roundId, createdAt",
      outbox: "key, table, sessionId",
    });
  }
}

let _db: AppDB | null = null;
export function getDB(): AppDB {
  if (!_db) _db = new AppDB();
  return _db;
}
/** Test helper: switch to a fresh database. */
export function resetDB(name: string): AppDB {
  _db = new AppDB(name);
  return _db;
}

export interface LoadedState {
  sessions: Session[];
  rounds: Round[];
}

export async function loadAll(): Promise<LoadedState> {
  const db = getDB();
  const [sessions, rounds] = await Promise.all([db.sessions.toArray(), db.rounds.toArray()]);
  return { sessions, rounds };
}

/** Called after something was saved on this phone, so the online copy can be brought up to date. */
let changeListener: (() => void) | null = null;
export function setChangeListener(fn: (() => void) | null): void {
  changeListener = fn;
}

const entry = (table: SyncTable, id: string, sessionId: string, op: OutboxEntry["op"], at: number): OutboxEntry => ({ key: `${table}:${id}`, table, id, op, sessionId, at });

/** Writes session, rounds and transactions together or not at all. Each is stamped and queued to be sent online. */
export async function persist(opts: { session?: Session; rounds?: Round[]; transactions?: InventoryTransaction[] }): Promise<void> {
  const db = getDB();
  const at = Date.now();
  await db.transaction("rw", db.sessions, db.rounds, db.transactions, db.outbox, async () => {
    if (opts.session) {
      await db.sessions.put({ ...opts.session, updatedAt: at });
      await db.outbox.put(entry("sessions", opts.session.id, opts.session.id, "put", at));
    }
    if (opts.rounds?.length) {
      await db.rounds.bulkPut(opts.rounds.map((r) => ({ ...r, updatedAt: at })));
      await db.outbox.bulkPut(opts.rounds.map((r) => entry("rounds", r.id, r.sessionId, "put", at)));
    }
    if (opts.transactions?.length) {
      await db.transactions.bulkPut(opts.transactions.map((t) => ({ ...t, updatedAt: at })));
      await db.outbox.bulkPut(opts.transactions.map((t) => entry("transactions", t.id, t.sessionId, "put", at)));
    }
  });
  changeListener?.();
}

/** Deletes a session here and queues one "deleted" note, so it also disappears online and on other phones. */
export async function deleteSessionData(sessionId: string): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.sessions, db.rounds, db.transactions, db.outbox, async () => {
    await db.rounds.where("sessionId").equals(sessionId).delete();
    await db.transactions.where("sessionId").equals(sessionId).delete();
    await db.sessions.delete(sessionId);
    await db.outbox.where("sessionId").equals(sessionId).delete();
    await db.outbox.put(entry("sessions", sessionId, sessionId, "delete", Date.now()));
  });
  changeListener?.();
}

export async function transactionsFor(sessionId: string): Promise<InventoryTransaction[]> {
  return getDB().transactions.where("sessionId").equals(sessionId).toArray();
}
