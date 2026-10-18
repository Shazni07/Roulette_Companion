import type { BetCategory, BetType, Colour, Position, Ruleset } from "./types";

/** Standard single-zero red numbers (documented official mapping). */
export const RED_NUMBERS: readonly number[] = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

export const ALL_NUMBERS: readonly number[] = Array.from({ length: 37 }, (_, i) => i);

export function buildColourMap(): Record<number, Colour> {
  const map: Record<number, Colour> = { 0: "green" };
  for (let n = 1; n <= 36; n++) map[n] = RED_NUMBERS.includes(n) ? "red" : "black";
  return map;
}

export const COLOUR_MAP = buildColourMap();

export function colourOf(n: number): Colour {
  const c = COLOUR_MAP[n];
  if (!c) throw new RangeError(`Invalid roulette number: ${n}`);
  return c;
}

export function isValidNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 36;
}

/**
 * Betting layout: 12 rows × 3 columns. Row r (1..12) = [3r-2, 3r-1, 3r].
 * Adjacency for inside bets comes from THIS layout, never from the wheel order.
 */
export const ROWS = 12;
export const COLS = 3;
export const gridNumber = (row: number, col: number): number => (row - 1) * 3 + col;

export const STANDARD_PAYOUTS: Record<BetType, number> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  sixLine: 5,
  zeroTrio: 11,
  firstFour: 8,
  dozen: 2,
  low: 1,
  high: 1,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
};

export const ALL_BET_TYPES = Object.keys(STANDARD_PAYOUTS) as BetType[];

export const BET_TYPE_LABEL: Record<BetType, string> = {
  straight: "Straight",
  split: "Split",
  street: "Street",
  corner: "Corner",
  sixLine: "Double Street",
  zeroTrio: "Zero Trio",
  firstFour: "First Four",
  dozen: "Dozen",
  low: "Low",
  high: "High",
  red: "Red",
  black: "Black",
  odd: "Odd",
  even: "Even",
};

export function categoryOf(type: BetType): BetCategory {
  switch (type) {
    case "straight":
    case "split":
    case "street":
    case "corner":
    case "sixLine":
    case "zeroTrio":
    case "firstFour":
      return "inside";
    default:
      return "outside";
  }
}

export function createDefaultRuleset(): Ruleset {
  return {
    id: "single-zero-standard",
    name: "British Roulette (single zero)",
    wheelType: "single-zero",
    numberToColour: buildColourMap(),
    supportedBetTypes: [...ALL_BET_TYPES],
    payoutRatios: { ...STANDARD_PAYOUTS },
    supportedZeroBets: { zeroSplits: true, zeroTrios: true, firstFour: true },
    specialZeroRules: { laPartage: false, enPrison: false },
  };
}

const range = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
};

/**
 * Canonical identity of a betting position: the bet type plus its covered
 * numbers in ascending order. The same combination can never become two keys.
 */
export function positionKey(type: BetType, numbers: number[]): string {
  return `${type}:${[...numbers].sort((a, b) => a - b).join("-")}`;
}

function pos(type: BetType, label: string, numbers: number[]): Position {
  const nums = [...numbers].sort((a, b) => a - b);
  return { key: positionKey(type, nums), type, category: categoryOf(type), label, typeLabel: BET_TYPE_LABEL[type], numbers: nums };
}

