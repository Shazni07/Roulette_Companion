/** Small settings kept on this phone only (never sent online). */
export type TextSize = "normal" | "large";

const TEXT_KEY = "roulette-companion-text-size";
const VIBRATE_KEY = "roulette-companion-vibrate";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window: the choice simply is not remembered */
  }
};

export const getTextSize = (): TextSize => (read(TEXT_KEY) === "large" ? "large" : "normal");

/** Makes every text on the page bigger or normal (the styles scale from the page's base size). */
export function applyTextSize(size: TextSize): void {
  if (typeof document === "undefined") return;
  if (size === "large") document.documentElement.dataset.text = "large";
  else delete document.documentElement.dataset.text;
}

export function setTextSize(size: TextSize): void {
  write(TEXT_KEY, size);
  applyTextSize(size);
}

export const canVibrate = (): boolean => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
export const getVibrate = (): boolean => read(VIBRATE_KEY) !== "off";
export const setVibrate = (on: boolean): void => write(VIBRATE_KEY, on ? "on" : "off");

/** A tiny buzz as feedback (Android phones; iPhones do not allow it). Does nothing when switched off. */
export function buzz(ms = 15): void {
  if (!canVibrate() || !getVibrate()) return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* not allowed right now: ignore */
  }
}
