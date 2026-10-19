import { describe, expect, it } from "vitest";
import { makeSession, rs } from "@/tests/helpers";
import { csvFileName, limitReached, recentWinningNumbers, roundSummaryText, savedRounds, sessionCsv, sessionSummaryText } from "./report";
import { createRound } from "./rounds";
import type { Round, Session } from "./types";

const session: Session = makeSession(); // money Rs. 20,000
const saved = (n: number, win: number, net: number, bet = rs(1000), at = n * 1000): Round => ({
  ...createRound(session, n),
  roundStatus: "completed",
  winningNumber: win,
  netResult: net,
  totalBet: bet,
  totalChips: 4,
  selectedMainNumbers: [7, 17],
  completedAt: at,
  balanceAfter: rs(20000) + net,
});

describe("recent winning numbers", () => {
  it("lists the newest first, only from saved rounds, at most the limit", () => {
    const rounds = [saved(1, 5, 0), saved(2, 17, 0), saved(3, 0, 0), { ...createRound(session, 4), winningNumber: 9, roundStatus: "settled" as const }];
    expect(recentWinningNumbers(rounds)).toEqual([0, 17, 5]);
    expect(recentWinningNumbers(rounds, 2)).toEqual([0, 17]);
    expect(recentWinningNumbers([])).toEqual([]);
  });
});

describe("saved rounds", () => {
  it("are this session's completed rounds in order", () => {
    const other = { ...saved(1, 1, 0), sessionId: "someone-else" };
    expect(savedRounds(session, [saved(2, 2, 0), other, saved(1, 1, 0), { ...createRound(session, 3) }]).map((r) => r.roundNumber)).toEqual([1, 2]);
  });
});

describe("messages to share", () => {
  const rounds = [saved(1, 17, rs(2500)), saved(2, 5, -rs(1000))];
  it("a round: number, bet, result, all rounds together and money left", () => {
    const text = roundSummaryText(session, rounds, rounds[1]!);
    expect(text).toContain("Round 2");
    expect(text).toContain("Winning number: 5");
    expect(text).toContain("Loss: Rs. 1,000");
    expect(text).toContain("All rounds together: +Rs. 1,500");
    expect(text).toContain("Money to play now: Rs. 21,500");
  });
  it("a session: rounds, bet, total, start and end money", () => {
    const text = sessionSummaryText(session, rounds);
    expect(text).toContain("Rounds played: 2");
    expect(text).toContain("Money bet: Rs. 2,000");
    expect(text).toContain("Total profit or loss: +Rs. 1,500");
    expect(text).toContain("Money at the end: Rs. 21,500");
  });
});

describe("spreadsheet file", () => {
  it("has a header, one row per saved round and a total row, money in whole units", () => {
    const rounds = [saved(1, 17, rs(2500)), saved(2, 0, -rs(1000))];
    const lines = sessionCsv(session, rounds).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Round,Winning number,Main numbers,Chips placed,Money bet,Profit or loss,Money after round,Currency");
    expect(lines[1]).toBe("1,17,7 17,4,1000.00,2500.00,22500.00,LKR");
    expect(lines[2]).toBe("2,0,7 17,4,1000.00,-1000.00,19000.00,LKR");
    expect(lines[3]).toBe("Total,,,8,2000.00,1500.00,21500.00,LKR");
    expect(lines).toHaveLength(4);
  });
  it("quotes values that contain commas or quotes, and names the file by date", () => {
    const odd = { ...session, currency: 'A,"B"' };
    expect(sessionCsv(odd, [])).toContain('"A,""B"""');
    expect(csvFileName({ ...session, startedAt: new Date(2026, 9, 5).getTime() })).toBe("roulette-session-2026-10-05.csv");
  });
});

describe("stop limits", () => {
  const rounds = [saved(1, 1, rs(3000)), saved(2, 2, -rs(500))]; // net +2,500
  it("none set, or not reached: nothing", () => {
    expect(limitReached(session, rounds)).toBeNull();
    expect(limitReached({ ...session, stopWin: rs(5000), stopLoss: rs(1000) }, rounds)).toBeNull();
  });
  it("reached exactly or passed: a win or a loss reminder", () => {
    expect(limitReached({ ...session, stopWin: rs(2500) }, rounds)).toEqual({ kind: "win", limit: rs(2500), net: rs(2500) });
    const down = [saved(1, 1, -rs(4000))];
    expect(limitReached({ ...session, stopLoss: rs(3000) }, down)).toEqual({ kind: "loss", limit: rs(3000), net: -rs(4000) });
  });
  it("a zero or empty limit means no limit", () => {
    expect(limitReached({ ...session, stopWin: 0, stopLoss: null }, rounds)).toBeNull();
  });
});
