"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { roundProblems } from "@/lib/roulette/betting";
import { estimateHoldings, holdingsTotals } from "@/lib/roulette/chips";
import { inventoryTotals } from "@/lib/roulette/inventory";
import { colourOf } from "@/lib/roulette/rules";
import { allRoundsTotals, sessionBalance, totalAdded, totalProfitLoss, type AllRoundsTotals } from "@/lib/roulette/session";
import type { BetPosition, Round, Session } from "@/lib/roulette/types";
import { ScreenFrame } from "@/components/ScreenFrame";
import { SessionBar } from "@/components/SessionBar";
import { Alert, Badge, Button, Card, ConfirmDialog, Heading, NumberBadge, NumberGrid, NumberList, Row, plural, useFmt } from "@/components/ui";
import { resultIfNumberWins } from "@/lib/roulette/settlement";
import { useStore } from "@/lib/state/store";

function ChipsText({ bet }: { bet: BetPosition }) {
  const fmt = useFmt();
  return (
    <span className="tabular">
      {bet.allocations.map((a, i) => (
        <span key={a.id}>
          {i > 0 ? " + " : ""}
          {a.quantity} × {fmt(a.denominationValue)}
        </span>
      ))}
    </span>
  );
}

/** Money and chips over all rounds together (every saved round, and on the result screen also this one). */
function AllRoundsCard({ t, title }: { t: AllRoundsTotals; title: string }) {
  const fmt = useFmt();
  return (
    <Card>
      <Heading>{title}</Heading>
      <Row label="Rounds" value={t.rounds} />
      <Row label="Money Won" value={fmt(t.moneyWon)} tone={t.moneyWon > 0 ? "good" : undefined} />
      <Row label="Money Lost" value={fmt(t.moneyLost)} tone={t.moneyLost > 0 ? "bad" : undefined} />
      <Row label="Profit or Loss" value={fmt(t.net, true)} strong tone={t.net > 0 ? "good" : t.net < 0 ? "bad" : undefined} />
      <div className="mt-2 border-t border-line pt-2">
        <Row label="Chips Placed" value={t.chipsPlaced} />
        <Row label="Chips Lost" value={t.chipsLost} tone={t.chipsLost > 0 ? "bad" : undefined} />
        <Row label="Chips That Won" value={t.chipsWon} tone={t.chipsWon > 0 ? "good" : undefined} />
      </div>
      <p className="text-base text-muted">Money won is the profit on winning bets. The chips on a winning bet come back to you.</p>
    </Card>
  );
}

