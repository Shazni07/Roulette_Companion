"use client";

import { useEffect, useState } from "react";
import { MainNumbersBar } from "@/components/MainNumbersBar";
import { ScreenFrame } from "@/components/ScreenFrame";
import { SessionBar } from "@/components/SessionBar";
import { Alert, Button, Card, ConfirmDialog, NumberList } from "@/components/ui";
import { hasDraftContent } from "@/lib/roulette/rounds";
import { resumeTarget, useStore } from "@/lib/state/store";

/* ───────── Welcome back: review an unfinished round ───────── */
export function ResumeScreen() {
  const session = useStore((s) => s.session);
  const round = useStore((s) => s.currentRound());
  const { go, leaveSession } = useStore();
  if (!session || !round) return null;
  const where = resumeTarget(session, round);
  const status: Record<string, string> = {
    draft: "You were choosing numbers.",
    planning: "You were choosing bets and chips.",
    confirmed: "Your bets were confirmed and are waiting for the winning number.",
    "awaiting-result": "Your bets were confirmed and are waiting for the winning number.",
    settled: "The result was calculated but the round was not saved yet.",
  };
  return (
    <ScreenFrame title="Welcome back" subtitle={`Round ${round.roundNumber} was not finished.`} onBack={leaveSession} backLabel="Back to Start" primaryLabel="Review My Round" onPrimary={() => go(where)}>
      <Alert tone="info">{status[round.roundStatus] ?? "Please check your round before you continue."}</Alert>
      <Card className="space-y-2 text-lg">
        <div>Main Numbers: {round.selectedMainNumbers.length ? <NumberList numbers={round.selectedMainNumbers} /> : "none yet"}</div>
        <div>Bets Selected: {round.bets.length}</div>
        <div>Chips Placed: {round.totalChips}</div>
      </Card>
      <p className="text-lg text-muted">Nothing is confirmed or calculated for you automatically. Please check your round first.</p>
    </ScreenFrame>
  );
}

/* ───────── Screen Five: Main Numbers ───────── */
export function NumbersScreen() {
  const round = useStore((s) => s.currentRound());
  const session = useStore((s) => s.session);
  const { toggleMain, setMain, startRound, go, clearDraft, leaveSession } = useStore();
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (session && !round) void startRound();
  }, [session, round, startRound]);

  if (!session || !round) return null;
  const sel = round.selectedMainNumbers;
  const first = round.roundNumber === 1;

  return (
    <ScreenFrame
      above={<SessionBar />}
      title={`Round ${round.roundNumber}: Main Numbers`}
      subtitle="Choose the numbers you want to use. We will show the possible places to bet on those numbers."
      onBack={() => first ? leaveSession() : go("keepnumbers")}
      primaryLabel="Continue"
      primaryDisabled={sel.length === 0}
      onPrimary={() => go("bets")}
    >
      <MainNumbersBar selected={sel} onToggle={(n) => void toggleMain(n)} onSetAll={(nums) => void setMain(nums)} defaultOpen />
      {hasDraftContent(round) && (
        <button className="min-h-[48px] w-full text-lg text-muted underline" onClick={() => setClearing(true)}>
          Clear Everything in This Round
        </button>
      )}
      <ConfirmDialog
        open={clearing}
        title="Clear this round?"
        danger
        confirmLabel="Yes, Clear It"
        body={<p>Your numbers, bets and chips for this round are cleared and your chips go back to your list. Saved rounds are not touched.</p>}
        onClose={() => setClearing(false)}
        onConfirm={async () => {
          await clearDraft();
          setClearing(false);
        }}
      />
    </ScreenFrame>
  );
}

/* ───────── After "Yes, Next Round": keep the same numbers? ───────── */
export function KeepNumbersScreen() {
  const rounds = useStore((s) => s.rounds);
  const round = useStore((s) => s.currentRound());
  const { keepNumbers } = useStore();
  const prev = rounds.filter((r) => r.roundStatus === "completed").sort((a, b) => b.roundNumber - a.roundNumber)[0];
  if (!round) return null;
  const has = !!prev && prev.selectedMainNumbers.length > 0;
  return (
    <ScreenFrame above={<SessionBar />} title="Keep the same main numbers?" subtitle={`Getting ready for Round ${round.roundNumber}.`}>
      {has && (
        <Card>
          <div className="mb-2 text-lg font-semibold">Round {prev!.roundNumber} numbers</div>
          <NumberList numbers={prev!.selectedMainNumbers} />
        </Card>
      )}
      <div className="space-y-3">
        <Button variant="primary" className="min-h-[64px] w-full" disabled={!has} onClick={() => void keepNumbers("same")}>
          Keep Same Numbers
        </Button>
        <Button className="min-h-[64px] w-full" disabled={!has} onClick={() => void keepNumbers("change")}>
          Change Numbers
        </Button>
        <Button className="min-h-[64px] w-full" onClick={() => void keepNumbers("new")}>
          Choose New Numbers
        </Button>
      </div>
      <p className="text-base text-muted">Your earlier rounds are never changed.</p>
    </ScreenFrame>
  );
}
