import { beforeEach, describe, expect, it } from "vitest";
import { rs } from "@/tests/helpers";
import { inventoryTotals } from "@/lib/roulette/inventory";
import { buildHistoryIndex } from "@/lib/roulette/history";
import { positionKey } from "@/lib/roulette/rules";
import { sessionBalance } from "@/lib/roulette/session";
import * as db from "./db";
import { resumeTarget, useStore } from "./store";

const blank = () =>
  useStore.setState({ ready: false, error: null, notice: null, sessions: [], session: null, rounds: [], screen: "home", outsideVisible: false });

let n = 0;
beforeEach(async () => {
  db.resetDB(`t-${n++}-${Math.random()}`);
  blank();
  await useStore.getState().init();
});

const S = () => useStore.getState();

async function setup(money = rs(20000)) {
  expect(
    await S().startSession({
      currency: "LKR",
      startingMoney: money,
      chips: [
        { value: rs(100), count: 10 },
        { value: rs(500), count: 10 },
        { value: rs(1000), count: 5 },
      ],
    }),
  ).toBe(true);
  expect(S().screen).toBe("numbers"); // money, currency and chips are one step now
  await S().startRound();
}

const den = (value: number) => S().session!.inventory.find((d) => d.value === value)!;

/** Plays one round: chips on straight 7 (2 × 100) and red (1 × 500); returns after "Save Round". */
async function playRound1(winning: number) {
  await S().setMain([7]);
  await S().adjustChips(positionKey("straight", [7]), den(rs(100)).id, 2);
  const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  await S().adjustChips(positionKey("red", red), den(rs(500)).id, 1);
  expect(await S().confirm()).toBe(true);
  expect(S().screen).toBe("winning");
  expect(await S().settle(winning)).toBe(true);
  expect(S().screen).toBe("result");
  expect(await S().saveRound({})).toBe(true);
  expect(S().screen).toBe("saved");
}

describe("Test 1–3 – start a session", () => {
  it("one step (money, currency, chips) creates an active session", async () => {
    await setup();
    const s = S().session!;
    expect(s.startingMoney).toBe(rs(20000));
    expect(s.sessionStatus).toBe("active");
    expect(inventoryTotals(s.inventory)).toMatchObject({ totalChips: 25, totalValue: rs(11000) });
    expect(S().currentRound()!.roundNumber).toBe(1);
  });
  it("add more money keeps the original amount and does not add chips", async () => {
    await setup();
    expect(await S().addMoney(rs(5000))).toBe(true);
    const s = S().session!;
    expect(s.startingMoney).toBe(rs(20000));
    expect(s.additions).toHaveLength(1);
    expect(sessionBalance(s, S().rounds)).toBe(rs(25000));
    expect(inventoryTotals(s.inventory).totalChips).toBe(25);
    expect(await S().addMoney(0)).toBe(false);
  });
  it("starting a new session never deletes an unfinished one", async () => {
    await setup();
    const first = S().session!.id;
    S().leaveSession();
    await S().startSession({ currency: "INR", startingMoney: rs(100), chips: [{ value: rs(10), count: 10 }] });
    expect(S().sessions.map((x) => x.id)).toContain(first);
    expect(S().sessions).toHaveLength(2);
  });
});

describe("Test 6 – outside bets hidden by default", () => {
  it("starts hidden every round; the toggle only changes visibility", async () => {
    await setup();
    expect(S().outsideVisible).toBe(false);
    await S().setMain([7]);
    const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    S().toggleOutside();
    expect(S().outsideVisible).toBe(true);
    await S().adjustChips(positionKey("red", red), den(rs(100)).id, 2);
    S().toggleOutside(); // hide again
    expect(S().outsideVisible).toBe(false);
    expect(S().currentRound()!.bets).toHaveLength(1); // not deleted
    expect(inventoryTotals(S().session!.inventory).allocatedChips).toBe(2);
    // a new round starts hidden even if it was visible when the last one finished
    S().toggleOutside();
    await S().adjustChips(positionKey("red", red), den(rs(100)).id, -2);
    expect(await S().confirm()).toBe(false); // nothing to confirm
    expect(await S().clearDraft()).toBe(true);
    expect(S().outsideVisible).toBe(false);
  });
});