/** Every geometrically legal position on the single-zero layout, regardless of table config. */
export function generateAllPositions(): Position[] {
  const out: Position[] = [];

  for (let n = 0; n <= 36; n++) out.push(pos("straight", `${n}`, [n]));

  for (let r = 1; r <= ROWS; r++) {
    for (let c = 1; c <= COLS; c++) {
      const n = gridNumber(r, c);
      if (c < COLS) out.push(pos("split", `${n} / ${n + 1}`, [n, n + 1])); // horizontal
      if (r < ROWS) out.push(pos("split", `${n} / ${n + 3}`, [n, n + 3])); // vertical
    }
  }
  for (const n of [1, 2, 3]) out.push(pos("split", `0 / ${n}`, [0, n]));

  for (let r = 1; r <= ROWS; r++) {
    const a = gridNumber(r, 1);
    out.push(pos("street", `${a} / ${a + 1} / ${a + 2}`, [a, a + 1, a + 2]));
  }

  for (let r = 1; r < ROWS; r++) {
    for (let c = 1; c < COLS; c++) {
      const n = gridNumber(r, c);
      out.push(pos("corner", `${n} / ${n + 1} / ${n + 3} / ${n + 4}`, [n, n + 1, n + 3, n + 4]));
    }
  }

  for (let r = 1; r < ROWS; r++) {
    const a = gridNumber(r, 1);
    out.push(pos("sixLine", `${a} to ${a + 5}`, range(a, a + 5)));
  }

  out.push(pos("zeroTrio", "0 / 1 / 2", [0, 1, 2]));
  out.push(pos("zeroTrio", "0 / 2 / 3", [0, 2, 3]));
  out.push(pos("firstFour", "0 / 1 / 2 / 3", [0, 1, 2, 3]));

  // Outside bets requested for this version (columns are intentionally not included)
  out.push(pos("dozen", "First 12 (1 to 12)", range(1, 12)));
  out.push(pos("dozen", "Second 12 (13 to 24)", range(13, 24)));
  out.push(pos("dozen", "Third 12 (25 to 36)", range(25, 36)));
  out.push(pos("low", "Low (1 to 18)", range(1, 18)));
  out.push(pos("high", "High (19 to 36)", range(19, 36)));
  out.push(pos("red", "Red", [...RED_NUMBERS]));
  out.push(pos("black", "Black", range(1, 36).filter((n) => !RED_NUMBERS.includes(n))));
  out.push(pos("odd", "Odd", range(1, 36).filter((n) => n % 2 === 1)));
  out.push(pos("even", "Even", range(1, 36).filter((n) => n % 2 === 0)));

  return out;
}

const ALL_POSITIONS = generateAllPositions();
const POSITION_BY_KEY = new Map(ALL_POSITIONS.map((p) => [p.key, p]));

export function getPosition(key: string): Position | undefined {
  return POSITION_BY_KEY.get(key);
}

const isZeroSplit = (p: Position) => p.type === "split" && p.numbers[0] === 0;

/** Positions enabled by the table configuration. */
export function enabledPositions(ruleset: Ruleset): Position[] {
  return ALL_POSITIONS.filter((p) => {
    if (!ruleset.supportedBetTypes.includes(p.type)) return false;
    if (isZeroSplit(p)) return ruleset.supportedZeroBets.zeroSplits;
    if (p.type === "zeroTrio") return ruleset.supportedZeroBets.zeroTrios;
    if (p.type === "firstFour") return ruleset.supportedZeroBets.firstFour;
    return true;
  });
}

export function isPositionEnabled(ruleset: Ruleset, key: string): boolean {
  return enabledPositions(ruleset).some((p) => p.key === key);
}

const INSIDE_ORDER: BetType[] = ["straight", "split", "street", "corner", "sixLine", "zeroTrio", "firstFour"];

/** Legal inside positions (including supported zero areas) that contain the number. */
export function insidePositionsFor(ruleset: Ruleset, n: number): Position[] {
  return enabledPositions(ruleset)
    .filter((p) => p.category === "inside" && p.numbers.includes(n))
    .sort((a, b) => INSIDE_ORDER.indexOf(a.type) - INSIDE_ORDER.indexOf(b.type) || a.numbers.join().localeCompare(b.numbers.join(), undefined, { numeric: true }));
}

/** Inside positions grouped under each selected main number. A position that contains several main numbers appears under each, as the SAME position. */
export function insideGroups(ruleset: Ruleset, mainNumbers: number[]): { number: number; positions: Position[] }[] {
  return [...new Set(mainNumbers)]
    .sort((a, b) => a - b)
    .map((number) => ({ number, positions: insidePositionsFor(ruleset, number) }));
}

const OUTSIDE_ORDER: BetType[] = ["dozen", "low", "high", "red", "black", "odd", "even"];

/** The outside positions requested for this version, in display order. */
export function outsidePositions(ruleset: Ruleset): Position[] {
  return enabledPositions(ruleset)
    .filter((p) => p.category === "outside")
    .sort((a, b) => OUTSIDE_ORDER.indexOf(a.type) - OUTSIDE_ORDER.indexOf(b.type) || a.numbers[0]! - b.numbers[0]!);
}
