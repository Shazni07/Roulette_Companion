// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getSession: vi.fn(async () => ({ data: { session: null } })),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("./client", () => ({
  cloudConfigured: () => true,
  getSupabase: () => ({ auth }),
  supabaseRemote: vi.fn(),
}));

// a fresh copy of the modules for every test, because the sign-in code remembers that it has started
let useCloud: typeof import("./cloud").useCloud;
let useStore: typeof import("@/lib/state/store").useStore;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ useCloud } = await import("./cloud"));
  ({ useStore } = await import("@/lib/state/store"));
});
afterEach(() => {
  window.location.hash = "";
});

describe("forgot password", () => {
  it("sends the reset email and asks Supabase to bring the player back to this site", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    expect(await useCloud.getState().resetPassword("  me@example.com ")).toBeNull();
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("me@example.com", { redirectTo: window.location.origin });
  });

  it("turns a failure into a plain sentence", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "Email rate limit exceeded" } });
    expect(await useCloud.getState().resetPassword("me@example.com")).toMatch(/Too many tries/);
    auth.resetPasswordForEmail.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await useCloud.getState().resetPassword("me@example.com")).toBe("No internet connection.");
  });
});

describe("choosing a new password after the email link", () => {
  it("saves it, closes the box and tells the player", async () => {
    auth.updateUser.mockResolvedValue({ error: null });
    useCloud.setState({ recovering: true });
    expect(await useCloud.getState().setNewPassword("brand-new-1")).toBeNull();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "brand-new-1" });
    expect(useCloud.getState().recovering).toBe(false);
    expect(useStore.getState().notice).toBe("Your password was changed.");
  });

  it("keeps the box open and explains when Supabase refuses", async () => {
    auth.updateUser.mockResolvedValue({ error: { message: "Password should be at least 6 characters." } });
    useCloud.setState({ recovering: true });
    expect(await useCloud.getState().setNewPassword("abc")).toMatch(/at least 6/);
    expect(useCloud.getState().recovering).toBe(true);
  });

  it("opening the app from the reset link (type=recovery in the address) shows the box", async () => {
    window.location.hash = "#access_token=abc&type=recovery";
    await useCloud.getState().start();
    expect(useCloud.getState().recovering).toBe(true);
  });

  it("a normal visit does not", async () => {
    await useCloud.getState().start();
    expect(useCloud.getState().recovering).toBe(false);
    expect(useCloud.getState().checked).toBe(true);
  });
});