describe("Test 22 / 23 – save, continue, refresh", () => {
  it("saves once, keeps the totals consistent and survives a refresh", async () => {
    await setup();
    await playRound1(0); // both bets lose: −700
    const r = S().rounds.find((x) => x.roundStatus === "completed")!;
    expect(r.netResult).toBe(-rs(700));
    expect(S().session!.totalRounds).toBe(1);
    expect(sessionBalance(S().session!, S().rounds)).toBe(rs(20000) - rs(700));
    expect(await S().saveRound({})).toBe(false); // already saved / no open round
    expect(S().rounds.filter((x) => x.roundStatus === "completed")).toHaveLength(1);

    const id = S().session!.id;
    blank();
    await S().init(); // simulate a browser refresh
    expect(S().sessions.map((x) => x.id)).toContain(id);
    S().openSession(id);
    await new Promise((res) => setTimeout(res, 100));
    expect(S().rounds.filter((x) => x.roundStatus === "completed")).toHaveLength(1);
    expect(S().rounds[0]!.netResult).toBe(-rs(700));
    expect(S().screen).toBe("saved"); // no open round: asks if the player wants another
  });

  it("next round starts clean; keep / change / new numbers; history comes from saved rounds", async () => {
    await setup();
    await playRound1(0);
    expect(await S().nextRound()).toBe(true);
    expect(S().screen).toBe("keepnumbers");
    const r2 = S().currentRound()!;
    expect(r2.roundNumber).toBe(2);
    expect(r2.bets).toEqual([]);
    expect(r2.selectedMainNumbers).toEqual([]);
    expect(await S().keepNumbers("same")).toBe(true);
    expect(S().currentRound()!.selectedMainNumbers).toEqual([7]);
    expect(S().screen).toBe("bets");
    const h = buildHistoryIndex(S().rounds, 2).get(positionKey("straight", [7]));
    expect(h.previous.chips).toBe(2);
    expect(h.cumulative.chips).toBe(2);
    // current input starts at zero – nothing is copied
    expect(S().currentRound()!.totalChips).toBe(0);
    expect(inventoryTotals(S().session!.inventory).allocatedChips).toBe(0);
    expect(await S().keepNumbers("new")).toBe(true);
    expect(S().currentRound()!.selectedMainNumbers).toEqual([]);
    expect(S().screen).toBe("numbers");
  });

  it("an unfinished round is restored after a refresh and must be reviewed, never auto-confirmed", async () => {
    await setup();
    await S().setMain([7, 16]);
    await S().adjustChips(positionKey("straight", [7]), den(rs(100)).id, 3);
    const id = S().session!.id;
    blank();
    await S().init();
    S().openSession(id);
    await new Promise((res) => setTimeout(res, 100));
    expect(S().screen).toBe("resume");
    const r = S().currentRound()!;
    expect(r.roundStatus).toBe("planning");
    expect(r.bets[0]!.chipCount).toBe(3);
    expect(inventoryTotals(S().session!.inventory).allocatedChips).toBe(3);
    expect(resumeTarget(S().session!, r)).toBe("bets");
    expect(r.confirmedAt).toBeNull();
  });
});

describe("rapid taps are never lost", () => {
  it("quick + taps and quick number taps accumulate", async () => {
    await setup();
    await Promise.all([7, 16, 25].map((x) => S().toggleMain(x)));
    expect(S().currentRound()!.selectedMainNumbers).toEqual([7, 16, 25]);
    const key = positionKey("straight", [7]);
    const d = den(rs(100)).id;
    await Promise.all([1, 2, 3].map(() => S().adjustChips(key, d, 1)));
    expect(S().currentRound()!.bets[0]!.chipCount).toBe(3);
    await S().adjustChips(key, d, -50);
    expect(S().currentRound()!.bets).toHaveLength(0);
    expect(await S().adjustChips(key, d, 999)).toBe(false);
    expect(S().error).toMatch(/only have/);
  });
});

