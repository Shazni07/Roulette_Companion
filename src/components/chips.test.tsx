// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rs } from "@/tests/helpers";
import { suggestChipCount } from "@/lib/roulette/inventory";
import { CURRENCIES, allCurrencies, currencySymbol, formatMoney, loadCurrencyList, resetCurrencies, validateNewCurrency } from "@/lib/roulette/money";
import * as db from "@/lib/state/db";
import { useStore } from "@/lib/state/store";
import { ChipsEditor } from "./ChipsEditor";
import { MainNumbersBar } from "./MainNumbersBar";
import { StartScreen } from "./screens/Setup";

const S = () => useStore.getState();
let n = 0;

beforeEach(async () => {
  resetCurrencies();
  try {
    localStorage.clear();
  } catch {
    /* node test environment has no localStorage */
  }
  db.resetDB(`chips-${n++}-${Math.random()}`);
  useStore.setState({ ready: false, error: null, notice: null, sessions: [], session: null, rounds: [], screen: "setup", outsideVisible: false });
  await S().init();
});
afterEach(cleanup);

const type = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const val = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe("suggestChipCount", () => {
  it("turns money into whole chips", () => {
    expect(suggestChipCount(rs(1000), rs(200))).toBe(5);
    expect(suggestChipCount(rs(1000), rs(300))).toBe(3);
    expect(suggestChipCount(rs(100), rs(200))).toBe(0);
    expect(suggestChipCount(0, rs(200))).toBe(0);
    expect(suggestChipCount(rs(1000), 0)).toBe(0);
  });
});

