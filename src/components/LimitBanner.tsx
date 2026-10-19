"use client";

import { formatMoney } from "@/lib/roulette/money";
import { limitReached } from "@/lib/roulette/report";
import { useStore } from "@/lib/state/store";
import { Alert } from "./ui";

/** A calm reminder when the stop-win or stop-loss the player set has been reached. It never blocks anything. */
export function LimitBanner() {
  const session = useStore((s) => s.session);
  const rounds = useStore((s) => s.rounds);
  if (!session) return null;
  const hit = limitReached(session, rounds);
  if (!hit) return null;
  const fmt = (n: number) => formatMoney(n, session.currency);
  return hit.kind === "win" ? (
    <Alert tone="good">
      <p className="font-bold">You reached your win limit.</p>
      <p>
        You are up {fmt(hit.net)} and your limit was {fmt(hit.limit)}. This is a good moment to stop. You can keep playing if you want to.
      </p>
    </Alert>
  ) : (
    <Alert tone="warn">
      <p className="font-bold">You reached your loss limit.</p>
      <p>
        You are down {fmt(-hit.net)} and your limit was {fmt(hit.limit)}. This is a good moment to stop. You can keep playing if you want to.
      </p>
    </Alert>
  );
}
