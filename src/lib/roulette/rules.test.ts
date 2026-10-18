import { describe, expect, it } from "vitest";
import {
  RED_NUMBERS,
  colourOf,
  createDefaultRuleset,
  enabledPositions,
  generateAllPositions,
  getPosition,
  insideGroups,
  insidePositionsFor,
  outsidePositions,
  positionKey,
} from "./rules";

const byType = (t: string) => generateAllPositions().filter((p) => p.type === t);
const nums = (type: Parameters<typeof positionKey>[0], n: number[]) => getPosition(positionKey(type, n))!.numbers;

describe("colours", () => {
  it("maps red, black and green", () => {
    expect(RED_NUMBERS).toHaveLength(18);
    for (const n of RED_NUMBERS) expect(colourOf(n)).toBe("red");
    for (const n of [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35]) expect(colourOf(n)).toBe("black");
    expect(colourOf(0)).toBe("green");
    expect(() => colourOf(37)).toThrow();
  });
});

describe("Test 4 – legal inside bets", () => {
  it("generates exactly the legal positions", () => {
    expect(byType("straight")).toHaveLength(37);
    expect(byType("split")).toHaveLength(60); // 24 horizontal + 33 vertical + 3 zero splits
    expect(byType("street")).toHaveLength(12);
    expect(byType("corner")).toHaveLength(22);
    expect(byType("sixLine")).toHaveLength(11);
    expect(byType("zeroTrio")).toHaveLength(2);
    expect(byType("firstFour")).toHaveLength(1);
  });
  it("splits follow the betting grid, not numerical proximity", () => {
    const keys = byType("split").map((p) => p.key);
    for (const [a, b] of [[1, 2], [2, 3], [1, 4], [2, 5], [3, 6], [7, 8], [7, 10], [0, 1], [0, 2], [0, 3]]) expect(keys).toContain(positionKey("split", [a!, b!]));
    for (const [a, b] of [[3, 4], [6, 7], [1, 5]]) expect(keys).not.toContain(positionKey("split", [a!, b!]));
  });
  it("streets are the twelve rows; corners are real 2x2 blocks; six lines are two streets", () => {
    expect(nums("street", [1, 2, 3])).toEqual([1, 2, 3]);
    expect(nums("street", [34, 35, 36])).toEqual([34, 35, 36]);
    expect(nums("corner", [7, 8, 10, 11])).toEqual([7, 8, 10, 11]);
    const corners = byType("corner").map((p) => p.key);
    expect(corners).not.toContain(positionKey("corner", [3, 4, 6, 7]));
    expect(corners).not.toContain(positionKey("corner", [1, 2, 3, 4]));
    for (const p of byType("sixLine")) expect(p.numbers[5]! - p.numbers[0]!).toBe(5);
    expect(nums("sixLine", [1, 2, 3, 4, 5, 6])).toHaveLength(6);
  });
  it("zero areas are explicit", () => {
    expect(nums("zeroTrio", [0, 1, 2])).toEqual([0, 1, 2]);
    expect(nums("zeroTrio", [0, 2, 3])).toEqual([0, 2, 3]);
    expect(nums("firstFour", [0, 1, 2, 3])).toEqual([0, 1, 2, 3]);
    const r = createDefaultRuleset();
    r.supportedZeroBets = { zeroSplits: false, zeroTrios: false, firstFour: false };
    const keys = enabledPositions(r).map((p) => p.key);
    expect(keys).not.toContain(positionKey("zeroTrio", [0, 1, 2]));
    expect(keys).not.toContain(positionKey("firstFour", [0, 1, 2, 3]));
    expect(keys).not.toContain(positionKey("split", [0, 1]));
    expect(keys).toContain(positionKey("straight", [0]));
    expect(createDefaultRuleset().specialZeroRules).toEqual({ laPartage: false, enPrison: false });
  });
});

describe("Test 5 – one identity per position", () => {
  it("keys are unique and order-independent", () => {
    const keys = generateAllPositions().map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(positionKey("split", [8, 7])).toBe(positionKey("split", [7, 8]));
    expect(positionKey("straight", [7])).not.toBe(positionKey("split", [7, 8]));
  });
  it("split 7/8 under main numbers 7 and 8 is the same position", () => {
    const groups = insideGroups(createDefaultRuleset(), [7, 8]);
    const under7 = groups[0]!.positions.find((p) => p.key === positionKey("split", [7, 8]))!;
    const under8 = groups[1]!.positions.find((p) => p.key === positionKey("split", [7, 8]))!;
    expect(under7).toBeTruthy();
    expect(under7.key).toBe(under8.key);
  });
  it("each group holds only legal positions containing that number", () => {
    const ruleset = createDefaultRuleset();
    for (const n of [0, 1, 7, 18, 36]) {
      const list = insidePositionsFor(ruleset, n);
      expect(list.every((p) => p.numbers.includes(n) && p.category === "inside")).toBe(true);
      expect(list.some((p) => p.type === "straight")).toBe(true);
    }
    // 7 (first column): straight + splits 4/7, 7/8, 7/10 + street + corners 4/5/7/8 and 7/8/10/11 + six lines 4-9 and 7-12
    const seven = insidePositionsFor(ruleset, 7);
    expect(seven).toHaveLength(1 + 3 + 1 + 2 + 2);
    expect(seven.map((p) => p.numbers.join("-"))).toContain("7-8-10-11");
  });
});

describe("outside bets (requested set only)", () => {
  const out = outsidePositions(createDefaultRuleset());
  it("offers the nine requested positions and no columns", () => {
    expect(out.map((p) => p.label)).toEqual([
      "First 12 (1 to 12)",
      "Second 12 (13 to 24)",
      "Third 12 (25 to 36)",
      "Low (1 to 18)",
      "High (19 to 36)",
      "Red",
      "Black",
      "Odd",
      "Even",
    ]);
  });
  it("covers the right numbers and never includes zero", () => {
    for (const p of out) expect(p.numbers).not.toContain(0);
    expect(out.find((p) => p.type === "red")!.numbers).toHaveLength(18);
    expect(out.find((p) => p.type === "odd")!.numbers.every((n) => n % 2 === 1)).toBe(true);
    expect(out.find((p) => p.type === "dozen" && p.numbers[0] === 25)!.numbers).toHaveLength(12);
    expect(out.every((p) => p.category === "outside")).toBe(true);
  });
});