describe("Test 24 – clear draft", () => {
  it("releases reservations and leaves saved rounds alone", async () => {
    await setup();
    await playRound1(0);
    await S().nextRound();
    await S().keepNumbers("same");
    await S().adjustChips(positionKey("straight", [7]), den(rs(500)).id, 3);
    expect(inventoryTotals(S().session!.inventory).allocatedChips).toBe(3);
    expect(await S().clearDraft()).toBe(true);
    expect(inventoryTotals(S().session!.inventory).allocatedChips).toBe(0);
    expect(S().rounds.filter((x) => x.roundStatus === "completed")).toHaveLength(1);
  });
});

describe("finishing and deleting", () => {
  it("finishing keeps the records; deleting a session is a separate step", async () => {
    await setup();
    await playRound1(0);
    expect(await S().finishSession()).toBe(true);
    expect(S().screen).toBe("finish");
    expect(S().session!.sessionStatus).toBe("finished");
    const id = S().session!.id;
    const saved = await db.getDB().rounds.where("sessionId").equals(id).toArray();
    expect(saved.filter((r) => r.roundStatus === "completed")).toHaveLength(1);
    expect(await S().deleteSession(id)).toBe(true);
    expect((await db.getDB().rounds.where("sessionId").equals(id).toArray()).length).toBe(0);
  });
  it("chips cannot be edited while a bet waits for its result", async () => {
    await setup();
    await S().setMain([7]);
    await S().adjustChips(positionKey("straight", [7]), den(rs(100)).id, 1);
    await S().confirm();
    expect(await S().addChip(rs(50), 1)).toBe(false);
    expect(S().error).toMatch(/waiting for its result/);
  });
});

describe("Add Chips (last round + extra) through the store", () => {
  it("sets last round's bets to the same chips plus extra; needs a previous round", async () => {
    await setup();
    await S().setMain([7]);
    expect(await S().applyPreviousPlus({ straight: 1, split: 0, corner: 0, street: 0, sixLine: 0 }, den(rs(100)).id)).toBe(false);
    expect(S().error).toMatch(/no previous round/);

    await playRound1(0); // round 1: straight 7 = 2 x 100, red = 1 x 500
    await S().nextRound();
    await S().keepNumbers("same");
    const key = positionKey("straight", [7]);
    const betChips = () => S().currentRound()!.bets.find((b) => b.key === key)?.chipCount ?? 0;
    expect(betChips()).toBe(0); // nothing is copied automatically

    expect(await S().applyPreviousPlus({ straight: 3, split: 0, corner: 0, street: 0, sixLine: 0 }, den(rs(100)).id)).toBe(true);
    expect(betChips()).toBe(5); // 2 from last round + 3 extra
    expect(S().currentRound()!.bets).toHaveLength(1); // the red bet (outside) is not set
    expect(S().currentRound()!.totalChips).toBe(5);
    expect(inventoryTotals(S().session!.inventory).allocatedChips).toBe(5);
    expect(S().notice).toMatch(/Chips set on 1 bet/);

    // a second press replaces rather than piles up
    await S().applyPreviousPlus({ straight: 3, split: 0, corner: 0, street: 0, sixLine: 0 }, den(rs(100)).id);
    expect(betChips()).toBe(5);

    // too many: refused, nothing changes
    expect(await S().applyPreviousPlus({ straight: 5000, split: 0, corner: 0, street: 0, sixLine: 0 }, den(rs(100)).id)).toBe(false);
    expect(S().error).toMatch(/not have enough chips/);
    expect(betChips()).toBe(5);
  });

  it("is refused once the round is confirmed", async () => {
    await setup();
    await playRound1(0);
    await S().nextRound();
    await S().keepNumbers("same");
    await S().adjustChips(positionKey("straight", [7]), den(rs(100)).id, 1);
    await S().confirm();
    expect(await S().applyPreviousPlus({ straight: 1, split: 0, corner: 0, street: 0, sixLine: 0 }, den(rs(100)).id)).toBe(false);
    expect(S().error).toMatch(/confirmed/);
  });
});