/* ───────── Confirm betting plan ───────── */
export function ReviewScreen() {
  const session = useStore((s) => s.session);
  const round = useStore((s) => s.currentRound());
  const { go, confirm } = useStore();
  const fmt = useFmt();
  const [busy, setBusy] = useState(false);
  if (!session || !round) return null;
  const problems = roundProblems(round.bets);
  const t = inventoryTotals(session.inventory);
  const outside = round.bets.filter((b) => b.category === "outside");

  const list = (title: string, bets: BetPosition[]) =>
    bets.length === 0 ? null : (
      <section className="space-y-3" aria-label={title}>
        <h2 className="text-2xl font-bold">{title}</h2>
        {bets.map((b) => (
          <Card key={b.id}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-xl font-bold">{b.label}</h3>
              <Badge tone={b.validationStatus === "valid" ? "good" : "bad"}>{b.validationStatus === "valid" ? "OK" : "Problem"}</Badge>
            </div>
            <div className="mt-1 text-base text-muted">Pays {b.payoutMultiplier} to 1</div>
            <div className="mt-2">{b.coveredNumbers.length <= 12 ? <NumberList numbers={b.coveredNumbers} /> : <span className="text-base text-muted">Covers {b.coveredNumbers.length} numbers</span>}</div>
            <div className="mt-2 text-lg">
              <ChipsText bet={b} />
            </div>
            <Row label="Chips on this bet" value={b.chipCount} />
            <Row label="Money on this bet" value={fmt(b.stake)} strong />
            {b.validationMessage && b.validationStatus !== "valid" && <Alert tone="bad">{b.validationMessage}</Alert>}
          </Card>
        ))}
      </section>
    );

  return (
    <ScreenFrame
      above={<SessionBar />}
      title="Check Your Bets"
      subtitle="Please check everything before the spin."
      onBack={() => go("bets")}
      backLabel="Edit Bets"
      primaryLabel="Continue to Winning Number"
      primaryDisabled={problems.length > 0 || busy}
      onPrimary={async () => {
        setBusy(true);
        await confirm();
        setBusy(false);
      }}
    >
      <Card>
        <div className="mb-2 text-lg font-semibold">Main Numbers</div>
        <NumberList numbers={round.selectedMainNumbers} />
        <div className="mt-3 border-t border-line pt-2">
          <Row label="Total Chips Placed" value={round.totalChips} strong />
          <Row label="Total Money Bet" value={fmt(round.totalBet)} strong />
          <Row label="Chips Left" value={`${t.availableChips} (${fmt(t.availableValue)})`} />
        </div>
      </Card>
      {problems.length > 0 && (
        <Alert tone="bad">
          <p className="font-bold">Please fix this before you continue:</p>
          <ul className="list-inside list-disc">
            {problems.slice(0, 4).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
      <Card>
        <Heading>If a Main Number Comes Up</Heading>
        <p className="mb-2 text-base text-muted">Your whole round: bets that cover the number win, all other bets lose.</p>
        <ul className="space-y-2">
          {round.selectedMainNumbers.map((n) => {
            const r = resultIfNumberWins(round.bets, n);
            return (
              <li key={n} className="flex items-center justify-between gap-3">
                <NumberBadge n={n} size="md" />
                <span className={clsx("tabular text-xl font-bold", r.net > 0 && "text-gain", r.net < 0 && "text-loss")}>
                  {r.net > 0 ? `Win ${fmt(r.net)}` : r.net < 0 ? `Lose ${fmt(-r.net)}` : fmt(0)}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      {list("Outside Bets", outside)}
    </ScreenFrame>
  );
}

/* ───────── Enter the winning number ───────── */
export function WinningScreen() {
  const round = useStore((s) => s.currentRound());
  const { settle, reopen } = useStore();
  const fmt = useFmt();
  const [pick, setPick] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!round) return null;
  return (
    <ScreenFrame
      title="Enter the Winning Number"
      subtitle={`Round ${round.roundNumber}: ${plural(round.bets.length, "bet")}, ${fmt(round.totalBet)} bet. Tap the number that came up.`}
      onBack={() => setEditing(true)}
      backLabel="Edit Bets"
      primaryLabel="Calculate Result"
      primaryDisabled={pick === null || busy}
      onPrimary={async () => {
        setBusy(true);
        await settle(pick!);
        setBusy(false);
      }}
    >
      <Card>
        <NumberGrid selected={pick === null ? [] : [pick]} onToggle={(n) => setPick(pick === n ? null : n)} label="Winning number" />
      </Card>
      {pick !== null && (
        <Card className="flex items-center gap-4">
          <NumberBadge n={pick} size="lg" />
          <div>
            <div className="text-sm text-muted">Winning Number</div>
            <div className="text-3xl font-bold capitalize">
              {pick} {colourOf(pick)}
            </div>
            <div className="text-base text-muted">Tap another number to change it.</div>
          </div>
        </Card>
      )}
      <ConfirmDialog
        open={editing}
        title="Go back and edit your bets?"
        confirmLabel="Yes, Edit My Bets"
        body={<p>Use this if the chips on the table are different from your plan. You will check your bets again before the result.</p>}
        onClose={() => setEditing(false)}
        onConfirm={async () => {
          if (await reopen("User returned to edit the bets")) setEditing(false);
        }}
      />
    </ScreenFrame>
  );
}

/* ───────── Results ───────── */
export function ResultScreen() {
  const session = useStore((s) => s.session);
  const round = useStore((s) => s.currentRound());
  if (!session || !round || round.winningNumber === null) return null;
  return <ResultView key={round.id} session={session} round={round} />;
}

function ResultView({ session, round }: { session: Session; round: Round }) {
  const rounds = useStore((s) => s.rounds);
  const { saveRound, reverse } = useStore();
  const fmt = useFmt();
  const est = useMemo(() => estimateHoldings(session.inventory, round.bets), [session.inventory, round.bets]);
  const [saving, setSaving] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const mine = holdingsTotals(est.estimated);
  const winners = round.bets.filter((b) => b.settlementStatus === "win");
  const losers = round.bets.filter((b) => b.settlementStatus === "loss");
  const balanceNow = sessionBalance(session, rounds);
  const net = round.netResult;
  // every saved round of this session plus this one (it is saved when you press Save Round)
  const allNet = totalProfitLoss(session, rounds) + net;

  const headline = net > 0 ? `Profit: ${fmt(net)}` : net < 0 ? `Loss: ${fmt(-net)}` : "No Profit or Loss";

  return (
    <ScreenFrame
      title="Round Result"
      subtitle={`Round ${round.roundNumber}`}
      onBack={() => setUndoing(true)}
      backLabel="Undo Result"
      primaryLabel={saving ? "Saving…" : "Save Round"}
      primaryDisabled={saving}
      onPrimary={async () => {
        setSaving(true);
        await saveRound({});
        setSaving(false);
      }}
    >
      <Card className="flex items-center gap-4">
        <NumberBadge n={round.winningNumber!} size="lg" />
        <div className="min-w-0">
          <div className="text-base text-muted">Winning Number</div>
          <div className={clsx("text-3xl font-bold leading-tight", net > 0 && "text-gain", net < 0 && "text-loss")}>{headline}</div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3">
        <Card>
          <Heading>Chips on Winning Bets</Heading>
          <Row label="Chips placed" value={plural(round.winningChips, "chip")} strong tone={round.winningChips > 0 ? "good" : undefined} />
          <Row label="Total stake" value={fmt(round.totalWinningStake)} />
          <p className="text-base text-muted">These are the chips you put on the winning bets.</p>
        </Card>
        <Card>
          <Heading>Chips on Losing Bets</Heading>
          <Row label="Chips placed" value={plural(round.losingChips, "chip")} strong tone={round.losingChips > 0 ? "bad" : undefined} />
          <Row label="Total stake lost" value={fmt(round.totalLosingStake)} />
          <p className="text-base text-muted">These chips are lost.</p>
        </Card>
      </div>

      <section className="space-y-3" aria-label="Every bet">
        <h2 className="text-2xl font-bold">Every Bet</h2>
        {[...winners, ...losers].map((b) => (
          <Card key={b.id} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-bold">{b.label}</span>
              <Badge tone={b.settlementStatus === "win" ? "good" : "bad"}>{b.settlementStatus === "win" ? "WON" : "LOST"}</Badge>
            </div>
            <div className="text-base text-muted">
              <ChipsText bet={b} /> · {plural(b.chipCount, "chip")} · {fmt(b.stake)}
            </div>
            {b.settlementStatus === "win" ? (
              <div className="text-lg">
                Profit <b className="text-gain">{fmt(b.winningProfit, true)}</b> · you get back <b>{fmt(b.totalPayout)}</b>
              </div>
            ) : (
              <div className="text-lg">
                You lose <b className="text-loss">{fmt(b.lostStake)}</b>
              </div>
            )}
            {b.betType === "straight" && b.settlementStatus === "loss" && (
              <div className="tabular text-base text-muted">
                {(() => {
                  const r = resultIfNumberWins(round.bets, b.coveredNumbers[0]!);
                  return `If ${b.coveredNumbers[0]} had come up your round would have been ${r.net >= 0 ? "a win of" : "a loss of"} ${fmt(Math.abs(r.net))}.`;
                })()}
              </div>
            )}
          </Card>
        ))}
      </section>

      <Card>
        <Heading>Money</Heading>
        <Row label="Total Money Bet" value={fmt(round.totalBet)} />
        <Row label="Net Profit or Loss" value={fmt(net, true)} strong tone={net > 0 ? "good" : net < 0 ? "bad" : undefined} />
        <Row label="All Rounds Together (with this one)" value={fmt(allNet, true)} strong tone={allNet > 0 ? "good" : allNet < 0 ? "bad" : undefined} />
        <div className="mt-2 border-t border-line pt-2">
          <Row label="Money Started With" value={fmt(session.startingMoney)} />
          <Row label="Additional Money Added" value={fmt(totalAdded(session))} />
          <Row label="Money to Play After This Round" value={fmt(balanceNow + net)} strong />
        </div>
        <p className="text-base text-muted">Money is separate from chips. Your chip count is below.</p>
      </Card>

      <AllRoundsCard t={allRoundsTotals(session, rounds, round)} title="Totals for All Rounds (with this one)" />

      <Card>
        <Heading>Chips I Have Now</Heading>
        <ul className="space-y-1">
          {est.estimated.map((d) => (
            <li key={d.id} className="tabular flex items-baseline justify-between gap-3 text-lg">
              <span className="text-muted">{fmt(d.value)} chips</span>
              <b>{d.availableCount}</b>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-xl bg-surface2 p-3">
          <Row label="Total Chips" value={mine.chips} strong />
          <Row label="Total Chip Value" value={fmt(mine.value)} strong />
        </div>
      </Card>

      <ConfirmDialog
        open={undoing}
        title="Undo this result?"
        danger
        confirmLabel="Yes, Undo It"
        body={<p>The result is cleared so you can enter the winning number again. Nothing has been saved yet.</p>}
        onClose={() => setUndoing(false)}
        onConfirm={async () => {
          if (await reverse("User undid the result")) setUndoing(false);
        }}
      />
    </ScreenFrame>
  );
}

/* ───────── Round Saved → another round? ───────── */
export function SavedScreen() {
  const session = useStore((s) => s.session);
  const rounds = useStore((s) => s.rounds);
  const { nextRound, finishSession } = useStore();
  const fmt = useFmt();
  const [finishing, setFinishing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  const last = rounds.filter((r) => r.roundStatus === "completed").sort((a, b) => b.roundNumber - a.roundNumber)[0];
  return (
    <ScreenFrame above={<SessionBar />} title="Round Saved" subtitle={last ? `Round ${last.roundNumber} is saved.` : undefined}>
      {last && (
        <Card className="flex items-center gap-4">
          {last.winningNumber !== null && <NumberBadge n={last.winningNumber} size="lg" />}
          <div>
            <div className="text-base text-muted">Round {last.roundNumber} result</div>
            <div className={clsx("text-2xl font-bold", last.netResult > 0 && "text-gain", last.netResult < 0 && "text-loss")}>
              {last.netResult > 0 ? "Profit" : last.netResult < 0 ? "Loss" : "No Profit or Loss"}
              {last.netResult !== 0 ? `: ${fmt(Math.abs(last.netResult))}` : ""}
            </div>
          </div>
        </Card>
      )}
      <AllRoundsCard t={allRoundsTotals(session, rounds)} title="Totals for All Rounds" />
      <h2 className="text-2xl font-bold">Do you want to play another round?</h2>
      <div className="space-y-3">
        <Button
          variant="primary"
          className="min-h-[72px] w-full text-2xl"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await nextRound();
            setBusy(false);
          }}
        >
          Yes, Next Round
        </Button>
        <Button className="min-h-[72px] w-full text-2xl" onClick={() => setFinishing(true)}>
          Finish Session
        </Button>
      </div>
      <ConfirmDialog
        open={finishing}
        title="Finish this session?"
        confirmLabel="Yes, Finish"
        body={<p>You will see a summary. All your saved rounds stay on this phone.</p>}
        onClose={() => setFinishing(false)}
        onConfirm={async () => {
          await finishSession();
          setFinishing(false);
        }}
      />
    </ScreenFrame>
  );
}

/* ───────── Final summary ───────── */
export function FinishScreen() {
  const session = useStore((s) => s.session);
  const rounds = useStore((s) => s.rounds);
  const { leaveSession } = useStore();
  const fmt = useFmt();
  if (!session) return null;
  const done = rounds.filter((r) => r.roundStatus === "completed").sort((a, b) => a.roundNumber - b.roundNumber);
  const bet = done.reduce((s, r) => s + r.totalBet, 0);
  const net = totalProfitLoss(session, rounds);
  const t = inventoryTotals(session.inventory);
  return (
    <ScreenFrame title="Session Finished" subtitle="Here is your summary." primaryLabel="Back to Start" onPrimary={leaveSession}>
      <Card>
        <Row label="Rounds Played" value={done.length} />
        <Row label="Total Money Bet" value={fmt(bet)} />
        <Row label="Total Profit or Loss" value={fmt(net, true)} strong tone={net > 0 ? "good" : net < 0 ? "bad" : undefined} />
        <div className="mt-2 border-t border-line pt-2">
          <Row label="Money Started With" value={fmt(session.startingMoney)} />
          <Row label="Additional Money Added" value={fmt(totalAdded(session))} />
          <Row label="Money at the End" value={fmt(sessionBalance(session, rounds))} strong />
        </div>
        <div className="mt-2 border-t border-line pt-2">
          <Row label="Chips I Have" value={plural(t.totalChips, "chip")} />
          <Row label="Chip Value" value={fmt(t.totalValue)} />
        </div>
      </Card>
      {done.length > 0 && (
        <section className="space-y-2" aria-label="Rounds played">
          <h2 className="text-2xl font-bold">Rounds</h2>
          {done.map((r) => (
            <Card key={r.id} className="flex items-center justify-between gap-3 p-3">
              <span className="text-lg font-bold">Round {r.roundNumber}</span>
              {r.winningNumber !== null && <NumberBadge n={r.winningNumber} size="sm" />}
              <span className={clsx("tabular text-lg font-bold", r.netResult > 0 && "text-gain", r.netResult < 0 && "text-loss")}>{fmt(r.netResult, true)}</span>
            </Card>
          ))}
        </section>
      )}
    </ScreenFrame>
  );
}
