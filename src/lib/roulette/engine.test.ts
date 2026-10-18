import { describe, expect, it } from "vitest";
import { makeSession, rs } from "@/tests/helpers";
import { emptyBulkExtra, previousPlusChips, removeBetFromPlan, roundProblems, roundTotals, setPositionChips } from "./betting";
import { estimateHoldings, holdingsTotals } from "./chips";
import { buildHistoryIndex, positionHistory, projectedCumulative, roundsLabel } from "./history";
import { inventoryTotals, createInventory } from "./inventory";
import { insideGroups, positionKey } from "./rules";
import { clearDraft, completeRound, confirmRound, createRound, reopenRound, reverseSettlement, setMainNumbers, settleRound, withTotals } from "./rounds";
import { addChipType, addMoney, chipsDone, createSession, editChipType, removeChipType, sessionBalance, totalAdded, totalProfitLoss, allRoundsTotals } from "./session";
import { resultIfNumberWins, settleBets } from "./settlement";
import type { BetPosition, BetType, Round, Session } from "./types";

type Spec = [BetType, number[], [number, number][]][]; // [type, numbers, [[chip value (major units), qty]]]

const big = () =>
  makeSession([
    { value: rs(100), count: 60 },
    { value: rs(500), count: 60 },
    { value: rs(1000), count: 30 },
  ]);

/** Builds a planned (unconfirmed) round with the given chips. */
function plan(session: Session, spec: Spec, roundNumber = session.totalRounds + 1, mains: number[] = [7]) {
  let round = setMainNumbers(createRound(session, roundNumber), mains);
  let inv = session.inventory;
  let bets: BetPosition[] = [];
  for (const [type, numbers, chips] of spec) {
    for (const [major, qty] of chips) {
      const den = inv.find((d) => d.value === rs(major))!;
      const r = setPositionChips(inv, bets, round.id, positionKey(type, numbers), den.id, qty, session.ruleset);
      inv = r.inventory;
      bets = r.bets;
    }
  }
  round = withTotals({ ...round, bets });
  return { session: { ...session, inventory: inv }, round };
}

/** Plays and SAVES a whole round; returns the updated session and all saved rounds. */
function playRound(session: Session, saved: Round[], spec: Spec, winning: number, mains: number[] = [7], finalCounts?: Record<string, number>) {
  const p = plan(session, spec, session.totalRounds + 1, mains);
  const confirmed = confirmRound(p.session, p.round);
  const settled = settleRound(confirmed, winning);
  const done = completeRound(p.session, settled, saved, { finalCounts });
  return { session: done.session, round: done.round, rounds: [...saved, done.round], txs: done.transactions };
}

const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

describe("Test 1 & 2 – session money", () => {
  it("creates a session with the starting amount", () => {
    const s = createSession("LKR", rs(20000));
    expect(s.startingMoney).toBe(rs(20000));
    expect(s.sessionStatus).toBe("setup");
    expect(s.additions).toEqual([]);
    expect(() => createSession("LKR", 0)).toThrow(/above zero/);
    expect(() => createSession("LKR", -5)).toThrow();
  });
  it("adding money records it separately and never overwrites the starting amount", () => {
    const s = makeSession();
    const a = addMoney(s, rs(5000));
    expect(a.session.startingMoney).toBe(rs(20000));
    expect(a.session.additions).toHaveLength(1);
    expect(sessionBalance(a.session, [])).toBe(rs(25000));
    const b = addMoney(a.session, rs(1000));
    expect(b.session.additions.map((x) => x.amount)).toEqual([rs(5000), rs(1000)]);
    expect(sessionBalance(b.session, [])).toBe(rs(26000));
    expect(a.transaction.transactionType).toBe("money-added");
    // adding money does NOT create chips
    expect(inventoryTotals(b.session.inventory).totalChips).toBe(25);
    expect(() => addMoney(s, 0)).toThrow();
  });
});

describe("Test 3 – chip inventory", () => {
  it("totals chip count and value; rejects bad entries", () => {
    const s = makeSession();
    const t = inventoryTotals(s.inventory);
    expect(t.totalChips).toBe(25);
    expect(t.totalValue).toBe(rs(11000));
    expect(() => addChipType(s, rs(100), 3)).toThrow(/already exists/);
    expect(() => addChipType(s, rs(50), -1)).toThrow(/negative/);
    expect(() => addChipType(s, rs(50), 1.5)).toThrow(/whole/);
    expect(() => addChipType(s, 0, 1)).toThrow();
    expect(() => createInventory([{ value: 100, count: 1 }, { value: 100, count: 1 }])).toThrow();
  });
  it("edits and removes safely", () => {
    let s = makeSession();
    const d = s.inventory.find((x) => x.value === rs(500))!;
    s = editChipType(s, d.id, { count: 12 }).session;
    expect(inventoryTotals(s.inventory).totalValue).toBe(rs(12000)); // 11,000 + two more Rs. 500 chips
    s = editChipType(s, d.id, { value: rs(250) }).session;
    expect(s.inventory.some((x) => x.value === rs(250))).toBe(true);
    s = removeChipType(s, d.id).session;
    expect(s.inventory).toHaveLength(2);
    expect(() => chipsDone({ ...s, inventory: [] })).toThrow(/at least one/);
  });
});

