import Dexie, { type Table } from "dexie";
import type { InventoryTransaction, Round, Session } from "@/lib/roulette/types";

/** A new database name: this version stores a different shape than the first prototype. */
export const DB_NAME = "roulette-companion-v2";

/**
 * Local-first storage. The schema is versioned: when the stored shape changes,
 * add a `.version(n)` block with an `.upgrade()` callback.
 */
export class AppDB extends Dexie {
  sessions!: Table<Session, string>;
  rounds!: Table<Round, string>;
  transactions!: Table<InventoryTransaction, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      sessions: "id, startedAt, sessionStatus",
      rounds: "id, sessionId, roundNumber, roundStatus, [sessionId+roundNumber]",
      transactions: "id, sessionId, roundId, createdAt",
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

/** Writes session, rounds and transactions together or not at all. */
export async function persist(opts: { session?: Session; rounds?: Round[]; transactions?: InventoryTransaction[] }): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.sessions, db.rounds, db.transactions, async () => {
    if (opts.session) await db.sessions.put(opts.session);
    if (opts.rounds?.length) await db.rounds.bulkPut(opts.rounds);
    if (opts.transactions?.length) await db.transactions.bulkPut(opts.transactions);
  });
}

export async function deleteSessionData(sessionId: string): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.sessions, db.rounds, db.transactions, async () => {
    await db.rounds.where("sessionId").equals(sessionId).delete();
    await db.transactions.where("sessionId").equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

export async function transactionsFor(sessionId: string): Promise<InventoryTransaction[]> {
  return getDB().transactions.where("sessionId").equals(sessionId).toArray();
}
