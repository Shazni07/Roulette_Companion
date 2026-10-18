"use client";

import { useState } from "react";
import { useCloud } from "@/lib/sync/cloud";
import { Alert, Button, Card, Field, Sheet, TextInput, plural } from "./ui";

const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Home screen: sign in to keep sessions safe online and to use them on another phone. Hidden when online storage is not set up. */
export function CloudCard() {
  const { enabled, checked, user, status, pending, lastSyncedAt, message, signOut, syncNow } = useCloud();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState<null | { pending: number }>(null);

  if (!enabled || !checked) return null;

  if (!user) {
    return (
      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Keep your sessions safe online</h2>
        <p className="text-lg text-muted">Sign in and your sessions are also saved online. You can open them on another phone. The app still works without internet.</p>
        <Button variant="primary" className="w-full" onClick={() => setOpen(true)}>
          Sign In or Create Account
        </Button>
        <SignInSheet open={open} onClose={() => setOpen(false)} />
      </Card>
    );
  }

  const line =
    status === "syncing"
      ? "Saving online…"
      : status === "offline"
        ? pending > 0
          ? `No internet. ${plural(pending, "change")} will be saved online later.`
          : "No internet right now."
        : status === "error"
          ? "Could not save online."
          : pending > 0
            ? `${plural(pending, "change")} waiting to be saved online.`
            : lastSyncedAt
              ? `Everything is saved online (${when(lastSyncedAt)}).`
              : "Signed in.";

  return (
    <Card className="space-y-3">
      <h2 className="text-xl font-bold">Saved online</h2>
      <p className="break-all text-lg text-muted">{user.email}</p>
      <p role="status" className="text-lg">
        {line}
      </p>
      {status === "error" && message && <Alert tone="bad">{message}</Alert>}
      <Button className="w-full" disabled={status === "syncing"} onClick={() => void syncNow("full")}>
        Save Online Now
      </Button>
      <button
        className="min-h-[44px] w-full text-base text-muted underline"
        onClick={async () => {
          const r = await signOut();
          if (!r.ok) setLeaving({ pending: r.pending });
        }}
      >
        Sign out
      </button>
      <Sheet open={!!leaving} onClose={() => setLeaving(null)} title="Some changes are not online yet">
        <div className="space-y-3 text-lg">
          <p>
            {leaving ? plural(leaving.pending, "change") : ""} could not be saved online (probably no internet). They are safe on this phone, but if you sign out they will not reach your account.
          </p>
        </div>
        <div className="mt-5 space-y-3">
          <Button variant="primary" className="w-full" onClick={() => setLeaving(null)}>
            Stay Signed In
          </Button>
          <Button
            variant="danger"
            className="w-full"
            onClick={async () => {
              await signOut(true);
              setLeaving(null);
            }}
          >
            Sign Out Anyway
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}

function SignInSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signIn, signUp } = useCloud();
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const ready = /\S+@\S+\.\S+/.test(email) && password.length >= 6;

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (creating) {
      const r = await signUp(email, password);
      if (r.error) setError(r.error);
      else if (r.needsConfirm) setCheckEmail(true);
      else onClose();
    } else {
      const e = await signIn(email, password);
      if (e) setError(e);
      else onClose();
    }
    setBusy(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title={creating ? "Create Account" : "Sign In"}>
      {checkEmail ? (
        <div className="space-y-4">
          <Alert tone="good">
            We sent a message to <b>{email}</b>. Open it and tap the link, then come back here and sign in.
          </Alert>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => {
              setCheckEmail(false);
              setCreating(false);
            }}
          >
            Go to Sign In
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) void submit();
          }}
        >
          <Field label="Email">{(id) => <TextInput id={id} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Password" hint={creating ? "At least 6 characters." : undefined}>
            {(id) => <TextInput id={id} type="password" autoComplete={creating ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button type="submit" variant="primary" className="w-full" disabled={!ready || busy}>
            {busy ? "Please wait…" : creating ? "Create Account" : "Sign In"}
          </Button>
          <button
            type="button"
            className="min-h-[44px] w-full text-base text-muted underline"
            onClick={() => {
              setCreating(!creating);
              setError(null);
            }}
          >
            {creating ? "I already have an account" : "I do not have an account yet"}
          </button>
        </form>
      )}
    </Sheet>
  );
}
