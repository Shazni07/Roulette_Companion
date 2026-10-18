// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureInstallPrompt } from "@/lib/pwa";
import { InstallCard } from "./PwaParts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = IPHONE.replace("Version/17.5 Mobile", "CriOS/126.0.0.0 Mobile");
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const setUa = (ua: string) => vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
const standalone = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes("standalone"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  localStorage.clear();
  standalone(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Put this app on your phone (home screen card)", () => {
  it("iPhone Safari: shows the Share → Add to Home Screen steps", () => {
    setUa(IPHONE);
    render(<InstallCard />);
    expect(screen.getByText("Put this app on your phone")).toBeTruthy();
    expect(screen.getByText("Add to Home Screen")).toBeTruthy();
    expect(screen.getByLabelText("Share")).toBeTruthy();
  });

  it("iPhone in another browser: says to open it in Safari", () => {
    setUa(IPHONE_CHROME);
    render(<InstallCard />);
    expect(screen.getByText(/can only be installed from/)).toBeTruthy();
    expect(screen.getByText("Safari")).toBeTruthy();
  });

  it("Android: shows the menu steps, then an Install App button once the browser offers it", async () => {
    setUa(ANDROID);
    captureInstallPrompt();
    render(<InstallCard />);
    expect(screen.getByText("Install app")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install App" })).toBeNull();

    const prompt = vi.fn(async () => undefined);
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) });
    await act(async () => {
      window.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true); // the browser's own banner is held back
    const button = screen.getByRole("button", { name: "Install App" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed and stays away afterwards", () => {
    setUa(IPHONE);
    const { unmount } = render(<InstallCard />);
    fireEvent.click(screen.getByRole("button", { name: "Do not show this again" }));
    expect(screen.queryByText("Put this app on your phone")).toBeNull();
    unmount();
    render(<InstallCard />);
    expect(screen.queryByText("Put this app on your phone")).toBeNull();
  });

  it("shows nothing on a computer, or once the app is installed", () => {
    setUa(WINDOWS);
    const a = render(<InstallCard />);
    expect(a.container.textContent).toBe("");
    a.unmount();
    setUa(IPHONE);
    standalone(true);
    const b = render(<InstallCard />);
    expect(b.container.textContent).toBe("");
  });
});