describe("Test 7 & 8 – chip allocation and inventory", () => {
  it("computes stake and chip count per bet and per round", () => {
    const { round, session } = plan(makeSession(), [
      ["split", [7, 8], [[100, 2], [500, 1]]],
      ["straight", [7], [[1000, 1]]],
    ]);
    const split = round.bets.find((b) => b.key === positionKey("split", [7, 8]))!;
    expect(split.stake).toBe(rs(700));
    expect(split.chipCount).toBe(3);
    expect(roundTotals(round.bets)).toEqual({ totalBet: rs(1700), totalChips: 4, positions: 2 });
    const t = inventoryTotals(session.inventory);
    expect(t.allocatedChips).toBe(4);
    expect(t.availableChips).toBe(21);
    expect(t.totalValue).toBe(rs(11000)); // nothing double-counted
  });
  it("a chip cannot be placed twice and removing chips frees them", () => {
    const s = makeSession();
    const { round, session } = plan(s, [["straight", [7], [[1000, 4]]]]);
    const den = session.inventory.find((d) => d.value === rs(1000))!;
    expect(() => setPositionChips(session.inventory, round.bets, round.id, positionKey("straight", [8]), den.id, 2, s.ruleset)).toThrow(/only have 1 more/);
    const ok = setPositionChips(session.inventory, round.bets, round.id, positionKey("straight", [8]), den.id, 1, s.ruleset);
    expect(ok.bets).toHaveLength(2);
    const back = setPositionChips(ok.inventory, ok.bets, round.id, positionKey("straight", [7]), den.id, 0, s.ruleset);
    expect(back.bets).toHaveLength(1); // position disappears when its last chip is removed
    expect(back.inventory.find((d) => d.id === den.id)!.availableCount).toBe(4);
    expect(() => setPositionChips(session.inventory, round.bets, round.id, positionKey("straight", [7]), den.id, -1, s.ruleset)).toThrow(/below zero/);
    expect(() => setPositionChips(session.inventory, round.bets, round.id, positionKey("straight", [7]), den.id, 1.5, s.ruleset)).toThrow(/whole/);
    expect(() => setPositionChips(session.inventory, round.bets, round.id, positionKey("straight", [7]), "nope", 1, s.ruleset)).toThrow();
    const r2 = removeBetFromPlan(ok.inventory, ok.bets, `${round.id}:${positionKey("straight", [8])}`);
    expect(r2.bets).toHaveLength(1);
  });
  it("Test 5: the same position can only ever be one bet", () => {
    const s = makeSession();
    const p = plan(s, [["split", [7, 8], [[100, 1]]]]);
    const den = p.session.inventory.find((d) => d.value === rs(500))!;
    // "adding" split 8/7 again from the other number group updates the same bet
    const more = setPositionChips(p.session.inventory, p.round.bets, p.round.id, positionKey("split", [8, 7]), den.id, 1, s.ruleset);
    expect(more.bets).toHaveLength(1);
    expect(more.bets[0]!.chipCount).toBe(2);
  });
});

describe("no betting limits", () => {
  it("any amount of chips is accepted on a bet; only a bet with no chips is blocked", () => {
    const s = makeSession([{ value: rs(1000), count: 5000 }]);
    const big = plan(s, [["straight", [7], [[1000, 4000]]]]).round.bets[0]!; // Rs. 4,000,000 on one bet
    expect(big.validationStatus).toBe("valid");
    expect(big.stake).toBe(rs(4_000_000));
    expect(plan(makeSession(), [["straight", [7], [[100, 1]]]]).round.bets[0]!.validationStatus).toBe("valid");
    const empty = plan(makeSession(), [["straight", [7], []]]).round;
    expect(roundProblems(empty.bets)).toEqual(["Choose at least one bet and place some chips on it."]);
  });
});

function bet(key: string, stake: number, mult: number, covered: number[], chips = 1): BetPosition {
  return {
    id: key, roundId: "r", key, betType: "straight", category: "inside", label: key, coveredNumbers: covered,
    payoutMultiplier: mult, stake, chipCount: chips, allocations: [],     validationStatus: "valid", validationMessage: null, settlementStatus: "pending", winningProfit: 0, returnedStake: 0, totalPayout: 0, lostStake: 0,
  };
}

