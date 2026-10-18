import { beforeEach, describe, expect, it } from "vitest";
import { createRound } from "@/lib/roulette/rounds";
import { addChipType, chipsDone, createSession } from "@/lib/roulette/session";
import type { InventoryTransaction, Session } from "@/lib/roulette/types";
import { deleteSessionData, getDB, persist, resetDB, type SyncTable } from "@/lib/state/db";
import { enqueueAll, pendingCount, pull, push, wipeLocal, type Remote, type RemoteRow } from "./engine";

/** The online store, in memory. It follows the same rule as the SQL file: an older copy never replaces a newer one. */
class FakeRemote implements Remote {
  tables: Record<SyncTable, Map<string, RemoteRow>> = { sessions: new Map(), rounds: new Map(), transactions: new Map() };
  failNext = false;
  upserts = 0;
  async upsert(table: SyncTable, rows: RemoteRow[]) {
    if (this.failNext) {
      this.failNext = false;
      throw new TypeError("Failed to fetch");
    }
    for (const r of rows) {
      const old = this.tables[table].get(r.id);
      if (old && r.updated_at < old.updated_at) continue;
      this.tables[table].set(r.id, structuredClone(r));
      this.upserts++;
    }
  }
  async deleteSessionChildren(sessionId: string) {
    for (const t of ["rounds", "transactions"] as const) for (const [id, r] of this.tables[t]) if (r.session_id === sessionId) this.tables[t].delete(id);
  }
  async fetchAll(table: SyncTable) {
    return [...this.tables[table].values()].map((r) => structuredClone(r));
  }
}

let n = 0;
/** "Phones": each one is its own local database. */
const phone = () => resetDB(`sync-test-${++n}-${Math.random()}`);

const readySession = (): Session => {
  let s = createSession("LKR", 500000);
  s = addChipType(s, 50000, 10).session;
  return chipsDone(s);
};
const tx = (s: Session): InventoryTransaction => ({ id: `t-${s.id}`, sessionId: s.id, roundId: null, denominationId: null, transactionType: "initial", quantityChange: 1, monetaryChange: 100, createdAt: 1, reason: "x" });

beforeEach(() => {
  phone();
});

describe("saving on the phone queues the change", () => {
  it("stamps each record and keeps one waiting entry per record", async () => {
    const s = readySession();
    const r = createRound(s, 1);
    await persist({ session: s, rounds: [r], transactions: [tx(s)] });
    await persist({ session: s }); // same session again: still one entry
    expect(await pendingCount()).toBe(3);
    expect((await getDB().sessions.get(s.id))?.updatedAt).toBeGreaterThan(0);
    expect((await getDB().rounds.get(r.id))?.updatedAt).toBeGreaterThan(0);
  });
});

describe("push", () => {
  it("sends everything waiting, then the queue is empty", async () => {
    const remote = new FakeRemote();
    const s = readySession();
    const r = createRound(s, 1);
    await persist({ session: s, rounds: [r], transactions: [tx(s)] });
    expect(await push(remote)).toBe(3);
    expect(remote.tables.sessions.get(s.id)?.deleted).toBe(false);
    expect(remote.tables.rounds.get(r.id)?.session_id).toBe(s.id);
    expect(remote.tables.transactions.size).toBe(1);
    expect(await pendingCount()).toBe(0);
    expect(await push(remote)).toBe(0); // nothing more to send
  });

  it("keeps the queue when sending fails (no internet), and sends it next time", async () => {
    const remote = new FakeRemote();
    const s = readySession();
    await persist({ session: s });
    remote.failNext = true;
    await expect(push(remote)).rejects.toThrow("Failed to fetch");
    expect(await pendingCount()).toBe(1);
    await push(remote);
    expect(await pendingCount()).toBe(0);
    expect(remote.tables.sessions.size).toBe(1);
  });

  it("a change made while sending is not forgotten", async () => {
    const s = readySession();
    await persist({ session: s });
    const slow: Remote = {
      upsert: async () => {
        await new Promise((r) => setTimeout(r, 5));
        await persist({ session: { ...s, totalRounds: 9 } }); // the player saves again mid-upload
      },
      deleteSessionChildren: async () => {},
      fetchAll: async () => [],
    };
    await push(slow);
    expect(await pendingCount()).toBe(1);
  });
});

