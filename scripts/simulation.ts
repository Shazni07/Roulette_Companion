/**
 * Plays a whole session of several rounds from a plain config file, using the
 * app's real rules, betting, settlement and chip code (nothing is re-implemented
 * here), and writes a round-by-round report.
 */
import { setPositionChips } from "@/lib/roulette/betting";
import { estimateHoldings, holdingsTotals } from "@/lib/roulette/chips";
import { buildHistoryIndex } from "@/lib/roulette/history";
import { inventoryTotals, suggestChipCount } from "@/lib/roulette/inventory";
import { currencySymbol, formatMoney, parseMoney, registerCurrency } from "@/lib/roulette/money";
import { completeRound, confirmRound, createRound, setMainNumbers, settleRound, withTotals } from "@/lib/roulette/rounds";
import { BET_TYPE_LABEL, colourOf, getPosition, isValidNumber, outsidePositions, positionKey } from "@/lib/roulette/rules";
import { addChipType, addMoney, allRoundsTotals, chipsDone, createSession, sessionBalance, totalAdded } from "@/lib/roulette/session";
import { resultIfNumberWins } from "@/lib/roulette/settlement";
import type { BetPosition, BetType, Position, Round, Session } from "@/lib/roulette/types";

/* ───────────── config (amounts are in normal money units, e.g. 500 = Rs. 500) ───────────── */
export interface BetConfig {
  type: BetType;
  /** inside bets: the numbers it covers, e.g. [5, 6] for split 5/6 */
  numbers?: number[];
  /** for the three dozens only: 1 = first 12, 2 = second 12, 3 = third 12 */
  dozen?: 1 | 2 | 3;
  /** chips by chip value, e.g. { "500": 3 } means three Rs. 500 chips */
  chips: Record<string, number>;
}

export interface RoundConfig {
  winningNumber: number;
  /** main numbers for this round (only shown in the report); defaults to the previous round's */
  mainNumbers?: number[];
  /** money added before this round starts (it does not add chips) */
  addMoney?: number;
  bets: BetConfig[];
}

export interface SimulationConfig {
  title?: string;
  currency?: string;
  /** symbol shown before amounts (only needed for a currency other than LKR, INR, USD) */
  currencySymbol?: string;
  startingMoney: number;
  /** chip values you hold; leave "count" out and it is worked out from the money left (money ÷ chip value) */
  chips: { value: number; count?: number }[];
  mainNumbers?: number[];
  rounds: RoundConfig[];
}

export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationError";
  }
}

export interface RoundSummary {
  roundNumber: number;
  winningNumber: number;
  totalBet: number;
  moneyWon: number;
  moneyLost: number;
  net: number;
  moneyAfter: number;
  chipsAfter: number;
}

export interface SimulationResult {
  session: Session;
  rounds: Round[];
  summaries: RoundSummary[];
  /** the full report, one string for the whole run */
  report: string;
}

const money = (n: number, what: string): number => {
  const m = parseMoney(String(n));
  if (m === null) throw new SimulationError(`${what}: "${n}" is not a valid amount (use a normal number such as 500 or 12.5).`);
  return m;
};

