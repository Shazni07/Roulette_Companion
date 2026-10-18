// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rs } from "@/tests/helpers";
import { positionKey } from "@/lib/roulette/rules";
import * as db from "@/lib/state/db";
import { useStore } from "@/lib/state/store";
import { ResultScreen, ReviewScreen, SavedScreen } from "./screens/Play";

const S = () => useStore.getState();
let n = 0;

beforeEach(async () => {
  db.resetDB(`play-${n++}-${Math.random()}`);
  useStore.setState({ ready: false, error: null, notice: null, sessions: [], session: null, rounds: [], screen: "home", outsideVisible: false });
  await S().init();
  await S().startSession({ currency: "LKR", startingMoney: rs(20000), chips: [{ value: rs(100), count: 10 }] });
  await S().startRound();
  await S().setMain([7, 8]);
  const d = S().session!.inventory[0]!.id;
  await S().adjustChips(positionKey("straight", [7]), d, 2); // Rs. 200 on a 35 to 1 bet
  await S().adjustChips(positionKey("split", [7, 8]), d, 1);
});
afterEach(cleanup);

describe("whole-round result for each number on other screens", () => {
  it("Check Your Bets lists what happens if each main number comes up", () => {
    render(<ReviewScreen />);
    expect(screen.getByText("If a Main Number Comes Up")).toBeTruthy();
    // bets: straight 7 (Rs. 200) + split 7/8 (Rs. 100)
    // 7 comes up: 7,000 + 1,700 = Win 8,700 · 8 comes up: 1,700 − 200 = Win 1,500
    expect(screen.getByText("Win Rs. 8,700")).toBeTruthy();
    expect(screen.getByText("Win Rs. 1,500")).toBeTruthy();
  });

  it("Check Your Bets no longer has an Inside Bets list (its bets are still counted)", () => {
    render(<ReviewScreen />);
    expect(screen.queryByText("Inside Bets")).toBeNull();
    expect(screen.queryByText("Straight: 7")).toBeNull();
    expect(screen.queryByText("Split: 7 / 8")).toBeNull();
    // the totals still include the inside bets: straight 7 (Rs. 200) + split 7/8 (Rs. 100)
    expect(screen.getByText("Total Money Bet").nextSibling?.textContent).toBe("Rs. 300");
    expect(screen.getByText("Total Chips Placed").nextSibling?.textContent).toBe("3");
  });

  it("Round Result tells a losing straight what the round would have been", async () => {
    await S().confirm();
    await S().settle(8); // straight 7 loses, split 7/8 wins
    render(<ResultScreen />);
    await waitFor(() => expect(screen.getByText(/If 7 had come up your round would have been a win of Rs\. 8,700\./)).toBeTruthy());
  });

  it("a winning straight does not repeat it (it already shows its profit)", async () => {
    await S().confirm();
    await S().settle(7);
    render(<ResultScreen />);
    await waitFor(() => expect(screen.getByText("Straight: 7")).toBeTruthy());
    expect(screen.queryByText(/had come up/)).toBeNull();
    expect(screen.getAllByText(/Profit/).some((el) => (el.textContent ?? "").includes("+Rs. 7,000"))).toBe(true);
  });
});

describe("total profit or loss over all rounds", () => {
  it("Round Result adds this round to the saved ones; Round Saved shows the total", async () => {
    // round 1: straight 7 (Rs. 200) + split 7/8 (Rs. 100); 8 comes up: split wins 1,700, straight loses 200 -> +1,500
    await S().confirm();
    await S().settle(8);
    const { unmount } = render(<ResultScreen />);
    await waitFor(() => expect(screen.getByText("All Rounds Together (with this one)").nextSibling?.textContent).toBe("+Rs. 1,500"));
    unmount();
    await S().saveRound({});
    const saved = render(<SavedScreen />);
    expect(within(screen.getByText("Totals for All Rounds").closest("section")!).getByText("Profit or Loss").nextSibling?.textContent).toBe("+Rs. 1,500");
    saved.unmount();

    // round 2: Rs. 100 on straight 7, number 3 comes up -> -100, so all rounds = +1,400
    await S().nextRound();
    await S().keepNumbers("same");
    await S().adjustChips(positionKey("straight", [7]), S().session!.inventory[0]!.id, 1);
    await S().confirm();
    await S().settle(3);
    const r2 = render(<ResultScreen />);
    await waitFor(() => expect(screen.getByText("All Rounds Together (with this one)").nextSibling?.textContent).toBe("+Rs. 1,400"));
    expect(screen.getByText("Net Profit or Loss").nextSibling?.textContent).toBe("−Rs. 100"); // this round on its own
    // the totals card on the result: both rounds, money won / lost and chips
    const card = within(screen.getByText("Totals for All Rounds (with this one)").closest("section")!);
    const val = (label: string) => card.getByText(label).nextSibling?.textContent;
    expect(val("Rounds")).toBe("2");
    expect(val("Money Won")).toBe("Rs. 1,700"); // round 1: split 7/8
    expect(val("Money Lost")).toBe("Rs. 300"); // round 1: straight 7 (200) + round 2: straight 7 (100)
    expect(val("Profit or Loss")).toBe("+Rs. 1,400");
    expect(val("Chips Placed")).toBe("4"); // 3 + 1
    expect(val("Chips Lost")).toBe("3"); // 2 + 1
    expect(val("Chips That Won")).toBe("1");
    r2.unmount();
    await S().saveRound({});
    render(<SavedScreen />);
    expect(screen.getByText("Round 2 result").nextSibling?.textContent).toBe("Loss: Rs. 100"); // the last round on its own
    const saved2 = within(screen.getByText("Totals for All Rounds").closest("section")!);
    expect(saved2.getByText("Rounds").nextSibling?.textContent).toBe("2");
    expect(saved2.getByText("Money Won").nextSibling?.textContent).toBe("Rs. 1,700");
    expect(saved2.getByText("Money Lost").nextSibling?.textContent).toBe("Rs. 300");
    expect(saved2.getByText("Profit or Loss").nextSibling?.textContent).toBe("+Rs. 1,400");
  });

  it("shows a loss clearly when the rounds together are negative", async () => {
    await S().confirm();
    await S().settle(0); // both bets lose: -300
    await S().saveRound({});
    render(<SavedScreen />);
    expect(within(screen.getByText("Totals for All Rounds").closest("section")!).getByText("Profit or Loss").nextSibling?.textContent).toBe("−Rs. 300");
  });
});
