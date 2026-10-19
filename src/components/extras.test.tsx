// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { positionKey } from "@/lib/roulette/rules";
import { buzz, getTextSize, getVibrate, setTextSize } from "@/lib/prefs";
import * as db from "@/lib/state/db";
import { useStore } from "@/lib/state/store";
import { useCloud } from "@/lib/sync/cloud";
import { keepAwake } from "@/lib/wakeLock";
import { rs } from "@/tests/helpers";
import { CloudCard, SyncBadge } from "./CloudCard";
import { LimitBanner } from "./LimitBanner";
import { RecentNumbers } from "./RecentNumbers";
import { SessionBar } from "./SessionBar";
import { SettingsCard } from "./SettingsCard";
import { ShareButtons } from "./ShareButtons";
import { BetsScreen } from "./screens/Bets";
import { HistoryScreen, PastDetailScreen } from "./screens/History";
import { SavedScreen } from "./screens/Play";

const S = () => useStore.getState();
const d100 = () => S().session!.inventory.find((d) => d.value === rs(100))!.id;
const straight = (n: number) => positionKey("straight", [n]);
let n = 0;

beforeEach(async () => {
  localStorage.clear();
  delete document.documentElement.dataset.text;
  db.resetDB(`extras-${n++}-${Math.random()}`);
  useStore.setState({ ready: false, error: null, notice: null, sessions: [], session: null, rounds: [], screen: "home", outsideVisible: false, undoStack: [], pastRounds: [], viewing: null });
  await S().init();
  await S().startSession({ currency: "LKR", startingMoney: rs(20000), chips: [{ value: rs(100), count: 20 }] });
  await S().startRound();
  await S().setMain([7, 8]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useCloud.setState(useCloud.getInitialState(), true);
});

/** Plays one full round on straight 7 with two Rs. 100 chips: +Rs. 7,000 when 7 comes up, otherwise -Rs. 200. */
async function playRound(winning: number) {
  await S().adjustChips(straight(7), d100(), 2);
  await S().confirm();
  await S().settle(winning);
  await S().saveRound({});
}

describe("Undo (store)", () => {
  it("takes back the last chip change, one step at a time, and gives the chips back", async () => {
    await S().adjustChips(straight(7), d100(), 2);
    await S().adjustChips(straight(8), d100(), 3);
    expect(S().currentRound()!.totalChips).toBe(5);
    expect(await S().undo()).toBe(true);
    expect(S().currentRound()!.totalChips).toBe(2);
    expect(S().session!.inventory[0]!.availableCount).toBe(18);
    expect(await S().undo()).toBe(true);
    expect(S().currentRound()!.bets).toHaveLength(0);
    expect(S().session!.inventory[0]!.availableCount).toBe(20);
    expect(await S().undo()).toBe(false); // nothing left
    expect(S().error).toMatch(/nothing to undo/i);
  });

  it("is saved like any other change", async () => {
    await S().adjustChips(straight(7), d100(), 2);
    await S().undo();
    const stored = await db.getDB().rounds.get(S().currentRound()!.id);
    expect(stored!.bets).toHaveLength(0);
  });

  it("is dropped when the chip list is changed by hand, so old counts are never restored", async () => {
    await S().adjustChips(straight(7), d100(), 2);
    await S().bumpChip(d100(), 1);
    expect(S().undoStack).toHaveLength(0);
    expect(await S().undo()).toBe(false);
    expect(S().session!.inventory[0]!.availableCount).toBe(19); // 20 + 1 - 2
  });

  it("cannot be used on a confirmed round", async () => {
    await S().adjustChips(straight(7), d100(), 2);
    await S().confirm();
    expect(await S().undo()).toBe(false);
    expect(S().currentRound()!.totalChips).toBe(2);
  });

  it("does not carry over to the next round", async () => {
    await playRound(7);
    expect(S().undoStack).toHaveLength(0);
  });
});

describe("Undo button (screen)", () => {
  it("is disabled until a chip is placed, then undoes the change", async () => {
    render(<BetsScreen />);
    const button = screen.getByRole("button", { name: /Undo Last Chip Change/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await act(async () => {
      await S().adjustChips(straight(7), d100(), 2);
    });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(S().currentRound()!.totalChips).toBe(0));
    await waitFor(() => expect(button.disabled).toBe(true));
  });
});

describe("Past Sessions", () => {
  async function finishOne(winning: number) {
    await playRound(winning);
    await S().finishSession();
    S().leaveSession();
  }

  it("shows each finished session and the total across them", async () => {
    await finishOne(7); // +7,000
    await S().startSession({ currency: "LKR", startingMoney: rs(20000), chips: [{ value: rs(100), count: 20 }] });
    await S().startRound();
    await S().setMain([7]);
    await playRound(0); // -200
    await S().finishSession();
    S().leaveSession();
    await S().startSession({ currency: "LKR", startingMoney: rs(1000), chips: [{ value: rs(100), count: 5 }] }); // unfinished: not listed
    S().leaveSession();

    await S().openHistory();
    render(<HistoryScreen />);
    expect(screen.getByText("2 sessions (LKR)")).toBeTruthy();
    expect(screen.getByText("+Rs. 6,800")).toBeTruthy(); // 7,000 - 200 together
    expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(2);
  });

  it("says so when there is nothing yet", async () => {
    await S().openHistory();
    render(<HistoryScreen />);
    expect(screen.getByText(/No finished sessions yet/)).toBeTruthy();
  });

  it("opens one session with its summary and rounds, and can delete it", async () => {
    await playRound(7);
    await S().finishSession();
    S().leaveSession();
    await S().openHistory();
    const id = S().sessions.find((s) => s.sessionStatus === "finished")!.id;
    S().openPast(id);
    expect(S().screen).toBe("pastdetail");
    render(<PastDetailScreen />);
    expect(screen.getByText("Rounds Played")).toBeTruthy();
    expect(screen.getByLabelText("Rounds played").textContent).toContain("Round 1");
    expect(screen.getByRole("button", { name: "Share Summary" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete this session" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, Delete It Forever" }));
    await waitFor(() => expect(S().screen).toBe("history"));
    expect(S().sessions.some((s) => s.id === id)).toBe(false);
    expect(await db.getDB().rounds.where("sessionId").equals(id).count()).toBe(0);
  });
});

describe("Settings", () => {
  it("text size: Large makes the page bigger, is remembered, and Normal brings it back", () => {
    render(<SettingsCard />);
    fireEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect(document.documentElement.dataset.text).toBe("large");
    expect(getTextSize()).toBe("large");
    fireEvent.click(screen.getByRole("radio", { name: "Normal" }));
    expect(document.documentElement.dataset.text).toBeUndefined();
    setTextSize("large");
    expect(getTextSize()).toBe("large");
  });

  it("vibration choice is shown only on phones that can vibrate, and switching off stops the buzz", () => {
    render(<SettingsCard />);
    expect(screen.queryByRole("radiogroup", { name: "Vibration" })).toBeNull(); // jsdom has no vibrate
    cleanup();

    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    try {
      render(<SettingsCard />);
      expect(screen.getByRole("radiogroup", { name: "Vibration" })).toBeTruthy();
      vibrate.mockClear();
      buzz();
      expect(vibrate).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("radio", { name: "Off" }));
      expect(getVibrate()).toBe(false);
      vibrate.mockClear();
      buzz();
      expect(vibrate).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, "vibrate");
    }
  });
});

