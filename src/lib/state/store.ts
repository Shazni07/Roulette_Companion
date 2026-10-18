import { create } from "zustand";
import { BettingError, previousPlusChips, removeBetFromPlan, setPositionChips, type BulkExtra } from "@/lib/roulette/betting";
import { insideGroups } from "@/lib/roulette/rules";
import { InventoryError } from "@/lib/roulette/inventory";
import {
  RoundError,
  clearDraft as clearDraftOp,
  completeRound,
  confirmRound,
  createRound,
  reopenRound,
  reverseSettlement,
  setMainNumbers,
  settleRound,
  withTotals,
} from "@/lib/roulette/rounds";
import {
  SessionError,
  addChipType,
  addMoney as addMoneyOp,
  chipsDone,
  createSession,
  editChipType,
  removeChipType,
} from "@/lib/roulette/session";
import { currencySymbol, formatMoney, loadCurrencyList, rememberSymbol } from "@/lib/roulette/money";
import { SettlementError } from "@/lib/roulette/settlement";
import type { Currency, InventoryTransaction, Round, Session } from "@/lib/roulette/types";
import * as db from "./db";

export type Screen =
  | "home"
  | "setup"
  | "resume"
  | "numbers"
  | "bets"
  | "review"
  | "winning"
  | "result"
  | "saved"
  | "keepnumbers"
  | "finish";

interface State {
  ready: boolean;
  error: string | null;
  notice: string | null;
  sessions: Session[];
  session: Session | null; // the session being played
  rounds: Round[]; // rounds of that session
  screen: Screen;
  /** Outside Bets are hidden when each round starts. This only controls visibility. */
  outsideVisible: boolean;

  init: () => Promise<void>;
  clearMessages: () => void;
  go: (s: Screen) => void;
  currentRound: () => Round | null;

  /** One step: money, currency and chips together. */
  startSession: (args: { currency: Currency; startingMoney: number; chips: { value: number; count: number }[]; mainNumbers?: number[] }) => Promise<boolean>;
  openSession: (id: string) => void;
  leaveSession: () => void;
  deleteSession: (id: string) => Promise<boolean>;
  addMoney: (amount: number) => Promise<boolean>;

  addChip: (value: number, count: number) => Promise<boolean>;
  editChip: (id: string, patch: { value?: number; count?: number }) => Promise<boolean>;
  removeChip: (id: string) => Promise<boolean>;
  /** +1 / −1 on the number of chips held, resolved against the latest saved count. */
  bumpChip: (id: string, delta: number) => Promise<boolean>;

