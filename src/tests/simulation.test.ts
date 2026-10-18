import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SimulationError, runSimulation, type SimulationConfig } from "../../scripts/simulation";

const defaultConfig = (): SimulationConfig => JSON.parse(readFileSync("scripts/seven-rounds.config.json", "utf8")) as SimulationConfig;

describe("7 round script: the default config", () => {
  const res = runSimulation(defaultConfig());

  it("plays 7 rounds and the totals add up", () => {
    expect(res.summaries).toHaveLength(7);
    expect(res.rounds.every((r) => r.roundStatus === "completed")).toBe(true);
    const totalNet = res.summaries.reduce((t, s) => t + s.net, 0);
    expect(res.summaries.at(-1)!.moneyAfter).toBe(500000 * 100 + totalNet);
    for (const s of res.summaries) expect(s.net).toBe(s.moneyWon - s.moneyLost);
    // chips are bought at Rs. 500 from the money, so chips and money agree at the end
    expect(res.summaries.at(-1)!.chipsAfter * 500 * 100).toBe(res.summaries.at(-1)!.moneyAfter);
  });

  it("matches a hand calculation for round 1 (winning 5) and round 4 (winning 6)", () => {
    // round 1: split 5/6 (Rs. 500 x 17 = 8,500) + street 4/5/6 (Rs. 500 x 11 = 5,500); 7 other bets lose 3,500
    expect(res.summaries[0]).toMatchObject({ winningNumber: 5, totalBet: 450000, moneyWon: 1400000, moneyLost: 350000, net: 1050000 });
    // round 4: straight 6 with 4 chips (2,000 x 35 = 70,000) + split 5/6 (8,500) + street 4/5/6 (5,500) = 84,000; lost 10,500 - 3,000
    expect(res.summaries[3]).toMatchObject({ winningNumber: 6, totalBet: 1050000, moneyWon: 8400000, moneyLost: 750000, net: 7650000 });
    // round 3: zero wins nothing
    expect(res.summaries[2]).toMatchObject({ winningNumber: 0, moneyWon: 0, net: -850000 });
  });

  it("prints the full report in plain text", () => {
    expect(res.report).toContain("SUMMARY OF ALL 7 ROUNDS");
    expect(res.report).toContain("ROUND 7");
    expect(res.report).toContain("WHAT IF");
    expect(res.report).toContain("last round: 2 chips"); // the previous-round chips per bet
    expect(res.report).toContain("Checks passed");
    expect(res.report).not.toMatch(/[−₹€£]/); // plain characters so the Windows console shows it correctly
  });
});

describe("7 round script: your own preferences", () => {
  const cfg = (): SimulationConfig => ({
    currency: "LKR",
    startingMoney: 10000,
    chips: [{ value: 100, count: 50 }, { value: 500, count: 10 }],
    mainNumbers: [7],
    rounds: [
      {
        winningNumber: 7,
        bets: [
          { type: "straight", numbers: [7], chips: { "100": 2 } },
          { type: "red", chips: { "500": 1 } },
          { type: "dozen", dozen: 1, chips: { "100": 3 } },
        ],
      },
      { winningNumber: 0, addMoney: 2000, bets: [{ type: "straight", numbers: [7], chips: { "100": 5 } }] },
    ],
  });

  it("handles several chip values, outside bets, dozens and added money", () => {
    const r = runSimulation(cfg());
    // round 1: straight 7 200 x 35 = 7,000; red 500 x 1 = 500; first dozen 300 x 2 = 600 -> won 8,100, lost 0, bet 1,000
    expect(r.summaries[0]).toMatchObject({ totalBet: 100000, moneyWon: 810000, moneyLost: 0, net: 810000 });
    // round 2: Rs. 2,000 added first, then Rs. 500 on straight 7 loses
    expect(r.summaries[1]).toMatchObject({ totalBet: 50000, moneyWon: 0, moneyLost: 50000, net: -50000 });
    expect(r.summaries[1]!.moneyAfter).toBe(1000000 + 200000 + 810000 - 50000);
    expect(r.report).toContain("Red");
    expect(r.report).toContain("First 12");
  });

  it("explains a problem in plain words and names the round and bet", () => {
    const bad = (mut: (c: SimulationConfig) => void, text: RegExp) => {
      const c = cfg();
      mut(c);
      expect(() => runSimulation(c)).toThrow(SimulationError);
      expect(() => runSimulation(c)).toThrow(text);
    };
    bad((c) => (c.rounds[0]!.bets[0] = { type: "split", numbers: [5, 7], chips: { "100": 1 } }), /Round 1, bet 1: Split 5\/7 is not a legal position/);
    bad((c) => (c.rounds[0]!.bets[0] = { type: "straight", numbers: [7], chips: { "250": 1 } }), /Round 1, bet 1 \(Straight: 7\): you have no chips of value 250/);
    bad((c) => (c.rounds[0]!.bets[0] = { type: "straight", numbers: [7], chips: { "100": 500 } }), /Round 1, bet 1 \(Straight: 7\): You only have 50 more/);
    bad((c) => (c.rounds[1]!.winningNumber = 37), /Round 2: winningNumber must be a whole number from 0 to 36/);
    bad((c) => (c.rounds[0]!.bets = []), /Round 1: add at least one bet/);
    bad((c) => (c.startingMoney = Number("1.234")), /startingMoney: "1.234" is not a valid amount/);
    bad((c) => (c.rounds[0]!.bets[2] = { type: "dozen", chips: { "100": 1 } }), /needs "dozen": 1, 2 or 3/);
    bad((c) => (c.rounds[0]!.bets[0] = { type: "straight", chips: { "100": 1 } }), /needs "numbers"/);
  });

  it("works out the chip count from the money when you leave it out (money / chip value)", () => {
    const c = cfg();
    c.chips = [{ value: 500 }]; // Rs. 10,000 / Rs. 500 = 20 chips
    c.rounds = [{ winningNumber: 0, bets: [{ type: "straight", numbers: [7], chips: { "500": 20 } }] }];
    expect(runSimulation(c).summaries[0]).toMatchObject({ totalBet: 1000000, net: -1000000 });
    c.rounds = [{ winningNumber: 0, bets: [{ type: "straight", numbers: [7], chips: { "500": 21 } }] }];
    expect(() => runSimulation(c)).toThrow(/only have 20 more/);
  });
});