describe("Tests 10–14 – settlement", () => {
  it("10: Rs.100 straight win = Rs.3,500 profit, Rs.3,600 return", () => {
    const r = settleBets([bet("s7", rs(100), 35, [7])], 7);
    expect(r.grossWinningProfit).toBe(rs(3500));
    expect(r.totalPayout).toBe(rs(3600));
    expect(r.netResult).toBe(rs(3500));
  });
  it("11: a losing bet loses its full stake", () => {
    const r = settleBets([bet("s7", rs(100), 35, [7])], 8);
    expect(r.grossLoss).toBe(rs(100));
    expect(r.netResult).toBe(-rs(100));
  });
  it("12: overlapping positions settle independently", () => {
    const r = settleBets([bet("s7", rs(100), 35, [7]), bet("red", rs(100), 1, RED), bet("sp", rs(100), 17, [7, 8])], 7);
    expect(r.winningPositions).toBe(3);
    expect(r.grossWinningProfit).toBe(rs(3500 + 100 + 1700));
    expect(r.netResult).toBe(rs(5300));
  });
  it("13: zero – only positions that cover zero win; every outside bet loses", () => {
    const inside = plan(big(), [
      ["straight", [0], [[100, 1]]],
      ["split", [0, 1], [[100, 1]]],
      ["firstFour", [0, 1, 2, 3], [[100, 1]]],
      ["zeroTrio", [0, 2, 3], [[100, 1]]],
      ["straight", [7], [[100, 1]]],
    ]);
    const r = settleBets(inside.round.bets, 0);
    expect(r.bets.filter((b) => b.status === "win")).toHaveLength(4);
    expect(r.grossWinningProfit).toBe(rs(100 * (35 + 17 + 8 + 11)));
    expect(r.grossLoss).toBe(rs(100)); // straight 7
    const outside = plan(big(), [
      ["dozen", Array.from({ length: 12 }, (_, i) => i + 1), [[100, 1]]],
      ["low", Array.from({ length: 18 }, (_, i) => i + 1), [[100, 1]]],
      ["high", Array.from({ length: 18 }, (_, i) => i + 19), [[100, 1]]],
      ["red", [...RED], [[100, 1]]],
      ["black", Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => !RED.includes(n)), [[100, 1]]],
      ["odd", Array.from({ length: 18 }, (_, i) => 2 * i + 1), [[100, 1]]],
      ["even", Array.from({ length: 18 }, (_, i) => 2 * i + 2), [[100, 1]]],
    ]);
    expect(outside.round.bets).toHaveLength(7);
    const o = settleBets(outside.round.bets, 0);
    expect(o.winningPositions).toBe(0);
    expect(o.grossLoss).toBe(rs(700));
  });
  it("14: mixed – both definitions of net agree", () => {
    const r = settleBets([bet("a", rs(300), 17, [7, 8]), bet("b", rs(500), 2, [1, 2]), bet("c", rs(200), 1, [8, 9])], 8);
    expect(r.netResult).toBe(r.totalPayout - r.totalBet);
    expect(r.netResult).toBe(r.grossWinningProfit - r.grossLoss);
    expect(r.winningChips + r.losingChips).toBe(r.totalChips);
  });
  it("rejects invalid numbers and empty rounds", () => {
    for (const n of [37, -1, 1.5]) expect(() => settleBets([bet("a", 100, 1, [1])], n)).toThrow();
    expect(() => settleBets([], 1)).toThrow();
  });
});

describe("what if a straight number comes up (whole round, net)", () => {
  // the client's example: S6 Rs.100, S5 Rs.200, split 5/6 Rs.100, corner 5/6/8/9 Rs.100
  const spec: Spec = [
    ["straight", [6], [[100, 1]]],
    ["straight", [5], [[100, 2]]],
    ["split", [5, 6], [[100, 1]]],
    ["corner", [5, 6, 8, 9], [[100, 1]]],
  ];
  const { round } = plan(big(), spec, 1, [5, 6]);

  it("counts every bet that covers the number and subtracts every bet that does not", () => {
    const six = resultIfNumberWins(round.bets, 6);
    expect(six.won).toBe(rs(3500 + 1700 + 800)); // S6 + split + corner
    expect(six.lost).toBe(rs(200)); // straight 5
    expect(six.net).toBe(rs(5800));
    const five = resultIfNumberWins(round.bets, 5);
    expect(five.won).toBe(rs(7000 + 1700 + 800));
    expect(five.lost).toBe(rs(100)); // straight 6
    expect(five.net).toBe(rs(9400));
  });

  it("a number only some companions cover, and a number nothing covers", () => {
    expect(resultIfNumberWins(round.bets, 8).net).toBe(rs(800) - rs(400)); // only the corner covers 8
    expect(resultIfNumberWins(round.bets, 20)).toEqual({ won: 0, lost: rs(500), net: -rs(500) });
    expect(resultIfNumberWins([], 6)).toEqual({ won: 0, lost: 0, net: 0 });
  });

  it("outside bets that cover the number are included", () => {
    const withRed = plan(big(), [...spec, ["red", [...RED], [[500, 1]]]], 1, [5, 6]).round; // 5 and 6: 5 is red, 6 is black
    expect(resultIfNumberWins(withRed.bets, 5).net).toBe(rs(9400) + rs(500)); // red wins 1:1
    expect(resultIfNumberWins(withRed.bets, 6).net).toBe(rs(5800) - rs(500)); // red loses
  });

  it("always equals the real settlement for every possible number", () => {
    const mixed = plan(big(), [...spec, ["red", [...RED], [[500, 1]]], ["straight", [0], [[100, 1]]], ["firstFour", [0, 1, 2, 3], [[100, 1]]]], 1, [5, 6]).round;
    for (let n = 0; n <= 36; n++) {
      expect(resultIfNumberWins(mixed.bets, n).net).toBe(settleBets(mixed.bets, n).netResult);
    }
  });
});