  startRound: () => Promise<boolean>;
  setMain: (nums: number[]) => Promise<boolean>;
  toggleMain: (n: number) => Promise<boolean>;
  toggleOutside: () => void;
  /** Relative change resolved against the latest saved quantity, so fast taps never get lost. */
  adjustChips: (positionKey: string, denId: string, delta: number) => Promise<boolean>;
  removeBet: (betId: string) => Promise<boolean>;
  /** Sets last round's bets to last round's chips plus extra chips of one value (straights, splits, corners, streets, double streets). */
  applyPreviousPlus: (extra: BulkExtra, denominationId: string) => Promise<boolean>;
  clearDraft: () => Promise<boolean>;
  confirm: () => Promise<boolean>;
  reopen: (reason: string) => Promise<boolean>;
  settle: (n: number) => Promise<boolean>;
  reverse: (reason: string) => Promise<boolean>;
  saveRound: (opts: { finalCounts?: Record<string, number>; confirmedByUser?: boolean }) => Promise<boolean>;
  nextRound: () => Promise<boolean>;
  keepNumbers: (mode: "same" | "change" | "new") => Promise<boolean>;
  finishSession: () => Promise<boolean>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const KNOWN = [InventoryError, BettingError, RoundError, SessionError, SettlementError];

/** Where to take a returning player. Unfinished rounds are never confirmed or settled automatically. */
export function resumeTarget(session: Session, round: Round | null): Screen {
  if (!round) return session.totalRounds > 0 ? "saved" : "numbers";
  switch (round.roundStatus) {
    case "awaiting-result":
    case "confirmed":
      return "winning";
    case "settled":
      return "result";
    default:
      return round.selectedMainNumbers.length === 0 ? "numbers" : "bets";
  }
}

const hasUnfinishedRound = (round: Round | null) => !!round && (round.roundStatus !== "draft" || round.selectedMainNumbers.length > 0 || round.bets.length > 0);

export const useStore = create<State>((set, get) => {
  /** Persist FIRST; only after success is the on-screen state updated. */
  async function commit(opts: { session?: Session; round?: Round; transactions?: InventoryTransaction[]; notice?: string }): Promise<boolean> {
    try {
      await db.persist({ session: opts.session, rounds: opts.round ? [opts.round] : undefined, transactions: opts.transactions });
    } catch (e) {
      set({ error: `Saving did not work, so nothing was changed. Please try again. (${msg(e)})` });
      return false;
    }
    set((s) => {
      const rounds = opts.round
        ? s.rounds.some((r) => r.id === opts.round!.id)
          ? s.rounds.map((r) => (r.id === opts.round!.id ? opts.round! : r))
          : [...s.rounds, opts.round]
        : s.rounds;
      const session = opts.session ?? s.session;
      const sessions = opts.session
        ? s.sessions.some((x) => x.id === opts.session!.id)
          ? s.sessions.map((x) => (x.id === opts.session!.id ? opts.session! : x))
          : [...s.sessions, opts.session]
        : s.sessions;
      return { session, sessions, rounds, error: null, notice: opts.notice ?? s.notice };
    });
    return true;
  }

  /** Actions run one after another so quick taps always see the latest saved state. */
  let queue: Promise<unknown> = Promise.resolve();
  function guard(fn: () => Promise<boolean>): Promise<boolean> {
    const run = queue.then(async () => {
      try {
        set({ error: null });
        return await fn();
      } catch (e) {
        set({ error: KNOWN.some((k) => e instanceof k) ? msg(e) : `Unexpected problem: ${msg(e)}` });
        return false;
      }
    });
    queue = run;
    return run;
  }

  const needSession = (): Session => {
    const s = get().session;
    if (!s) throw new SessionError("No session is open.");
    return s;
  };
  const needRound = (): Round => {
    const r = get().currentRound();
    if (!r) throw new RoundError("There is no round to work on.");
    return r;
  };
  const locked = () => {
    const r = get().currentRound();
    return !!r && ["confirmed", "awaiting-result", "settled"].includes(r.roundStatus);
  };

  return {
    ready: false,
    error: null,
    notice: null,
    sessions: [],
    session: null,
    rounds: [],
    screen: "home",
    outsideVisible: false,

    init: async () => {
      try {
        const data = await db.loadAll();
        loadCurrencyList();
        for (const x of data.sessions) if (x.currencySymbol) rememberSymbol(x.currency, x.currencySymbol);
        set({ ready: true, sessions: data.sessions, session: null, rounds: [], screen: "home" });
      } catch (e) {
        set({ ready: true, error: `Could not open the saved data: ${msg(e)}` });
      }
    },
    clearMessages: () => set({ error: null, notice: null }),
    go: (screen) => set({ screen, error: null }),

    currentRound: () => {
      const { rounds, session } = get();
      if (!session) return null;
      return rounds.find((r) => !["completed", "cancelled"].includes(r.roundStatus)) ?? null;
    },

    startSession: ({ currency, startingMoney, chips, mainNumbers = [] }) =>
      guard(async () => {
        let session = createSession(currency, startingMoney, currencySymbol(currency));
        const transactions: InventoryTransaction[] = [];
        for (const c of chips) {
          const r = addChipType(session, c.value, c.count);
          session = r.session;
          transactions.push(r.transaction);
        }
        session = chipsDone(session); // needs at least one chip; the session is then ready to play
        const ok = await commit({ session, transactions });
        if (ok) {
          // numbers chosen on the start page go straight into round 1 and the player lands on the bets
          set({ rounds: [], screen: mainNumbers.length > 0 ? "bets" : "numbers", outsideVisible: false });
          void get()
            .startRound()
            .then(() => (mainNumbers.length > 0 ? get().setMain(mainNumbers) : true));
        }
        return ok;
      }),

    openSession: (id) => {
      const s = get().sessions.find((x) => x.id === id);
      if (!s) return;
      void (async () => {
        const rounds = await db.getDB().rounds.where("sessionId").equals(id).toArray();
        const cur = rounds.find((r) => !["completed", "cancelled"].includes(r.roundStatus)) ?? null;
        const target = resumeTarget(s, cur);
        set({ session: s, rounds, outsideVisible: false, screen: hasUnfinishedRound(cur) ? "resume" : target });
      })();
    },

    leaveSession: () => set({ session: null, rounds: [], screen: "home", outsideVisible: false }),

    deleteSession: (id) =>
      guard(async () => {
        await db.deleteSessionData(id);
        set((s) => ({
          sessions: s.sessions.filter((x) => x.id !== id),
          ...(s.session?.id === id ? { session: null, rounds: [], screen: "home" as Screen } : {}),
        }));
        return true;
      }),

    addMoney: (amount) =>
      guard(async () => {
        const res = addMoneyOp(needSession(), amount);
        return commit({ session: res.session, transactions: [res.transaction], notice: "Money added. Remember to add your new chips to My Chips." });
      }),

    addChip: (value, count) =>
      guard(async () => {
        if (locked()) throw new InventoryError("Your chips cannot be changed while a bet is waiting for its result.");
        const res = addChipType(needSession(), value, count);
        return commit({ session: res.session, transactions: [res.transaction] });
      }),

    editChip: (id, patch) =>
      guard(async () => {
        if (locked()) throw new InventoryError("Your chips cannot be changed while a bet is waiting for its result.");
        const res = editChipType(needSession(), id, patch);
        return commit({ session: res.session, transactions: [res.transaction] });
      }),

    bumpChip: (id, delta) =>
      guard(async () => {
        if (locked()) throw new InventoryError("Your chips cannot be changed while a bet is waiting for its result.");
        const s = needSession();
        const d = s.inventory.find((x) => x.id === id);
        if (!d) throw new InventoryError("That chip is not in your list.");
        const res = editChipType(s, id, { count: Math.max(0, d.availableCount + delta) });
        return commit({ session: res.session, transactions: [res.transaction] });
      }),

    removeChip: (id) =>
      guard(async () => {
        if (locked()) throw new InventoryError("Your chips cannot be changed while a bet is waiting for its result.");
        const res = removeChipType(needSession(), id);
        return commit({ session: res.session, transactions: [res.transaction] });
      }),

    startRound: () =>
      guard(async () => {
        const s = needSession();
        if (s.setupStep === "chips" || get().currentRound()) return true;
        const ok = await commit({ round: createRound(s, s.totalRounds + 1) });
        if (ok) set({ outsideVisible: false });
        return ok;
      }),

    setMain: (nums) =>
      guard(async () => {
        return commit({ round: setMainNumbers(needRound(), nums) });
      }),

    toggleMain: (n) =>
      guard(async () => {
        const r = needRound();
        const cur = r.selectedMainNumbers;
        return commit({ round: setMainNumbers(r, cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]) });
      }),

    toggleOutside: () => set((s) => ({ outsideVisible: !s.outsideVisible })),

    adjustChips: (positionKey, denId, delta) =>
      guard(async () => {
        const s = needSession();
        const r = needRound();
        if (r.roundStatus !== "draft" && r.roundStatus !== "planning") throw new RoundError("This round is confirmed. Choose Edit Bets to change it.");
        const betId = `${r.id}:${positionKey}`;
        const cur = r.bets.find((b) => b.id === betId)?.allocations.find((a) => a.denominationId === denId)?.quantity ?? 0;
        const res = setPositionChips(s.inventory, r.bets, r.id, positionKey, denId, Math.max(0, cur + delta), s.ruleset);
        let round = withTotals({ ...r, bets: res.bets });
        if (round.roundStatus === "draft") round = { ...round, roundStatus: "planning" };
        return commit({ session: { ...s, inventory: res.inventory }, round });
      }),

    applyPreviousPlus: (extra, denominationId) =>
      guard(async () => {
        const s = needSession();
        const r = needRound();
        if (r.roundStatus !== "draft" && r.roundStatus !== "planning") throw new RoundError("This round is confirmed. Choose Edit Bets to change it.");
        const prev = get()
          .rounds.filter((x) => x.roundStatus === "completed" && x.roundNumber < r.roundNumber)
          .sort((a, b) => b.roundNumber - a.roundNumber)[0];
        if (!prev) throw new RoundError("There is no previous round yet.");
        const allowedKeys = new Set(insideGroups(s.ruleset, r.selectedMainNumbers).flatMap((g) => g.positions.map((p) => p.key)));
        const res = previousPlusChips({
          inventory: s.inventory,
          bets: r.bets,
          roundId: r.id,
          previousBets: prev.bets,
          allowedKeys,
          extra,
          extraDenominationId: denominationId,
          ruleset: s.ruleset,
          fmt: (minor) => formatMoney(minor, s.currency),
        });
        let round = withTotals({ ...r, bets: res.bets });
        if (round.roundStatus === "draft") round = { ...round, roundStatus: "planning" };
        return commit({
          session: { ...s, inventory: res.inventory },
          round,
          notice: `Chips set on ${res.changed} bet${res.changed === 1 ? "" : "s"}: last round's chips plus your extra chips.`,
        });
      }),

    removeBet: (betId) =>
      guard(async () => {
        const s = needSession();
        const r = needRound();
        if (r.roundStatus !== "draft" && r.roundStatus !== "planning") throw new RoundError("This round is confirmed. Choose Edit Bets to change it.");
        const res = removeBetFromPlan(s.inventory, r.bets, betId);
        return commit({ session: { ...s, inventory: res.inventory }, round: withTotals({ ...r, bets: res.bets }) });
      }),

    clearDraft: () =>
      guard(async () => {
        const res = clearDraftOp(needSession(), needRound());
        const ok = await commit({ session: res.session, round: res.round, notice: "Cleared. Your saved rounds were not touched." });
        if (ok) set({ screen: "numbers", outsideVisible: false });
        return ok;
      }),

    confirm: () =>
      guard(async () => {
        const ok = await commit({ round: confirmRound(needSession(), needRound()) });
        if (ok) set({ screen: "winning" });
        return ok;
      }),

    reopen: (reason) =>
      guard(async () => {
        const ok = await commit({ round: reopenRound(needRound(), reason) });
        if (ok) set({ screen: "bets" });
        return ok;
      }),

    settle: (n) =>
      guard(async () => {
        const ok = await commit({ round: settleRound(needRound(), n) });
        if (ok) set({ screen: "result" });
        return ok;
      }),

    reverse: (reason) =>
      guard(async () => {
        const ok = await commit({ round: reverseSettlement(needRound(), reason) });
        if (ok) set({ screen: "winning" });
        return ok;
      }),

    saveRound: (opts) =>
      guard(async () => {
        const s = needSession();
        const r = needRound();
        const res = completeRound(s, r, get().rounds, opts);
        const ok = await commit({ session: res.session, round: res.round, transactions: res.transactions, notice: "Round Saved" });
        if (ok) set({ screen: "saved", outsideVisible: false });
        return ok;
      }),

    nextRound: () =>
      guard(async () => {
        const s = needSession();
        if (get().currentRound()) throw new RoundError("A round is already open.");
        const ok = await commit({ round: createRound(s, s.totalRounds + 1) });
        if (ok) set({ screen: "keepnumbers", outsideVisible: false });
        return ok;
      }),

    keepNumbers: (mode) =>
      guard(async () => {
        const r = needRound();
        const prev = get()
          .rounds.filter((x) => x.roundStatus === "completed")
          .sort((a, b) => b.roundNumber - a.roundNumber)[0];
        const nums = mode === "new" ? [] : (prev?.selectedMainNumbers ?? []);
        const ok = await commit({ round: setMainNumbers(r, nums) });
        if (ok) set({ screen: mode === "same" && nums.length > 0 ? "bets" : "numbers" });
        return ok;
      }),

    finishSession: () =>
      guard(async () => {
        let s = needSession();
        const r = get().currentRound();
        if (r && ["confirmed", "awaiting-result", "settled"].includes(r.roundStatus))
          throw new RoundError("Finish or go back on the current round first.");
        if (r) {
          const cleared = clearDraftOp(s, r);
          s = cleared.session;
          if (!(await commit({ session: s, round: { ...cleared.round, roundStatus: "cancelled" } }))) return false;
        }
        const finished: Session = { ...s, sessionStatus: "finished", finishedAt: Date.now() };
        const ok = await commit({ session: finished });
        if (ok) set({ screen: "finish" });
        return ok;
      }),
  };
});
