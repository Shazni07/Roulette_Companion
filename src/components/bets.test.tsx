// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rs } from "@/tests/helpers";
import { positionKey } from "@/lib/roulette/rules";
import * as db from "@/lib/state/db";
import { useStore } from "@/lib/state/store";
import { BetsScreen } from "./screens/Bets";
import { NumberGrid, QtyStepper } from "./ui";

const S = () => useStore.getState();
let n = 0;

beforeEach(async () => {
  db.resetDB(`ui-${n++}-${Math.random()}`);
  useStore.setState({ ready: false, error: null, notice: null, sessions: [], session: null, rounds: [], screen: "home", outsideVisible: false });
  await S().init();
  await S().startSession({ currency: "LKR", startingMoney: rs(20000), chips: [{ value: rs(100), count: 10 }, { value: rs(500), count: 10 }] });
  await S().startRound();
  await S().setMain([7, 8]);
});
afterEach(cleanup);

/** Each main number starts folded (except the first); open the rest so every card can be read. */
const openAll = () => {
  for (const b of screen.getAllByRole("button", { expanded: false })) fireEvent.click(b);
};

describe("Test 6 – Outside Bets default and toggle (screen)", () => {
  it("is hidden when the betting screen opens; the toggle shows and hides it without deleting bets", async () => {
    render(<BetsScreen />);
    expect(screen.getByRole("button", { name: "Show Outside Bets" })).toBeTruthy();
    expect(screen.queryByText(/Third 12/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show Outside Bets" }));
    expect(screen.getByText(/Third 12/)).toBeTruthy();
    for (const label of ["First 12", "Second 12", "Third 12", "Low", "High", "Red", "Black", "Odd", "Even"]) {
      expect(screen.getAllByText(new RegExp(`^${label}`)).length).toBeGreaterThan(0);
    }

    // place chips on Red while outside bets are visible, then hide them
    const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    await S().adjustChips(positionKey("red", red), S().session!.inventory.find((d) => d.value === rs(100))!.id, 2);
    fireEvent.click(screen.getByRole("button", { name: "Hide Outside Bets" }));
    expect(screen.queryByText(/Third 12/)).toBeNull();
    await waitFor(() => expect(screen.getByText(/1 outside bet in this round/)).toBeTruthy());
    expect(S().currentRound()!.bets).toHaveLength(1); // hiding never deletes
  });

  it("shows inside bets under each main number; split 7/8 is one position with one state", async () => {
    render(<BetsScreen />);
    openAll();
    expect(screen.getByText("Bets with 7")).toBeTruthy();
    expect(screen.getByText("Bets with 8")).toBeTruthy();
    const splits = screen.getAllByText("Split: 7 / 8");
    expect(splits).toHaveLength(2); // shown under both numbers
    await S().adjustChips(positionKey("split", [7, 8]), S().session!.inventory[0]!.id, 1);
    await waitFor(() => expect(screen.getAllByText("Selected")).toHaveLength(2)); // both cards show the same bet
    expect(S().currentRound()!.bets).toHaveLength(1);
  });

  it("shows the previous-round and this-round figures once rounds are saved", async () => {
    const key = positionKey("straight", [7]);
    const d100 = () => S().session!.inventory.find((d) => d.value === rs(100))!.id;
    await S().adjustChips(key, d100(), 3);
    await S().confirm();
    await S().settle(0);
    await S().saveRound({});
    await S().nextRound();
    await S().keepNumbers("same");
    await S().adjustChips(key, d100(), 2);
    render(<BetsScreen />);
    const card = screen.getAllByText("Straight: 7")[0]!.closest("div.rounded-2xl")!;
    const text = card.textContent ?? "";
    expect(text).toContain("Previous Round (Round 1)3 chips");
    expect(text).not.toContain("All Earlier Rounds"); // removed at the client's request
    expect(text).toContain("This Round (Round 2)2 chips");
    expect(text).not.toContain("Projected Total"); // removed at the client's request
    expect(text).not.toContain("Money put on this number"); // removed at the client's request
  });
});

describe("straight bets show the result of the whole round if their number comes up", () => {
  it("shows it only on straight positions and updates with the chips", async () => {
    const d100 = () => S().session!.inventory.find((d) => d.value === rs(100))!.id;
    render(<BetsScreen />);
    openAll();
    // one "If … Comes Up" on the right of each straight position (7 and 8), none for splits, corners, etc.
    expect(screen.getAllByText(/^If [78] Comes Up$/)).toHaveLength(2);
    const card = (label: string) => screen.getAllByText(label)[0]!.closest("div.rounded-2xl")!;
    expect(card("Straight: 7").textContent).toContain("If 7 Comes UpRs. 0");
    // even with no chips yet, the player sees what each chip would win
    expect(card("Straight: 7").textContent).toContain("Each Rs. 100 chip winsRs. 3,500");
    expect(card("Straight: 7").textContent).toContain("Each Rs. 500 chip winsRs. 17,500");

    await S().adjustChips(positionKey("straight", [7]), d100(), 2); // Rs. 200 on a 35 to 1 bet
    await waitFor(() => expect(card("Straight: 7").textContent).toContain("Win Rs. 7,000"));
    // the other straight now loses those chips if 8 comes up
    expect(card("Straight: 8").textContent).toContain("Lose Rs. 200");
    expect(card("Straight: 7").textContent).toContain("Won on bets that cover 7Rs. 7,000");
    expect(card("Straight: 7").textContent).toContain("Lost on the other betsRs. 0");

    // a companion split 7/8 is counted for BOTH numbers: 7 -> 7,000 + 1,700; 8 -> 1,700 − 200
    await S().adjustChips(positionKey("split", [7, 8]), d100(), 1);
    await waitFor(() => expect(card("Straight: 7").textContent).toContain("Win Rs. 8,700"));
    expect(card("Straight: 8").textContent).toContain("Win Rs. 1,500");
    expect(card("Straight: 8").textContent).toContain("Won on bets that cover 8Rs. 1,700");
    expect(card("Straight: 8").textContent).toContain("Lost on the other bets−Rs. 200");

    const split = screen.getAllByText("Split: 7 / 8")[0]!.closest("div.rounded-2xl")!;
    expect(split.textContent).not.toContain("Comes Up");
  });
});

describe("the top of Choose Your Bets is kept simple", () => {
  it("has no money-and-chips card, no visible heading or sentence, and no round summary box", () => {
    render(<BetsScreen />);
    for (const gone of ["Money to Play", "My Chips", "Add More Money", "Change My Chips", "Tap Place Chips on a bet", "Bets Selected", "Total Chips Placed", "Total Money Bet", "Chips I can still place"]) {
      expect(screen.queryByText(new RegExp(gone))).toBeNull();
    }
    expect(screen.queryByRole("status", { name: "Current round summary" })).toBeNull();
    // the page keeps a heading for screen readers only, and everything else is still there
    expect(screen.getByRole("heading", { level: 1, name: "Choose Your Bets" }).className).toContain("sr-only");
    expect(screen.getByText("Inside Bets")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Outside Bets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review My Bets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});

describe("Add Chips button above the bets", () => {
  const d100 = () => S().session!.inventory.find((d) => d.value === rs(100))!.id;

  it("is not shown in round 1 (nothing to build on)", () => {
    render(<BetsScreen />);
    expect(screen.queryByRole("button", { name: /Add Chips to Last Round/ })).toBeNull();
  });

  it("round 2: opens a panel, raises last round's straight and splits, and fills the cards", async () => {
    await S().adjustChips(positionKey("straight", [7]), d100(), 2);
    await S().adjustChips(positionKey("split", [7, 8]), d100(), 1);
    await S().confirm();
    await S().settle(0);
    await S().saveRound({});
    await S().nextRound();
    await S().keepNumbers("same");
    render(<BetsScreen />);

    fireEvent.click(screen.getByRole("button", { name: /Add Chips to Last Round/ }));
    expect(screen.getByText("Straights")).toBeTruthy();
    expect(screen.getByText("Double Streets")).toBeTruthy();
    // straights: 1 bet with 2 chips; splits: 1 bet with 1 chip
    expect(screen.getByText("Straights").parentElement!.textContent).toContain("1 bet · 2 chips last round");
    expect(screen.getByText("Splits").parentElement!.textContent).toContain("1 bet · 1 chip last round");
    expect(screen.getAllByText("none last round")).toHaveLength(3); // corners, streets, double streets
    // the chips on each bet can be opened
    const lists = screen.getAllByText("See the chips on each bet");
    expect(lists).toHaveLength(2);
    const panel = within(screen.getByRole("dialog"));
    expect(panel.getByText("7").closest("li")!.textContent).toContain("2 × Rs. 100 · 2 chips");
    expect(panel.getByText("7 / 8").closest("li")!.textContent).toContain("1 × Rs. 100 · 1 chip");
    expect(screen.getByText(/The 2 bets \(3 chips\) from last round get the same chips/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("More extra chips on Straights"));
    fireEvent.click(screen.getByLabelText("More extra chips on Straights"));
    fireEvent.click(screen.getByLabelText("More extra chips on Splits"));
    expect(screen.getByText(/3 extra chips of Rs\. 100/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Apply to 2 bets/ }));

    await waitFor(() => expect(S().currentRound()!.bets).toHaveLength(2));
    const bets = S().currentRound()!.bets;
    expect(bets.find((b) => b.key === positionKey("straight", [7]))!.chipCount).toBe(4); // 2 + 2
    expect(bets.find((b) => b.key === positionKey("split", [7, 8]))!.chipCount).toBe(2); // 1 + 1
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); // the panel closes
    expect(screen.getAllByText("Selected").length).toBeGreaterThan(0); // the cards show the new chips
  });
});

describe("big controls", () => {
  it("number grid and stepper work and have accessible names", () => {
    let picked = -1;
    render(<NumberGrid selected={[7]} onToggle={(x) => (picked = x)} label="Main numbers" />);
    expect(screen.getAllByRole("button")).toHaveLength(37);
    fireEvent.click(screen.getByRole("button", { name: "8 black" }));
    expect(picked).toBe(8);
    cleanup();
    let v = 0;
    render(<QtyStepper label="Rs. 100 chips" value={0} max={2} onChange={(x) => (v = x)} />);
    expect((screen.getByLabelText("Fewer Rs. 100 chips") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("More Rs. 100 chips"));
    expect(v).toBe(1);
  });
});

describe("each main number folds open and closed", () => {
  const header = (n: number) => screen.getByRole("button", { name: new RegExp(`Bets with ${n}`) });

  it("starts with only the first number open, and each header opens and closes its own places", () => {
    render(<BetsScreen />);
    expect(header(7).getAttribute("aria-expanded")).toBe("true");
    expect(header(8).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByText("Straight: 7")).toHaveLength(1);
    expect(screen.queryByText("Straight: 8")).toBeNull();

    fireEvent.click(header(8)); // several can be open together
    expect(screen.getByText("Straight: 8")).toBeTruthy();
    expect(screen.getByText("Straight: 7")).toBeTruthy();

    fireEvent.click(header(7)); // closing one leaves the other open
    expect(screen.queryByText("Straight: 7")).toBeNull();
    expect(screen.getByText("Straight: 8")).toBeTruthy();
    expect(header(7).getAttribute("aria-expanded")).toBe("false");
  });

  it("the header shows what is placed, even while closed, and chips are kept when folded", async () => {
    const d100 = () => S().session!.inventory.find((d) => d.value === rs(100))!.id;
    render(<BetsScreen />);
    expect(header(8).textContent).toContain("No chips yet");
    await S().adjustChips(positionKey("straight", [8]), d100(), 2);
    await S().adjustChips(positionKey("split", [7, 8]), d100(), 1);
    await waitFor(() => expect(header(8).textContent).toContain("2 places · 3 chips · Rs. 300"));
    expect(header(8).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header(8));
    expect(screen.getByText("Straight: 8").closest("div.rounded-2xl")!.textContent).toContain("2 chips");
  });

  it("stays as the player left it while placing chips", async () => {
    const d100 = () => S().session!.inventory.find((d) => d.value === rs(100))!.id;
    render(<BetsScreen />);
    fireEvent.click(header(8));
    await S().adjustChips(positionKey("straight", [7]), d100(), 1);
    await waitFor(() => expect(header(7).textContent).toContain("1 place · 1 chip"));
    expect(header(8).getAttribute("aria-expanded")).toBe("true");
  });

  it("the bar of an open number sticks to the top of the screen; a closed one does not", () => {
    render(<BetsScreen />);
    const bar = (n: number) => header(n).parentElement!;
    expect(bar(7).dataset.sticky).toBe("true");
    expect(bar(7).className).toContain("sticky");
    expect(bar(8).dataset.sticky).toBeUndefined();
    expect(bar(8).className).not.toContain("sticky");
    fireEvent.click(header(8));
    expect(bar(8).className).toContain("sticky");
    fireEvent.click(header(7));
    expect(bar(7).className).not.toContain("sticky");
  });

  it("folding from far down the list scrolls back to the number's bar; folding near the top does not scroll", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    render(<BetsScreen />);
    const wrap = header(7).closest("div.space-y-3") as HTMLElement;

    rect.mockImplementation(function (this: Element) {
      return { top: this === wrap ? -400 : 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    fireEvent.click(header(7)); // scrolled far down: the number's block starts above the screen
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll).toHaveBeenCalledWith({ block: "start" });

    scroll.mockClear();
    fireEvent.click(header(7)); // open again
    rect.mockImplementation(() => ({ top: 20, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    fireEvent.click(header(7)); // the block starts on screen: nothing to scroll
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(scroll).not.toHaveBeenCalled();
    rect.mockRestore();
  });
});