describe("one start page: money, currency and one simple chip box", () => {
  it("offers only LKR, INR and USD", () => {
    expect(CURRENCIES.map((c) => c.code)).toEqual(["LKR", "INR", "USD"]);
    render(<StartScreen />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["LKR", "INR", "USD"]);
    expect(screen.getByRole("radio", { name: "LKR" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "INR" }));
    expect(screen.getByRole("radio", { name: "INR" }).getAttribute("aria-checked")).toBe("true");
  });

  it("the old chip list and the Add a Chip Type form are gone from the start page", () => {
    render(<StartScreen />);
    expect(screen.queryByText("Add a Chip Type")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add This Chip" })).toBeNull();
    expect(screen.queryByLabelText("How many chips")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change Value" })).toBeNull();
    expect(screen.getByLabelText("Chip value")).toBeTruthy(); // one box only
  });

  it("Rs. 1,000 and a Rs. 200 chip shows 5 chips; Continue starts the session with them", async () => {
    render(<StartScreen />);
    const next = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true); // needs money and a chip value
    type("Money to Play", "1000");
    expect(next.disabled).toBe(true);
    type("Chip value", "200");
    expect(screen.getByText("Number of chips").nextSibling?.textContent).toBe("5");
    expect(screen.getByText(/5 chips of Rs\. 200 = Rs\. 1,000/)).toBeTruthy();
    expect(screen.queryByText(/left over/)).toBeNull();
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    await waitFor(() => expect(S().session).not.toBeNull());
    expect(S().session).toMatchObject({ startingMoney: rs(1000), currency: "LKR", setupStep: "done" });
    expect(S().session!.inventory).toHaveLength(1);
    expect(S().session!.inventory[0]).toMatchObject({ value: rs(200), availableCount: 5 });
    expect(S().screen).toBe("numbers");
  });

  it("follows the money: changing the money or the chip value changes the count; a remainder is shown", () => {
    render(<StartScreen />);
    type("Money to Play", "1000");
    type("Chip value", "300");
    expect(screen.getByText("Number of chips").nextSibling?.textContent).toBe("3");
    expect(screen.getByText(/Rs\. 100 is left over/)).toBeTruthy();
    type("Money to Play", "1500");
    expect(screen.getByText("Number of chips").nextSibling?.textContent).toBe("5");
    type("Chip value", "100");
    expect(screen.getByText("Number of chips").nextSibling?.textContent).toBe("15");
  });

  it("a chip worth more than the money is explained and blocks Continue", () => {
    render(<StartScreen />);
    type("Money to Play", "100");
    type("Chip value", "500");
    expect(screen.getByText(/less than one chip of Rs\. 500/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the chosen currency for the chip line and the session", async () => {
    render(<StartScreen />);
    fireEvent.click(screen.getByRole("radio", { name: "USD" }));
    type("Money to Play", "1000");
    type("Chip value", "100");
    expect(screen.getByText(/10 chips of \$100 = \$1,000/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(S().session?.currency).toBe("USD"));
  });
});

describe("Change My Chips during a session follows the money too", () => {
  it("added money becomes chips: Rs. 5,000 more and a Rs. 500 chip suggests 10", async () => {
    await S().startSession({ currency: "LKR", startingMoney: rs(1000), chips: [{ value: rs(200), count: 5 }] });
    await S().addMoney(rs(5000));
    render(<ChipsEditor />);
    expect(screen.getByText("Money Not Yet in Chips").nextSibling?.textContent).toBe("Rs. 5,000");
    type("Chip value", "500");
    expect(val("How many chips")).toBe("10");
    fireEvent.click(screen.getByRole("button", { name: "Add This Chip" }));
    await waitFor(() => expect(S().session!.inventory).toHaveLength(2));
    expect(S().session!.inventory.find((d) => d.value === rs(500))!.availableCount).toBe(10);
  });
});

describe("Add Currency", () => {
  it("validates a new currency", () => {
    expect(validateNewCurrency("eur", "€")).toEqual({ ok: true, info: { code: "EUR", symbol: "€", name: "EUR" } });
    expect(validateNewCurrency("gbp", "")).toMatchObject({ ok: true, info: { code: "GBP", symbol: "GBP " } });
    expect(validateNewCurrency("Rs", "Rs")).toMatchObject({ ok: true, info: { symbol: "Rs " } });
    expect(validateNewCurrency("E", "")).toMatchObject({ ok: false });
    expect(validateNewCurrency("EU1", "")).toMatchObject({ ok: false });
    expect(validateNewCurrency("LKR", "")).toMatchObject({ ok: false, error: expect.stringMatching(/already/) });
    expect(validateNewCurrency("EUR", "12345")).toMatchObject({ ok: false });
  });

  it("a button adds a currency, selects it, and the session uses its symbol", async () => {
    render(<StartScreen />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Currency" }));
    fireEvent.change(screen.getByLabelText("Currency code"), { target: { value: "eur" } });
    fireEvent.change(screen.getByLabelText("Symbol (optional)"), { target: { value: "€" } });
    fireEvent.click(screen.getByRole("button", { name: "Add This Currency" }));
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(4));
    expect(screen.getByRole("radio", { name: "EUR" }).getAttribute("aria-checked")).toBe("true");
    expect(allCurrencies().map((c) => c.code)).toEqual(["LKR", "INR", "USD", "EUR"]);

    type("Money to Play", "1000");
    type("Chip value", "100");
    expect(screen.getByText(/10 chips of €100 = €1,000/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(S().session?.currency).toBe("EUR"));
    expect(S().session!.currencySymbol).toBe("€");
    expect(formatMoney(rs(2500), "EUR")).toBe("€2,500");
  });

  it("shows a clear message for a code that is already listed", async () => {
    render(<StartScreen />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Currency" }));
    fireEvent.change(screen.getByLabelText("Currency code"), { target: { value: "usd" } });
    fireEvent.click(screen.getByRole("button", { name: "Add This Currency" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/USD is already in the list/));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("is remembered for the next session on this device", () => {
    render(<StartScreen />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Currency" }));
    fireEvent.change(screen.getByLabelText("Currency code"), { target: { value: "gbp" } });
    fireEvent.change(screen.getByLabelText("Symbol (optional)"), { target: { value: "£" } });
    fireEvent.click(screen.getByRole("button", { name: "Add This Currency" }));
    cleanup();
    resetCurrencies(); // like a fresh page load
    expect(currencySymbol("GBP")).toBe("GBP "); // not known yet
    loadCurrencyList();
    expect(currencySymbol("GBP")).toBe("£");
    render(<StartScreen />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["LKR", "INR", "USD", "GBP"]);
  });
});

describe("remove a currency with its X button", () => {
  it("each currency has an X; removing asks first, updates the list and keeps it for next time", async () => {
    render(<StartScreen />);
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(3);
    fireEvent.click(screen.getByRole("radio", { name: "INR" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove INR" }));
    expect(screen.getByText(/INR is taken off this list/)).toBeTruthy(); // confirmation first
    fireEvent.click(screen.getByRole("button", { name: "Yes, Remove" }));
    await waitFor(() => expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["LKR", "USD"]));
    expect(screen.getByRole("radio", { name: "LKR" }).getAttribute("aria-checked")).toBe("true"); // the removed one was selected
    expect(JSON.parse(localStorage.getItem("roulette-companion-currency-list")!).map((c: { code: string }) => c.code)).toEqual(["LKR", "USD"]);
    // like a fresh page load: the list is remembered, and a built-in can be put back with its own symbol
    cleanup();
    resetCurrencies();
    loadCurrencyList();
    expect(allCurrencies().map((c) => c.code)).toEqual(["LKR", "USD"]);
    expect(validateNewCurrency("inr", "")).toEqual({ ok: true, info: CURRENCIES[1] });
  });

  it("the last currency cannot be removed, and a removed currency still formats in saved sessions", async () => {
    render(<StartScreen />);
    for (const code of ["USD", "INR"]) {
      fireEvent.click(screen.getByRole("button", { name: `Remove ${code}` }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, Remove" }));
      await waitFor(() => expect(screen.queryByRole("radio", { name: code })).toBeNull());
    }
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull(); // no X on the only one
    expect(currencySymbol("INR")).toBe("₹"); // amounts in existing sessions still format
  });
});

describe("Main Numbers bar (open and close)", () => {
  it("opens and shrinks with a tap, and keeps the chosen numbers visible when shrunk", () => {
    let chosen: number[] = [];
    const { rerender } = render(<MainNumbersBar selected={chosen} onToggle={() => {}} onSetAll={() => {}} />);
    const bar = () => screen.getByRole("button", { name: /Main Numbers/ });
    expect(bar().getAttribute("aria-expanded")).toBe("false"); // shrunk by default
    expect(screen.queryByRole("group", { name: "Main numbers" })).toBeNull();
    fireEvent.click(bar());
    expect(bar().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Main numbers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select All" })).toBeTruthy();
    fireEvent.click(bar()); // shrink again
    expect(screen.queryByRole("group", { name: "Main numbers" })).toBeNull();
    chosen = [7, 16];
    rerender(<MainNumbersBar selected={chosen} onToggle={() => {}} onSetAll={() => {}} />);
    expect(screen.getByText("2 numbers selected")).toBeTruthy();
    expect(screen.getByLabelText("16 red")).toBeTruthy(); // the chosen numbers show on the shrunk bar
  });

  it("selects numbers on the start page and they go into round 1", async () => {
    render(<StartScreen />);
    type("Money to Play", "1000");
    type("Chip value", "100");
    fireEvent.click(screen.getByRole("button", { name: /Main Numbers/ }));
    fireEvent.click(screen.getByRole("button", { name: "7 red" }));
    fireEvent.click(screen.getByRole("button", { name: "16 red" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(S().currentRound()?.selectedMainNumbers).toEqual([7, 16]));
    expect(S().screen).toBe("bets"); // numbers already chosen: straight to the bets
  });

  it("without numbers, Continue goes to the Main Numbers screen as before", async () => {
    render(<StartScreen />);
    type("Money to Play", "1000");
    type("Chip value", "100");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(S().session).not.toBeNull());
    expect(S().screen).toBe("numbers");
  });
});
