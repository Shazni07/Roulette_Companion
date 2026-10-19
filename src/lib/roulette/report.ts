import { formatMoney } from "./money";
import { sessionBalance, totalAdded, totalProfitLoss } from "./session";
import type { Round, Session } from "./types";

/** The saved rounds of one session, first to last. */
export function savedRounds(session: Session, rounds: Round[]): Round[] {
  return rounds.filter((r) => r.sessionId === session.id && r.roundStatus === "completed").sort((a, b) => a.roundNumber - b.roundNumber);
}

/** Winning numbers of the last saved rounds, newest first. */
export function recentWinningNumbers(rounds: Round[], limit = 10): number[] {
  return rounds
    .filter((r) => r.roundStatus === "completed" && r.winningNumber !== null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || b.roundNumber - a.roundNumber)
    .slice(0, limit)
    .map((r) => r.winningNumber as number);
}

const resultWord = (net: number) => (net > 0 ? "Profit" : net < 0 ? "Loss" : "No profit or loss");

/** A short message for one round, ready to paste in a chat. */
export function roundSummaryText(session: Session, rounds: Round[], round: Round): string {
  const fmt = (n: number, sign = false) => formatMoney(n, session.currency, { sign });
  const net = totalProfitLoss(session, rounds);
  return [
    `PRO Calculator: Round ${round.roundNumber}`,
    round.winningNumber !== null ? `Winning number: ${round.winningNumber}` : null,
    `Money bet: ${fmt(round.totalBet)}`,
    `${resultWord(round.netResult)}${round.netResult !== 0 ? `: ${fmt(Math.abs(round.netResult))}` : ""}`,
    `All rounds together: ${fmt(net, true)}`,
    `Money to play now: ${fmt(sessionBalance(session, rounds))}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/** A short message for a whole session. */
export function sessionSummaryText(session: Session, rounds: Round[]): string {
  const fmt = (n: number, sign = false) => formatMoney(n, session.currency, { sign });
  const done = savedRounds(session, rounds);
  const net = totalProfitLoss(session, rounds);
  return [
    `PRO Calculator: session of ${new Date(session.startedAt).toLocaleDateString()}`,
    `Rounds played: ${done.length}`,
    `Money bet: ${fmt(done.reduce((s, r) => s + r.totalBet, 0))}`,
    `Total profit or loss: ${fmt(net, true)}`,
    `Money started with: ${fmt(session.startingMoney)}`,
    `Extra money added: ${fmt(totalAdded(session))}`,
    `Money at the end: ${fmt(sessionBalance(session, rounds))}`,
  ].join("\n");
}

const major = (minor: number) => (minor / 100).toFixed(2);
const cell = (v: string | number) => {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** One row per saved round plus a total row. Money is in whole currency units (for example 1250.00). */
export function sessionCsv(session: Session, rounds: Round[]): string {
  const done = savedRounds(session, rounds);
  const rows: (string | number)[][] = [["Round", "Winning number", "Main numbers", "Chips placed", "Money bet", "Profit or loss", "Money after round", "Currency"]];
  for (const r of done) {
    rows.push([
      r.roundNumber,
      r.winningNumber ?? "",
      r.selectedMainNumbers.join(" "),
      r.totalChips,
      major(r.totalBet),
      major(r.netResult),
      r.balanceAfter === null ? "" : major(r.balanceAfter),
      session.currency,
    ]);
  }
  rows.push(["Total", "", "", done.reduce((s, r) => s + r.totalChips, 0), major(done.reduce((s, r) => s + r.totalBet, 0)), major(totalProfitLoss(session, rounds)), major(sessionBalance(session, rounds)), session.currency]);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function csvFileName(session: Session): string {
  const d = new Date(session.startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `roulette-session-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}

export type LimitState = { kind: "win" | "loss"; limit: number; net: number } | null;

/** Has the player reached the stop-win or stop-loss they set? (Only a reminder.) */
export function limitReached(session: Session, rounds: Round[]): LimitState {
  const net = totalProfitLoss(session, rounds);
  if (session.stopWin && session.stopWin > 0 && net >= session.stopWin) return { kind: "win", limit: session.stopWin, net };
  if (session.stopLoss && session.stopLoss > 0 && -net >= session.stopLoss) return { kind: "loss", limit: session.stopLoss, net };
  return null;
}
