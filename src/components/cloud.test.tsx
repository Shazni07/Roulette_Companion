// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { friendlyError, useCloud } from "@/lib/sync/cloud";
import { CloudCard } from "./CloudCard";

const base = useCloud.getState();
const set = (patch: Partial<ReturnType<typeof useCloud.getState>>) => useCloud.setState(patch);

beforeEach(() => {
  useCloud.setState({ ...base, enabled: true, checked: true, user: null, status: "idle", pending: 0, lastSyncedAt: null, message: null });
});
afterEach(() => {
  cleanup();
  useCloud.setState(base, true);
});

describe("friendly messages", () => {
  it("turns technical errors into plain sentences", () => {
    expect(friendlyError(new Error("Invalid login credentials"))).toBe("Wrong email or password.");
    expect(friendlyError(new Error("Email not confirmed"))).toMatch(/confirmation email/);
    expect(friendlyError(new Error("Password should be at least 6 characters."))).toMatch(/at least 6/);
    expect(friendlyError(new TypeError("Failed to fetch"))).toBe("No internet connection.");
    expect(friendlyError({ message: "Could not find the table 'public.rounds' in the schema cache" })).toMatch(/not ready yet/);
  });
});

describe("online storage card", () => {
  it("is not shown at all when online storage is not set up", () => {
    set({ enabled: false });
    const { container } = render(<CloudCard />);
    expect(container.textContent).toBe("");
  });

  it("signed out: offers sign in, and signs in with the typed email and password", async () => {
    const signIn = vi.fn(async () => null);
    set({ signIn });
    render(<CloudCard />);
    expect(screen.getByText("Keep your sessions safe online")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign In or Create Account" }));
    const submit = screen.getByRole("button", { name: "Sign In" });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // nothing typed yet
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } });
    fireEvent.click(submit);
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("me@example.com", "secret1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); // closes on success
  });

  it("shows the problem in plain words when the sign-in fails, and keeps the box open", async () => {
    set({ signIn: vi.fn(async () => "Wrong email or password.") });
    render(<CloudCard />);
    fireEvent.click(screen.getByRole("button", { name: "Sign In or Create Account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-one" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(await screen.findByText("Wrong email or password.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("create account: asks to open the confirmation email when the project requires it", async () => {
    const signUp = vi.fn(async () => ({ error: null, needsConfirm: true }));
    set({ signUp });
    render(<CloudCard />);
    fireEvent.click(screen.getByRole("button", { name: "Sign In or Create Account" }));
    fireEvent.click(screen.getByRole("button", { name: "I do not have an account yet" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("new@example.com", "secret1"));
    expect(await screen.findByText(/Open it and tap the link/)).toBeTruthy();
  });

  it("signed in: shows the account and what is saved", () => {
    set({ user: { id: "u1", email: "me@example.com" }, lastSyncedAt: Date.now() });
    render(<CloudCard />);
    expect(screen.getByText("me@example.com")).toBeTruthy();
    expect(screen.getByText(/Everything is saved online/)).toBeTruthy();
  });

  it("signed in, offline with waiting changes: says they will be saved later", () => {
    set({ user: { id: "u1", email: "me@example.com" }, status: "offline", pending: 3 });
    render(<CloudCard />);
    expect(screen.getByText("No internet. 3 changes will be saved online later.")).toBeTruthy();
  });

  it("'Save Online Now' starts a sync", () => {
    const syncNow = vi.fn(async () => undefined);
    set({ user: { id: "u1", email: "me@example.com" }, syncNow });
    render(<CloudCard />);
    fireEvent.click(screen.getByRole("button", { name: "Save Online Now" }));
    expect(syncNow).toHaveBeenCalledWith("full");
  });

  it("sign out is refused while changes are not online, and can be forced", async () => {
    const signOut = vi.fn(async (force?: boolean) => (force ? { ok: true, pending: 0 } : { ok: false, pending: 2 }));
    set({ user: { id: "u1", email: "me@example.com" }, signOut });
    render(<CloudCard />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/2 changes could not be saved online/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign Out Anyway" }));
    await waitFor(() => expect(signOut).toHaveBeenLastCalledWith(true));
  });
});