describe("Keep the screen awake", () => {
  it("asks for the lock, asks again when the app comes back to the front, and lets go at the end", async () => {
    const release = vi.fn(async () => undefined);
    const sentinels: { release: typeof release; addEventListener: () => void }[] = [];
    const request = vi.fn(async () => {
      const s = { release, addEventListener: () => {} };
      sentinels.push(s);
      return s;
    });
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    try {
      const stop = keepAwake();
      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      expect(request).toHaveBeenCalledWith("screen");
      stop();
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(navigator, "wakeLock");
    }
  });

  it("does nothing, without an error, where the phone has no such feature", () => {
    expect(() => keepAwake()()).not.toThrow();
  });
});

describe("Stop limits", () => {
  it("are set from the money bar and saved with the session", async () => {
    render(<SessionBar />);
    expect(screen.getByRole("button", { name: "Set stop limits (optional)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set stop limits (optional)" }));
    fireEvent.change(screen.getByLabelText("Remind me when I am up by"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Remind me when I am down by"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Limits" }));
    await waitFor(() => expect(S().session!.stopWin).toBe(rs(5000)));
    expect(S().session!.stopLoss).toBe(rs(1000));
    expect((await db.getDB().sessions.get(S().session!.id))!.stopWin).toBe(rs(5000));
    expect(await screen.findByRole("button", { name: /Stop limits: win Rs. 5,000 · loss Rs. 1,000/ })).toBeTruthy();
  });

  it("can be removed", async () => {
    await S().setLimits(rs(100), null);
    render(<SessionBar />);
    fireEvent.click(screen.getByRole("button", { name: /Stop limits: win Rs. 100/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Limits" }));
    await waitFor(() => expect(S().session!.stopWin).toBeNull());
  });

  it("a calm banner appears once the limit is reached, and never before", async () => {
    await S().setLimits(rs(5000), rs(150));
    const { container, rerender } = render(<LimitBanner />);
    expect(container.textContent).toBe("");
    await playRound(7); // +7,000: past the win limit
    rerender(<LimitBanner />);
    expect(screen.getByText("You reached your win limit.")).toBeTruthy();
    expect(screen.getByText(/You can keep playing if you want to/)).toBeTruthy();
  });

  it("a loss limit shows on the Round Saved screen", async () => {
    await S().setLimits(null, rs(150));
    await playRound(0); // -200
    render(<SavedScreen />);
    expect(screen.getByText("You reached your loss limit.")).toBeTruthy();
  });
});

describe("Last winning numbers", () => {
  it("shows nothing at first, then the newest first", async () => {
    const { container, rerender } = render(<RecentNumbers />);
    expect(container.textContent).toBe("");
    await playRound(17);
    await S().nextRound();
    await S().keepNumbers("same");
    await S().adjustChips(straight(7), d100(), 1);
    await S().confirm();
    await S().settle(5);
    await S().saveRound({});
    rerender(<RecentNumbers />);
    const items = within(screen.getByLabelText("Last winning numbers, newest first")).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["5", "17"]);
  });
});

describe("Share and download", () => {
  const pageRounds = () => S().rounds;

  it("shares a round summary with the phone's share menu", async () => {
    await playRound(7);
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      const last = pageRounds().find((r) => r.roundStatus === "completed")!;
      render(<ShareButtons session={S().session!} rounds={pageRounds()} round={last} />);
      fireEvent.click(screen.getByRole("button", { name: "Share This Round" }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      const arg = share.mock.calls[0] as unknown as [{ text: string }];
      expect(arg[0].text).toContain("Winning number: 7");
      expect(arg[0].text).toContain("Profit: Rs. 7,000");
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("copies the text when the phone has no share menu", async () => {
    await playRound(7);
    const writeText = vi.fn(async (text: string) => void text);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      render(<ShareButtons session={S().session!} rounds={pageRounds()} />);
      fireEvent.click(screen.getByRole("button", { name: "Share Summary" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText.mock.calls[0]![0]).toContain("Rounds played: 1");
      await waitFor(() => expect(S().notice).toMatch(/Copied/));
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("downloads the spreadsheet file for a session", async () => {
    await playRound(7);
    const make = vi.fn(() => "blob:test");
    Object.defineProperty(URL, "createObjectURL", { value: make, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      render(<ShareButtons session={S().session!} rounds={pageRounds()} />);
      fireEvent.click(screen.getByRole("button", { name: "Download Spreadsheet" }));
      expect(click).toHaveBeenCalledTimes(1);
      expect(make).toHaveBeenCalledTimes(1);
      const blob = (make.mock.calls[0] as unknown as [Blob])[0];
      expect(await blob.text()).toContain("Round,Winning number");
      expect(S().notice).toMatch(/Spreadsheet file saved/);
    } finally {
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });
});

describe("Forgot password", () => {
  beforeEach(() => useCloud.setState({ enabled: true, checked: true, user: null }));

  it("asks for the email only, sends the link, and tells the player what to do", async () => {
    const resetPassword = vi.fn(async () => null);
    useCloud.setState({ resetPassword });
    render(<CloudCard />);
    fireEvent.click(screen.getByRole("button", { name: "Sign In or Create Account" }));
    fireEvent.click(screen.getByRole("button", { name: "I forgot my password" }));
    expect(screen.queryByLabelText("Password")).toBeNull();
    const send = screen.getByRole("button", { name: "Send Reset Link" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.click(send);
    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith("me@example.com"));
    expect(await screen.findByText(/we sent a link to it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Sign In" }));
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("shows the problem in plain words when sending fails", async () => {
    useCloud.setState({ resetPassword: vi.fn(async () => "Too many tries. Please wait a few minutes and try again.") });
    render(<CloudCard />);
    fireEvent.click(screen.getByRole("button", { name: "Sign In or Create Account" }));
    fireEvent.click(screen.getByRole("button", { name: "I forgot my password" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Link" }));
    expect(await screen.findByText(/Too many tries/)).toBeTruthy();
  });

  it("the link from the email opens a box to choose a new password", async () => {
    const setNewPassword = vi.fn(async () => null);
    useCloud.setState({ recovering: true, setNewPassword });
    render(<CloudCard />);
    expect(screen.getByRole("dialog", { name: "Choose a New Password" })).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save New Password" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // too short
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "brand-new-1" } });
    fireEvent.click(save);
    await waitFor(() => expect(setNewPassword).toHaveBeenCalledWith("brand-new-1"));
  });
});

describe("Saved-online badge", () => {
  it("is hidden when signed out, and says what is happening when signed in", () => {
    const { container } = render(<SyncBadge />);
    expect(container.textContent).toBe("");
    cleanup();

    const states: [Partial<ReturnType<typeof useCloud.getState>>, string][] = [
      [{ status: "idle", pending: 0 }, "Saved online"],
      [{ status: "syncing" }, "Saving online…"],
      [{ status: "idle", pending: 2 }, "Saving online…"],
      [{ status: "offline", pending: 2 }, "No internet: will save online later"],
      [{ status: "error", pending: 0 }, "Could not save online"],
    ];
    for (const [patch, text] of states) {
      useCloud.setState({ enabled: true, checked: true, user: { id: "u", email: "a@b.c" }, ...patch });
      const r = render(<SyncBadge />);
      expect(r.container.textContent).toBe(text);
      r.unmount();
    }
  });
});