describe("matches the Wikipedia roulette page: full complete bets", () => {
  // en.wikipedia.org/wiki/Roulette, "Full completes/maximums": "17 to the maximum" = 40 chips
  // 1 on 17, 2 on each of 4 splits, 3 on the street, 4 on each of 4 corners, 6 on each of 2 six lines.
  // "The payout ... if the chosen number wins is 392 chips"; "with your bet down" 392 + 40 = 432.
  const chip = () => makeSession([{ value: rs(1000), count: 200 }]); // $1,000 per chip, as on the page
  const complete = (n: number, splits: number[][], street: number[], corners: number[][], sixLines: number[][]): Spec => [
    ["straight", [n], [[1000, 1]]],
    ...splits.map((x) => ["split", x, [[1000, 2]]] as Spec[number]),
    ["street", street, [[1000, 3]]],
    ...corners.map((x) => ["corner", x, [[1000, 4]]] as Spec[number]),
    ...sixLines.map((x) => ["sixLine", x, [[1000, 6]]] as Spec[number]),
  ];
  const seventeen = complete(17, [[14, 17], [16, 17], [17, 18], [17, 20]], [16, 17, 18], [[13, 14, 16, 17], [14, 15, 17, 18], [16, 17, 19, 20], [17, 18, 20, 21]], [[13, 14, 15, 16, 17, 18], [16, 17, 18, 19, 20, 21]]);

  it("17 to the maximum: 40 chips, pays 392 chips, 432 with the bet down", () => {
    const { round } = plan(chip(), seventeen, 1, [17]);
    expect(round.totalChips).toBe(40);
    expect(round.totalBet).toBe(rs(40000));
    const r = settleBets(round.bets, 17);
    expect(r.grossWinningProfit).toBe(rs(392000)); // "392 chips"
    expect(r.totalPayout).toBe(rs(432000)); // "392 + 40 ... with your bet down"
    expect(r.netResult).toBe(rs(392000)); // every bet covers 17, nothing is lost
    expect(resultIfNumberWins(round.bets, 17)).toEqual({ won: rs(392000), lost: 0, net: rs(392000) });
  });

  it("a neighbouring number hits only some stations (the page's 23 / 26 example: 4 stations x 36 = 144 with the bet down)", () => {
    const twentyThree = complete(23, [[20, 23], [22, 23], [23, 24], [23, 26]], [22, 23, 24], [[19, 20, 22, 23], [20, 21, 23, 24], [22, 23, 25, 26], [23, 24, 26, 27]], [[19, 20, 21, 22, 23, 24], [22, 23, 24, 25, 26, 27]]);
    const { round } = plan(chip(), twentyThree, 1, [23]);
    const hit = round.bets.filter((b) => b.coveredNumbers.includes(26));
    expect(hit).toHaveLength(4); // two corners, one split, one six line
    const r = settleBets(round.bets, 26);
    expect(r.totalPayout).toBe(rs(144000)); // 4 stations x 36 chips
    expect(r.grossWinningProfit).toBe(rs(128000));
    expect(r.grossLoss).toBe(rs(24000)); // the other 24 chips lose
    expect(r.netResult).toBe(rs(104000));
    expect(resultIfNumberWins(round.bets, 26).net).toBe(rs(104000));
  });

  it("payout table agrees with the page: 35, 17, 11, 8, 5, dozen 2, even money 1, top line 8", async () => {
    const { createDefaultRuleset } = await import("./rules");
    const p = createDefaultRuleset().payoutRatios;
    expect(p).toMatchObject({ straight: 35, split: 17, street: 11, corner: 8, sixLine: 5, firstFour: 8, dozen: 2, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1 });
  });
});