/* ───────────── run ───────────── */
export function runSimulation(cfg: SimulationConfig): SimulationResult {
  if (!Array.isArray(cfg.rounds) || cfg.rounds.length === 0) throw new SimulationError("The config needs at least one round under \"rounds\".");
  const currency = cfg.currency ?? "LKR";
  // LKR, INR and USD are built in; for anything else give "currencySymbol" in the config
  if (cfg.currencySymbol || !["LKR", "INR", "USD"].includes(currency)) registerCurrency({ code: currency, symbol: cfg.currencySymbol ?? `${currency} `, name: currency });
  const symbol = cfg.currencySymbol ?? currencySymbol(currency);
  const fmt = (minor: number, sign = false) => ascii(formatMoney(minor, currency, { sign }));

  // --- session, chips
  const startingMoney = money(cfg.startingMoney, "startingMoney");
  if (startingMoney <= 0) throw new SimulationError("startingMoney must be more than zero.");
  let session = createSession(currency, startingMoney, symbol);
  let moneyLeft = startingMoney;
  for (const [i, c] of (cfg.chips ?? []).entries()) {
    const value = money(c.value, `chips[${i}].value`);
    const count = c.count ?? suggestChipCount(moneyLeft, value);
    if (!Number.isInteger(count) || count < 0) throw new SimulationError(`chips[${i}].count must be a whole number, zero or more.`);
    session = addChipType(session, value, count).session;
    moneyLeft = Math.max(0, moneyLeft - value * count);
  }
  try {
    session = chipsDone(session);
  } catch (e) {
    throw new SimulationError(e instanceof Error ? e.message : "Add at least one chip with a chip count above zero.");
  }

  const saved: Round[] = [];
  const summaries: RoundSummary[] = [];
  const out: string[] = [];
  const line = (s = "") => out.push(s);
  let mains = [...(cfg.mainNumbers ?? [])];

  line(`${cfg.title ?? "PRO Calculator: simulated session"}`);
  line(`${"=".repeat(68)}`);
  line(`Started with ${fmt(startingMoney)} (${currency}). Chips: ${session.inventory.map((d) => `${inventoryTotals([d]).totalChips} x ${fmt(d.value)}`).join(", ")}.`);
  line(`${cfg.rounds.length} round${cfg.rounds.length === 1 ? "" : "s"} will be played.`);

  for (const [index, rc] of cfg.rounds.entries()) {
    const n = index + 1;
    const where = `Round ${n}`;
    if (!isValidNumber(rc.winningNumber)) throw new SimulationError(`${where}: winningNumber must be a whole number from 0 to 36.`);
    if (rc.addMoney !== undefined) {
      session = addMoney(session, money(rc.addMoney, `${where} addMoney`)).session;
    }
    if (rc.mainNumbers) mains = [...rc.mainNumbers];
    for (const m of mains) if (!isValidNumber(m)) throw new SimulationError(`${where}: main number "${m}" is not from 0 to 36.`);

    const before = {
      money: sessionBalance(session, saved),
      chips: inventoryTotals(session.inventory),
    };

    // --- place the chips exactly as written
    let round = setMainNumbers(createRound(session, n), mains);
    let inventory = session.inventory;
    let bets: BetPosition[] = [];
    if (!Array.isArray(rc.bets) || rc.bets.length === 0) throw new SimulationError(`${where}: add at least one bet.`);
    for (const [bi, b] of rc.bets.entries()) {
      const pos = findPosition(session, b, `${where}, bet ${bi + 1}`);
      const entries = Object.entries(b.chips ?? {});
      if (entries.length === 0) throw new SimulationError(`${where}, bet ${bi + 1} (${betName(pos)}): give the chips, for example { "500": 2 }.`);
      for (const [valueText, qty] of entries) {
        const value = money(Number(valueText), `${where}, bet ${bi + 1} chip value`);
        const den = inventory.find((d) => d.value === value);
        if (!den) throw new SimulationError(`${where}, bet ${bi + 1} (${betName(pos)}): you have no chips of value ${valueText}.`);
        if (!Number.isInteger(qty) || qty < 1) throw new SimulationError(`${where}, bet ${bi + 1} (${betName(pos)}): the number of ${valueText} chips must be a whole number of 1 or more.`);
        try {
          const r = setPositionChips(inventory, bets, round.id, pos.key, den.id, qty, session.ruleset);
          inventory = r.inventory;
          bets = r.bets;
        } catch (e) {
          throw new SimulationError(`${where}, bet ${bi + 1} (${betName(pos)}): ${e instanceof Error ? e.message : "could not place the chips"}`);
        }
      }
    }
    round = withTotals({ ...round, bets });
    const planSession: Session = { ...session, inventory };
    const history = buildHistoryIndex(saved, n);

    // --- confirm, settle, save (the same steps as the screens)
    const settled = settleRound(confirmRound(planSession, round), rc.winningNumber);
    const done = completeRound(planSession, settled, saved);
    const r = done.round;

    // --- report
    line();
    line(`${"=".repeat(68)}`);
    line(`ROUND ${n}`);
    line(`${"=".repeat(68)}`);
    line(`Main numbers: ${mains.join(", ") || "none"}`);
    line(`Before the round: money to play ${fmt(before.money)}, chips ${before.chips.totalChips} (${fmt(before.chips.totalValue)})`);
    line();
    line(`BETS PLACED: ${r.bets.length} bets, ${r.totalChips} chips, ${fmt(r.totalBet)}`);
    for (const [i, b] of r.bets.entries()) {
      const prev = history.get(b.key).previous.chips;
      line(`  ${pad(String(i + 1), 2)}  ${padR(b.label, 24)} ${padR(chipsText(b, fmt), 20)} ${padL(fmt(b.stake), 14)}   last round: ${n === 1 ? "-" : `${prev} chip${prev === 1 ? "" : "s"}`}`);
    }
    line();
    line(`WINNING NUMBER: ${r.winningNumber} (${colourOf(r.winningNumber!)})`);
    line(`RESULT OF EACH BET`);
    for (const [i, b] of r.bets.entries()) {
      line(
        b.settlementStatus === "win"
          ? `  ${pad(String(i + 1), 2)}  ${padR(b.label, 24)} WON   profit ${padL(fmt(b.winningProfit, true), 14)}   you get back ${fmt(b.totalPayout)}`
          : `  ${pad(String(i + 1), 2)}  ${padR(b.label, 24)} LOST  ${padL(fmt(-b.lostStake), 14)}`,
      );
    }
    line();
    line(`CHIPS   on winning bets: ${r.winningChips} chips (${fmt(r.totalWinningStake)})   on losing bets: ${r.losingChips} chips (${fmt(r.totalLosingStake)})`);
    line(`MONEY   total bet ${fmt(r.totalBet)} | money won ${fmt(r.grossWinningProfit)} | money lost ${fmt(r.grossLoss)} | ${r.netResult >= 0 ? "PROFIT" : "LOSS"} ${fmt(r.netResult, true)}`);
    const straights = r.bets.filter((b) => b.betType === "straight");
    if (straights.length) {
      line(`WHAT IF (not real money: your whole round if that straight number had come up)`);
      for (const b of straights) {
        const s = resultIfNumberWins(r.bets, b.coveredNumbers[0]!);
        line(`  if ${pad(String(b.coveredNumbers[0]), 2)} came up: won ${padL(fmt(s.won), 14)}  lost ${padL(fmt(s.lost), 14)}  net ${padL(fmt(s.net, true), 14)}`);
      }
    }
    const est = estimateHoldings(planSession.inventory, r.bets);
    const heldAfter = holdingsTotals(done.session.inventory);
    line();
    line(`AFTER THE ROUND  money to play ${fmt(sessionBalance(done.session, [...saved, r]))} | chips I have now ${heldAfter.chips} (${fmt(heldAfter.value)})`);
    line(`  chips by value (estimate): ${done.session.inventory.map((d) => `${d.availableCount} x ${fmt(d.value)}`).join(", ")}`);
    line(`  winning chips returned (estimate): ${est.returnedChips} chips = ${fmt(est.returnedValue)}; chips lost: ${est.lostChips} = ${fmt(est.lostValue)}`);

    saved.push(r);
    session = done.session;
    const all = allRoundsTotals(session, saved);
    line();
    line(`ALL ROUNDS SO FAR (${all.rounds})  money won ${fmt(all.moneyWon)} | money lost ${fmt(all.moneyLost)} | profit or loss ${fmt(all.net, true)}`);
    line(`                      chips placed ${all.chipsPlaced} | chips lost ${all.chipsLost} | chips that won ${all.chipsWon}`);

    // internal checks: stop if the numbers ever disagree
    const payout = r.bets.reduce((t, x) => t + x.totalPayout, 0);
    if (payout - r.totalBet !== r.netResult || r.grossWinningProfit - r.grossLoss !== r.netResult)
      throw new SimulationError(`${where}: internal check failed (net result does not agree).`);
    summaries.push({
      roundNumber: n,
      winningNumber: r.winningNumber!,
      totalBet: r.totalBet,
      moneyWon: r.grossWinningProfit,
      moneyLost: r.grossLoss,
      net: r.netResult,
      moneyAfter: sessionBalance(session, saved),
      chipsAfter: heldAfter.chips,
    });
  }

  // --- summary
  const total = allRoundsTotals(session, saved);
  const final = sessionBalance(session, saved);
  line();
  line(`${"=".repeat(68)}`);
  line(`SUMMARY OF ALL ${saved.length} ROUNDS`);
  line(`${"=".repeat(68)}`);
  line(`${padR("Round", 6)}${padR("Won no.", 9)}${padL("Money bet", 16)}${padL("Money won", 16)}${padL("Money lost", 16)}${padL("Profit/Loss", 16)}${padL("Money after", 16)}`);
  for (const s of summaries) {
    line(`${padR(String(s.roundNumber), 6)}${padR(String(s.winningNumber), 9)}${padL(fmt(s.totalBet), 16)}${padL(fmt(s.moneyWon), 16)}${padL(fmt(s.moneyLost), 16)}${padL(fmt(s.net, true), 16)}${padL(fmt(s.moneyAfter), 16)}`);
  }
  line(`${padR("Total", 15)}${padL(fmt(total.moneyBet), 16)}${padL(fmt(total.moneyWon), 16)}${padL(fmt(total.moneyLost), 16)}${padL(fmt(total.net, true), 16)}${padL(fmt(final), 16)}`);
  line();
  line(`Money started with ${fmt(startingMoney)} + added ${fmt(totalAdded(session))} + profit or loss ${fmt(total.net, true)} = ${fmt(final)}`);
  if (startingMoney + totalAdded(session) + total.net !== final) throw new SimulationError("Internal check failed: the money balance does not add up.");
  const held = holdingsTotals(session.inventory);
  line(`Chips I hold at the end: ${held.chips} chips = ${fmt(held.value)}`);
  line(`Chips over all rounds: placed ${total.chipsPlaced}, lost ${total.chipsLost}, on winning bets ${total.chipsWon}`);
  line(`Checks passed: each round's profit or loss = payout - money bet = money won - money lost; money balance adds up.`);

  return { session, rounds: saved, summaries, report: out.join("\n") + "\n" };
}

