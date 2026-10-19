"use client";

import clsx from "clsx";
import { useState } from "react";
import { ScreenFrame } from "@/components/ScreenFrame";
import { ShareButtons } from "@/components/ShareButtons";
import { Button, Card, ConfirmDialog, Heading, Row, plural } from "@/components/ui";
import { formatMoney } from "@/lib/roulette/money";
import { savedRounds } from "@/lib/roulette/report";
import { totalProfitLoss } from "@/lib/roulette/session";
import { useStore } from "@/lib/state/store";
import { SessionSummary } from "./Play";

const tone = (n: number) => (n > 0 ? "text-gain" : n < 0 ? "text-loss" : "");

/* ───────── Past Sessions: every finished session and the totals ───────── */
export function HistoryScreen() {
  const sessions = useStore((s) => s.sessions);
  const rounds = useStore((s) => s.pastRounds);
  const { go, openPast } = useStore();

  const finished = sessions.filter((s) => s.sessionStatus === "finished").sort((a, b) => b.startedAt - a.startedAt);
  // sessions can use different currencies, so the totals are kept per currency
  const byCurrency = new Map<string, { sessions: number; net: number }>();
  for (const s of finished) {
    const t = byCurrency.get(s.currency) ?? { sessions: 0, net: 0 };
    t.sessions += 1;
    t.net += totalProfitLoss(s, rounds);
    byCurrency.set(s.currency, t);
  }

  return (
    <ScreenFrame title="Past Sessions" subtitle="Every session you have finished." onBack={() => go("home")} backLabel="Back to Start">
      {finished.length === 0 ? (
        <Card>
          <p className="text-lg text-muted">No finished sessions yet. A session appears here after you tap Finish Session.</p>
        </Card>
      ) : (
        <>
          <Card>
            <Heading>All Finished Sessions Together</Heading>
            {[...byCurrency.entries()].map(([currency, t]) => (
              <div key={currency} className="border-b border-line py-1 last:border-0">
                <Row label={`${plural(t.sessions, "session")} (${currency})`} value={formatMoney(t.net, currency, { sign: true })} strong tone={t.net > 0 ? "good" : t.net < 0 ? "bad" : undefined} />
              </div>
            ))}
          </Card>
          {finished.map((s) => {
            const net = totalProfitLoss(s, rounds);
            const n = savedRounds(s, rounds).length;
            return (
              <Card key={s.id} className="space-y-3">
                <div>
                  <div className="text-xl font-bold">{new Date(s.startedAt).toLocaleDateString()}</div>
                  <div className="text-lg text-muted">
                    {plural(n, "round")} · started with {formatMoney(s.startingMoney, s.currency)}
                  </div>
                  <div className={clsx("tabular text-2xl font-bold", tone(net))}>{formatMoney(net, s.currency, { sign: true })}</div>
                </div>
                <Button className="w-full" onClick={() => openPast(s.id)}>
                  Open
                </Button>
              </Card>
            );
          })}
        </>
      )}
    </ScreenFrame>
  );
}

/* ───────── One past session ───────── */
export function PastDetailScreen() {
  const session = useStore((s) => s.viewing);
  const rounds = useStore((s) => s.pastRounds);
  const { go, deleteSession } = useStore();
  const [deleting, setDeleting] = useState(false);
  if (!session) return null;
  return (
    <ScreenFrame title={`Session of ${new Date(session.startedAt).toLocaleDateString()}`} subtitle="A finished session." onBack={() => go("history")} backLabel="Back">
      <SessionSummary session={session} rounds={rounds} />
      <ShareButtons session={session} rounds={rounds} />
      <button className="min-h-[44px] w-full text-base text-muted underline" onClick={() => setDeleting(true)}>
        Delete this session
      </button>
      <ConfirmDialog
        open={deleting}
        title="Delete this session?"
        danger
        confirmLabel="Yes, Delete It Forever"
        body={<p>All the rounds of this session will be removed. This cannot be undone.</p>}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await deleteSession(session.id);
          setDeleting(false);
        }}
      />
    </ScreenFrame>
  );
}