describe("Add Chips: last round's chips + extra chips for many bets at once", () => {
  const fmt = (n: number) => `Rs. ${n / 100}`;
  const RED18 = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  // round 1 (saved): every listed type, mixed chip values, plus an outside bet
  const round1: Spec = [
    ["straight", [6], [[500, 1]]],
    ["split", [5, 6], [[100, 2], [500, 1]]],
    ["corner", [5, 6, 8, 9], [[100, 2]]],
    ["street", [4, 5, 6], [[500, 1]]],
    ["sixLine", [4, 5, 6, 7, 8, 9], [[100, 3]]],
    ["red", RED18, [[500, 1]]],
  ];
  const setupRound2 = (mains = [6]) => {
    const r1 = playRound(big(), [], round1, 0, [6]);
    const round = setMainNumbers(createRound(r1.session, 2), mains);
    const allowed = new Set(insideGroups(r1.session.ruleset, mains).flatMap((g) => g.positions.map((p) => p.key)));
    const den = (v: number) => r1.session.inventory.find((d) => d.value === rs(v))!.id;
    const run = (inventory = r1.session.inventory, bets = round.bets, extra = emptyBulkExtra(), denomination = den(100)) =>
      previousPlusChips({ inventory, bets, roundId: round.id, previousBets: r1.round.bets, allowedKeys: allowed, extra, extraDenominationId: denomination, ruleset: r1.session.ruleset, fmt });
    return { r1, round, den, run };
  };
  const chipsOn = (bets: { key: string; chipCount: number; stake: number; allocations: { denominationValue: number; quantity: number }[] }[], key: string) => bets.find((b) => b.key === key);

  it("adds the extra chips per bet type on top of last round's chips, keeping the old chip values", () => {
    const { run, round } = setupRound2();
    const res = run(undefined, undefined, { straight: 1, split: 2, corner: 0, street: 0, sixLine: 3 });
    expect(res.changed).toBe(5);
    const s6 = chipsOn(res.bets, positionKey("straight", [6]))!;
    expect(s6.allocations.map((a) => [a.denominationValue, a.quantity])).toEqual([[rs(100), 1], [rs(500), 1]]); // 500 + 1 extra 100
    expect(s6.stake).toBe(rs(600));
    const split = chipsOn(res.bets, positionKey("split", [5, 6]))!;
    expect(split.allocations.map((a) => [a.denominationValue, a.quantity])).toEqual([[rs(100), 4], [rs(500), 1]]); // 2 + 2 extra
    expect(chipsOn(res.bets, positionKey("corner", [5, 6, 8, 9]))!.chipCount).toBe(2); // +0 = same as last round
    expect(chipsOn(res.bets, positionKey("street", [4, 5, 6]))!.stake).toBe(rs(500));
    expect(chipsOn(res.bets, positionKey("sixLine", [4, 5, 6, 7, 8, 9]))!.chipCount).toBe(6); // 3 + 3
    expect(res.bets.some((b) => b.category === "outside")).toBe(false); // the red bet is not part of this feature
    // reservations stay consistent with the bets
    const placed = res.bets.reduce((t, b) => t + b.chipCount, 0);
    expect(inventoryTotals(res.inventory).allocatedChips).toBe(placed);
    expect(round.bets).toEqual([]); // inputs are not mutated
  });

  it("replaces chips that are already on those bets, so applying twice gives the same result", () => {
    const { run, r1, round, den } = setupRound2();
    const pre = setPositionChips(r1.session.inventory, [], round.id, positionKey("straight", [6]), den(1000), 2, r1.session.ruleset);
    const once = run(pre.inventory, pre.bets, { ...emptyBulkExtra(), straight: 1 });
    expect(chipsOn(once.bets, positionKey("straight", [6]))!.allocations.some((a) => a.denominationValue === rs(1000))).toBe(false); // the old 1,000 chips are gone
    const twice = run(once.inventory, once.bets, { ...emptyBulkExtra(), straight: 1 });
    expect(JSON.stringify(twice.bets)).toBe(JSON.stringify(once.bets));
    expect(JSON.stringify(twice.inventory)).toBe(JSON.stringify(once.inventory));
  });

  it("only touches last round's bets that are shown now; other bets are left as they are", () => {
    const { run, r1, round, den } = setupRound2([6, 7]);
    const manual = setPositionChips(r1.session.inventory, [], round.id, positionKey("straight", [7]), den(100), 2, r1.session.ruleset); // not bet last round
    const res = run(manual.inventory, manual.bets, { ...emptyBulkExtra(), straight: 5 });
    expect(chipsOn(res.bets, positionKey("straight", [7]))!.chipCount).toBe(2); // untouched, no +5
    expect(chipsOn(res.bets, positionKey("straight", [6]))!.chipCount).toBe(6); // 1 (Rs. 500) + 5 extra
    expect(res.changed).toBe(5);
  });

  it("does nothing when none of last round's bets are among the current main numbers", () => {
    const { run } = setupRound2([20]);
    expect(() => run()).toThrow(/None of last round's/);
  });

  it("not enough chips: says how many are missing and changes nothing", () => {
    const { run, r1, round } = setupRound2();
    const before = JSON.stringify(r1.session.inventory);
    expect(() => run(undefined, undefined, { ...emptyBulkExtra(), straight: 1000 })).toThrow(/You need 9\d\d more Rs\. 100 chips/);
    expect(JSON.stringify(r1.session.inventory)).toBe(before);
    expect(round.bets).toEqual([]);
  });

  it("checks its inputs", () => {
    const { run, r1 } = setupRound2();
    expect(() => run(undefined, undefined, { ...emptyBulkExtra(), straight: -1 })).toThrow(/zero or more/);
    expect(() => run(undefined, undefined, { ...emptyBulkExtra(), straight: 1.5 })).toThrow(/whole number/);
    expect(() => run(undefined, undefined, emptyBulkExtra(), "nope")).toThrow(/Choose which chip value/);
    // a chip value that was used last round but was removed since
    const without500 = r1.session.inventory.filter((d) => d.value !== rs(500));
    expect(() => run(without500)).toThrow(/no longer have Rs\. 500 chips/);
  });

  it("works with zero extra chips: the bets get last round's chips", () => {
    const { run } = setupRound2();
    const res = run();
    expect(chipsOn(res.bets, positionKey("split", [5, 6]))!.allocations.map((a) => [a.denominationValue, a.quantity])).toEqual([[rs(100), 2], [rs(500), 1]]);
  });
});

describe("total profit or loss across all rounds", () => {
  it("adds the net of every saved round; added money and unsaved rounds are not part of it", () => {
    const s = big();
    expect(totalProfitLoss(s, [])).toBe(0);
    const r1 = playRound(s, [], [["straight", [7], [[100, 2]]]], 7); // +7,000
    const r2 = playRound(r1.session, r1.rounds, [["straight", [8], [[500, 1]]]], 0); // -500
    const r3 = playRound(r2.session, r2.rounds, [["straight", [9], [[100, 3]]]], 0); // -300
    expect(totalProfitLoss(r3.session, r3.rounds)).toBe(rs(7000) - rs(500) - rs(300));
    expect(totalProfitLoss(r3.session, r3.rounds.slice(0, 2))).toBe(rs(7000) - rs(500)); // round by round
    // adding money does not count as profit
    const more = addMoney(r3.session, rs(5000)).session;
    expect(totalProfitLoss(more, r3.rounds)).toBe(rs(6200));
    // it agrees with the money balance: start + added + total
    expect(sessionBalance(more, r3.rounds)).toBe(more.startingMoney + totalAdded(more) + totalProfitLoss(more, r3.rounds));
    // an unsaved round is ignored
    const open = plan(r3.session, [["straight", [10], [[100, 1]]]], 4).round;
    expect(totalProfitLoss(r3.session, [...r3.rounds, open])).toBe(rs(6200));
  });
});

describe("money and chips over all rounds together", () => {
  it("adds money won, money lost and chips for every saved round", () => {
    const s = big();
    // round 1: straight 7 (2 x 100) wins 35:1 = +7,000; split 7/8 (1 x 500) wins 17:1 = +8,500; straight 9 (1 x 100) loses
    const r1 = playRound(s, [], [["straight", [7], [[100, 2]]], ["split", [7, 8], [[500, 1]]], ["straight", [9], [[100, 1]]]], 7);
    // round 2: straight 8 (3 x 100) loses, red (1 x 500) loses
    const r2 = playRound(r1.session, r1.rounds, [["straight", [8], [[100, 3]]], ["red", RED, [[500, 1]]]], 0);
    const t1 = allRoundsTotals(r1.session, r1.rounds);
    expect(t1).toEqual({ rounds: 1, moneyBet: rs(800), moneyWon: rs(15500), moneyLost: rs(100), net: rs(15400), chipsPlaced: 4, chipsLost: 1, chipsWon: 3 });
    const t2 = allRoundsTotals(r2.session, r2.rounds);
    expect(t2).toEqual({ rounds: 2, moneyBet: rs(1600), moneyWon: rs(15500), moneyLost: rs(100 + 300 + 500), net: rs(14600), chipsPlaced: 8, chipsLost: 5, chipsWon: 3 });
    expect(t2.net).toBe(totalProfitLoss(r2.session, r2.rounds)); // agrees with the single total
    expect(t2.net).toBe(t2.moneyWon - t2.moneyLost);
    expect(t2.chipsPlaced).toBe(t2.chipsLost + t2.chipsWon);
  });

  it("can include a round that has a result but is not saved yet, without counting it twice", () => {
    const s = big();
    const r1 = playRound(s, [], [["straight", [7], [[100, 1]]]], 7);
    const p = plan(r1.session, [["straight", [8], [[100, 2]]]], 2);
    const settled = settleRound(confirmRound(p.session, p.round), 0);
    const withIt = allRoundsTotals(r1.session, r1.rounds, settled);
    expect(withIt).toMatchObject({ rounds: 2, moneyWon: rs(3500), moneyLost: rs(200), net: rs(3300), chipsPlaced: 3, chipsLost: 2, chipsWon: 1 });
    expect(allRoundsTotals(r1.session, r1.rounds)).toMatchObject({ rounds: 1, net: rs(3500) }); // saved rounds only
    expect(allRoundsTotals(r1.session, r1.rounds, r1.round)).toMatchObject({ rounds: 1 }); // an already-saved round is not added again
    expect(allRoundsTotals(s, [])).toMatchObject({ rounds: 0, moneyWon: 0, moneyLost: 0, net: 0, chipsPlaced: 0 });
  });
});

describe("Test 15 – chips held after a round", () => {
  it("losing chips are removed; winning chips come back at the odds in the same chip value (estimate)", () => {
    const { session, round } = plan(makeSession(), [
      ["straight", [7], [[100, 2], [500, 1]]], // wins 35:1
      ["straight", [8], [[100, 1]]], // loses
    ]);
    const settled = settleRound(confirmRound(session, round), 7);
    const est = estimateHoldings(session.inventory, settled.bets);
    const hundred = est.estimated.find((d) => d.value === rs(100))!;
    const fiveHundred = est.estimated.find((d) => d.value === rs(500))!;
    // started 10 × 100: placed 3 -> 7 left; winners return 2 × 36 = 72 -> 79; the loser's chip is gone
    expect(hundred.availableCount).toBe(7 + 72);
    expect(fiveHundred.availableCount).toBe(9 + 36);
    expect(est.lostChips).toBe(1);
    expect(est.lostValue).toBe(rs(100));
    expect(est.returnedValue).toBe(rs(700) * 36);
    // value check: held value = start − lost + profit
    expect(holdingsTotals(est.estimated).value).toBe(rs(11000) - rs(100) + rs(700) * 35);
    expect(est.estimated.every((d) => d.allocatedCount === 0)).toBe(true);
  });
  it("the user can correct the counts: recorded as an adjustment, ledger untouched", () => {
    const s = makeSession();
    const spec: Spec = [["straight", [7], [[100, 2]]]];
    const est = playRound(s, [], spec, 7);
    expect(est.round.reconciliationStatus).toBe("estimated");
    const hundred = s.inventory.find((d) => d.value === rs(100))!;
    const adj = playRound(s, [], spec, 7, [7], { [hundred.id]: 70, ...Object.fromEntries(s.inventory.filter((d) => d.id !== hundred.id).map((d) => [d.id, d.availableCount])) });
    expect(adj.round.reconciliationStatus).toBe("adjusted");
    expect(adj.txs.some((t) => t.transactionType === "adjustment")).toBe(true);
    expect(adj.session.inventory.find((d) => d.id === hundred.id)!.availableCount).toBe(70);
    // the money ledger follows the settled result, not the chip count
    expect(sessionBalance(adj.session, adj.rounds)).toBe(rs(20000) + adj.round.netResult);
    expect(adj.round.balanceAfter).toBe(rs(20000) + adj.round.netResult);
    expect(() => playRound(s, [], spec, 7, [7], { [hundred.id]: -1 })).toThrow();
  });
  it("a confirmed (checked) estimate is marked verified", () => {
    const s = makeSession();
    const p = plan(s, [["straight", [7], [[100, 1]]]]);
    const settled = settleRound(confirmRound(p.session, p.round), 8);
    expect(completeRound(p.session, settled, [], { confirmedByUser: true }).round.reconciliationStatus).toBe("verified");
  });
});

describe("Tests 16–21 – previous and cumulative chip counts", () => {
  const corner = positionKey("corner", [7, 8, 10, 11]);

  /** R1: 3 chips on the corner; R2: 5 chips on the corner. */
  const twoRounds = () => {
    const s = big();
    const r1 = playRound(s, [], [["corner", [7, 8, 10, 11], [[100, 2], [500, 1]]]], 0, [7, 8]);
    const r2 = playRound(r1.session, r1.rounds, [["corner", [7, 8, 10, 11], [[100, 2], [500, 3]]]], 0, [7, 8]);
    return { s: r2.session, rounds: r2.rounds };
  };

  it("16/17: Round 3 shows Round 2 as previous and Rounds 1 + 2 as cumulative", () => {
    const { rounds } = twoRounds();
    const h = positionHistory(rounds, 3, corner);
    expect(h.previousRoundNumber).toBe(2);
    expect(h.previous.chips).toBe(5);
    expect(h.cumulative.chips).toBe(8);
    expect(h.earlierRoundNumbers).toEqual([1, 2]);
    expect(roundsLabel(h.earlierRoundNumbers)).toBe("Rounds 1 + 2");
    expect(projectedCumulative(h, 2)).toBe(10); // 8 + 2 entered now
    expect(projectedCumulative(h, 0)).toBe(8);
  });

  it("19: per-denomination previous and cumulative quantities", () => {
    const { rounds } = twoRounds();
    const h = positionHistory(rounds, 3, corner);
    expect(h.previous.byValue).toEqual({ [rs(100)]: 2, [rs(500)]: 3 });
    expect(h.cumulative.byValue).toEqual({ [rs(100)]: 4, [rs(500)]: 4 });
  });

  it("18: previous can be zero while cumulative is not (never the latest nonzero round)", () => {
    const s = big();
    const r1 = playRound(s, [], [["straight", [7], [[100, 3]]]], 0);
    const r2 = playRound(r1.session, r1.rounds, [["straight", [8], [[100, 1]]]], 0);
    const h = positionHistory(r2.rounds, 3, positionKey("straight", [7]));
    expect(h.previous.chips).toBe(0);
    expect(h.cumulative.chips).toBe(3);
    expect(projectedCumulative(h, 2)).toBe(5);
    expect(positionHistory(r2.rounds, 3, positionKey("straight", [8])).previous.chips).toBe(1);
  });

  it("20: only the same type and the same covered numbers match", () => {
    const { rounds } = twoRounds();
    expect(positionHistory(rounds, 3, positionKey("straight", [7])).cumulative.chips).toBe(0);
    expect(positionHistory(rounds, 3, positionKey("split", [7, 8])).cumulative.chips).toBe(0);
    expect(positionHistory(rounds, 3, positionKey("corner", [11, 10, 8, 7])).cumulative.chips).toBe(8); // order does not matter
    expect(positionHistory(rounds, 3, positionKey("red", [...RED])).cumulative.chips).toBe(0);
  });

  it("21: changed main numbers never rewrite history", () => {
    const { s, rounds } = twoRounds();
    const r3 = playRound(s, rounds, [["straight", [20], [[100, 1]]]], 0, [20]);
    const before = JSON.stringify(rounds);
    expect(JSON.stringify(r3.rounds.slice(0, 2))).toBe(before);
    // Round 4 with different main numbers still sees the corner correctly
    const h = positionHistory(r3.rounds, 4, corner);
    expect(h.previous.chips).toBe(0); // Round 3 did not use it
    expect(h.cumulative.chips).toBe(8);
    expect(h.earlierRoundNumbers).toEqual([1, 2, 3]);
  });

  it("current drafts, unsaved rounds and later rounds never count", () => {
    const { rounds } = twoRounds();
    const s = big();
    const draft = plan(s, [["corner", [7, 8, 10, 11], [[100, 9]]]], 3).round;
    expect(buildHistoryIndex([...rounds, draft], 3).get(corner).cumulative.chips).toBe(8);
    expect(buildHistoryIndex(rounds, 2).get(corner).cumulative.chips).toBe(3); // only Round 1 is before Round 2
    expect(buildHistoryIndex(rounds, 1).get(corner).previousRoundNumber).toBeNull();
    // history is information only: it never changes the chips held
    expect(inventoryTotals(s.inventory).availableChips).toBe(150);
  });
});

describe("Test 22 / 24 – saving, lifecycle and clearing", () => {
  it("a round can only be saved once and the next round starts clean", () => {
    const s = big();
    const p = plan(s, [["straight", [7], [[100, 1]]]]);
    const settled = settleRound(confirmRound(p.session, p.round), 8);
    const done = completeRound(p.session, settled, []);
    expect(() => completeRound(done.session, done.round, [done.round])).toThrow(/already saved/);
    const next = createRound(done.session, done.session.totalRounds + 1);
    expect(next.roundNumber).toBe(2);
    expect(next.bets).toEqual([]);
    expect(done.session.totalRounds).toBe(1);
    expect(inventoryTotals(done.session.inventory).allocatedChips).toBe(0);
  });
  it("enforces the lifecycle in logic", () => {
    const s = big();
    const p = plan(s, [["straight", [7], [[100, 1]]]]);
    expect(() => settleRound(p.round, 7)).toThrow(/Confirm your bets/);
    expect(() => confirmRound(p.session, { ...p.round, bets: [] })).toThrow();
    const confirmed = confirmRound(p.session, p.round);
    expect(() => setMainNumbers(confirmed, [1])).toThrow(/confirmed/);
    const reopened = reopenRound(confirmed, "wrong chips");
    expect(reopened.roundStatus).toBe("planning");
    expect(reopened.audit.at(-1)!.note).toMatch(/wrong chips/);
    const settled = settleRound(confirmRound(p.session, reopened), 7);
    expect(() => settleRound(settled, 7)).toThrow(/already has a result/);
    expect(() => completeRound(p.session, confirmed, [])).toThrow(/Calculate the result/);
    const undone = reverseSettlement(settled, "typo");
    expect(undone.roundStatus).toBe("awaiting-result");
    expect(undone.netResult).toBe(0);
    expect(settleRound(undone, 8).netResult).toBe(-rs(100));
  });
  it("24: clearing a draft releases chips and leaves saved rounds alone", () => {
    const s = big();
    const saved = playRound(s, [], [["straight", [7], [[100, 2]]]], 0);
    const p = plan(saved.session, [["straight", [9], [[500, 3]]]]);
    expect(inventoryTotals(p.session.inventory).allocatedChips).toBe(3);
    const cleared = clearDraft(p.session, p.round);
    expect(inventoryTotals(cleared.session.inventory).allocatedChips).toBe(0);
    expect(cleared.round.bets).toEqual([]);
    expect(cleared.round.selectedMainNumbers).toEqual([]);
    expect(saved.rounds).toHaveLength(1);
    expect(sessionBalance(saved.session, saved.rounds)).toBe(rs(20000) - rs(200));
    expect(() => clearDraft(p.session, confirmRound(p.session, p.round))).toThrow();
  });
  it("money balance = start + added + saved nets; chips are tracked separately", () => {
    const s = big();
    const r1 = playRound(s, [], [["straight", [7], [[100, 1]]]], 7); // wins +3,500
    const added = addMoney(r1.session, rs(1000)).session;
    expect(sessionBalance(added, r1.rounds)).toBe(rs(20000) + rs(3500) + rs(1000));
    expect(inventoryTotals(added.inventory).totalValue).toBe(rs(100) * 60 + rs(500) * 60 + rs(1000) * 30 + rs(3500)); // chips only
  });
});