/* ───────────── helpers ───────────── */
function findPosition(session: Session, b: BetConfig, where: string): Position {
  const outside = ["dozen", "low", "high", "red", "black", "odd", "even"] as BetType[];
  if (outside.includes(b.type)) {
    const list = outsidePositions(session.ruleset).filter((p) => p.type === b.type);
    if (b.type === "dozen") {
      if (![1, 2, 3].includes(b.dozen as number)) throw new SimulationError(`${where}: a dozen bet needs "dozen": 1, 2 or 3.`);
      const p = list.find((x) => x.numbers[0] === ((b.dozen as number) - 1) * 12 + 1);
      if (p) return p;
    } else if (list[0]) return list[0];
    throw new SimulationError(`${where}: ${b.type} is not offered at this table.`);
  }
  if (!b.numbers || b.numbers.length === 0) throw new SimulationError(`${where}: ${BET_TYPE_LABEL[b.type] ?? b.type} needs "numbers", for example [5, 6].`);
  const p = getPosition(positionKey(b.type, b.numbers));
  if (!p) throw new SimulationError(`${where}: ${BET_TYPE_LABEL[b.type] ?? b.type} ${b.numbers.join("/")} is not a legal position on the table layout.`);
  return p;
}

const betName = (p: Position) => (p.category === "inside" ? `${p.typeLabel}: ${p.label}` : p.label);
const chipsText = (b: BetPosition, fmt: (n: number) => string) => b.allocations.map((a) => `${a.quantity} x ${fmt(a.denominationValue)}`).join(" + ");
const pad = (s: string, n: number) => s.padStart(n);
const padL = (s: string, n: number) => s.padStart(n);
const padR = (s: string, n: number) => s.padEnd(n);
/** the Windows console can garble special characters, so the report uses plain ones */
const ascii = (s: string) => s.replace(/−/g, "-").replace(/₹/g, "INR ").replace(/€/g, "EUR ").replace(/£/g, "GBP ");
