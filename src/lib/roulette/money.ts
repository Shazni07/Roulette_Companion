import type { Currency } from "./types";

/** Money is stored as integer minor units: 1 major unit = 100 minor units. */
export const MINOR_PER_MAJOR = 100;

export interface CurrencyInfo {
  code: Currency;
  symbol: string;
  name: string;
}

/** Built in: the three currencies offered from the start. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "LKR", symbol: "Rs. ", name: "Sri Lankan Rupee" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "USD", symbol: "$", name: "US Dollar" },
];

/** Symbols for every currency we have met (built in, added by the user, or used by a saved session). */
const symbolBook = new Map<string, string>(CURRENCIES.map((c) => [c.code, c.symbol]));
/** The currencies the start page offers. The user can add to it and remove from it. */
let listed: CurrencyInfo[] = [...CURRENCIES];
const STORAGE_KEY = "roulette-companion-currency-list";

export function allCurrencies(): CurrencyInfo[] {
  return [...listed];
}

/** Adds a currency to the list the start page offers. */
export function registerCurrency(info: CurrencyInfo): void {
  symbolBook.set(info.code, info.symbol);
  if (!listed.some((c) => c.code === info.code)) listed = [...listed, info];
}

/** Remembers the symbol of a currency a saved session uses, without adding it to the list. */
export function rememberSymbol(code: Currency, symbol: string): void {
  if (!symbolBook.has(code)) symbolBook.set(code, symbol);
}

/** Takes a currency off the list. The last one cannot be removed. Saved sessions keep their symbol. */
export function removeCurrency(code: Currency): boolean {
  if (listed.length <= 1 || !listed.some((c) => c.code === code)) return false;
  listed = listed.filter((c) => c.code !== code);
  return true;
}

export function currencySymbol(c: Currency): string {
  return symbolBook.get(c) ?? `${c} `;
}

export type NewCurrencyResult = { ok: true; info: CurrencyInfo } | { ok: false; error: string };

/** Checks a currency the user wants to add: 2-5 letters, not already in the list. */
export function validateNewCurrency(code: string, symbol: string): NewCurrencyResult {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(c)) return { ok: false, error: "Type the currency code with 2 to 5 letters, for example EUR." };
  if (listed.some((x) => x.code === c)) return { ok: false, error: `${c} is already in the list.` };
  const builtIn = CURRENCIES.find((x) => x.code === c);
  if (builtIn) return { ok: true, info: builtIn }; // putting back LKR, INR or USD
  const sym = symbol.trim();
  if (sym.length > 4) return { ok: false, error: "The symbol can have at most 4 characters, for example €." };
  return { ok: true, info: { code: c, symbol: sym ? (/^[A-Za-z]+$/.test(sym) ? `${sym} ` : sym) : `${c} `, name: c } };
}

/** Remembers the list on this device (a small preference; storage can be blocked, so it is wrapped). */
export function saveCurrencyList(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(listed));
  } catch {
    /* storage unavailable: the list still works until the page is closed */
  }
}

export function loadCurrencyList(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = (JSON.parse(raw) as CurrencyInfo[]).filter((x) => x && typeof x.code === "string" && typeof x.symbol === "string");
    if (saved.length === 0) return;
    listed = saved.map((x) => ({ code: x.code, symbol: x.symbol, name: x.name ?? x.code }));
    for (const x of listed) symbolBook.set(x.code, x.symbol);
  } catch {
    /* ignore a damaged value */
  }
}

/** Test helper: back to the three built-in currencies. */
export function resetCurrencies(): void {
  listed = [...CURRENCIES];
  symbolBook.clear();
  for (const c of CURRENCIES) symbolBook.set(c.code, c.symbol);
}

/** Parses "12", "12.5", "1,000.25" into minor units using string arithmetic only. */
export function parseMoney(input: string | number): number | null {
  const s = String(input).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  const minor = Number(whole) * MINOR_PER_MAJOR + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 350000 -> "Rs. 3,500". */
export function formatMoney(minor: number, currency: Currency, opts?: { sign?: boolean }): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR_PER_MAJOR);
  const frac = abs % MINOR_PER_MAJOR;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracStr = frac === 0 ? "" : "." + frac.toString().padStart(2, "0");
  const sign = neg ? "−" : opts?.sign && minor > 0 ? "+" : "";
  return `${sign}${currencySymbol(currency)}${wholeStr}${fracStr}`;
}

export function minorToInput(minor: number): string {
  const whole = Math.floor(minor / MINOR_PER_MAJOR);
  const frac = minor % MINOR_PER_MAJOR;
  return frac === 0 ? String(whole) : `${whole}.${frac.toString().padStart(2, "0")}`;
}