describe("pull", () => {
  it("a second phone receives sessions, rounds and chips saved by the first", async () => {
    const remote = new FakeRemote();
    const s = readySession();
    const r = createRound(s, 1);
    await persist({ session: s, rounds: [r], transactions: [tx(s)] });
    await push(remote);

    phone(); // the other phone
    expect(await pull(remote)).toBe(true);
    expect((await getDB().sessions.toArray()).map((x) => x.id)).toEqual([s.id]);
    expect(await getDB().rounds.count()).toBe(1);
    expect(await getDB().transactions.count()).toBe(1);
    expect(await pendingCount()).toBe(0); // received data is not sent back
    expect(await pull(remote)).toBe(false); // nothing new the second time
  });

  it("takes a newer online copy but never replaces a newer local one", async () => {
    const remote = new FakeRemote();
    const s = readySession();
    await persist({ session: s });
    await push(remote);
    const row = remote.tables.sessions.get(s.id)!;

    remote.tables.sessions.set(s.id, { ...row, updated_at: row.updated_at + 1000, data: { ...(row.data as Session), totalRounds: 7 } });
    await pull(remote);
    expect((await getDB().sessions.get(s.id))?.totalRounds).toBe(7);

    remote.tables.sessions.set(s.id, { ...row, updated_at: 1, data: { ...(row.data as Session), totalRounds: 99 } }); // old copy online
    await pull(remote);
    expect((await getDB().sessions.get(s.id))?.totalRounds).toBe(7);
  });

  it("a change still waiting on this phone is never overwritten by the pull", async () => {
    const remote = new FakeRemote();
    const s = readySession();
    await persist({ session: s });
    await push(remote);
    await persist({ session: { ...s, totalRounds: 3 } }); // changed here, not sent yet
    const row = remote.tables.sessions.get(s.id)!;
    remote.tables.sessions.set(s.id, { ...row, updated_at: Date.now() + 100000, data: { ...(row.data as Session), totalRounds: 50 } });
    await pull(remote);
    expect((await getDB().sessions.get(s.id))?.totalRounds).toBe(3);
  });
});

describe("the server's rule: older never replaces newer", () => {
  it("an offline phone that sends late cannot undo a newer change", async () => {
    const remote = new FakeRemote();
    const s = readySession();
    await persist({ session: { ...s, totalRounds: 1 } });
    await new Promise((r) => setTimeout(r, 5));
    const stale = await getDB().sessions.get(s.id); // phone A's old copy, kept offline
    phone(); // phone B
    await persist({ session: { ...s, totalRounds: 2 } });
    await push(remote);
    phone(); // back to phone A, which still has its older queued change
    await getDB().sessions.put(stale!);
    await getDB().outbox.put({ key: `sessions:${s.id}`, table: "sessions", id: s.id, op: "put", sessionId: s.id, at: stale!.updatedAt! });
    await push(remote);
    expect((remote.tables.sessions.get(s.id)?.data as Session).totalRounds).toBe(2);
  });
});

describe("deleting a session", () => {
  it("removes it online and on the other phone, which only had it saved", async () => {
    const remote = new FakeRemote();
    const s = readySession();
    const keep = readySession();
    await persist({ session: s, rounds: [createRound(s, 1)], transactions: [tx(s)] });
    await persist({ session: keep });
    await push(remote);
    const phoneA = getDB();

    phone(); // phone B receives both
    await pull(remote);
    expect(await getDB().sessions.count()).toBe(2);

    // phone A deletes one
    resetDB(phoneA.name);
    await deleteSessionData(s.id);
    expect(await getDB().rounds.count()).toBe(0);
    await push(remote);
    expect(remote.tables.sessions.get(s.id)?.deleted).toBe(true);
    expect(remote.tables.rounds.size).toBe(0);
    expect(remote.tables.transactions.size).toBe(0);

    // phone B follows
    phone();
    await pull(remote); // (a fresh phone must not receive the deleted session at all)
    expect((await getDB().sessions.toArray()).map((x) => x.id)).toEqual([keep.id]);
  });

  it("an existing phone loses the deleted session on the next pull", async () => {
    const remote = new FakeRemote();
    const s = readySession();
    await persist({ session: s, rounds: [createRound(s, 1)] });
    await push(remote);
    const a = getDB();
    phone();
    await pull(remote);
    const b = getDB();
    resetDB(a.name);
    await deleteSessionData(s.id);
    await push(remote);
    resetDB(b.name);
    expect(await pull(remote)).toBe(true);
    expect(await getDB().sessions.count()).toBe(0);
    expect(await getDB().rounds.count()).toBe(0);
  });
});

describe("first sign-in on a phone that already has sessions", () => {
  it("uploads what was saved before online storage existed", async () => {
    const s = readySession();
    // saved the old way: no stamp and no queue entry
    await getDB().sessions.put(s);
    await getDB().rounds.put(createRound(s, 1));
    expect(await pendingCount()).toBe(0);
    expect(await enqueueAll()).toBe(2);
    expect(await pendingCount()).toBe(2);
    const remote = new FakeRemote();
    await push(remote);
    expect(remote.tables.sessions.size).toBe(1);
    expect(remote.tables.rounds.size).toBe(1);
  });

  it("wipeLocal leaves an empty phone for a different account", async () => {
    await persist({ session: readySession() });
    await wipeLocal();
    expect(await getDB().sessions.count()).toBe(0);
    expect(await pendingCount()).toBe(0);
  });
});
