"use client";

import clsx from "clsx";
import { ChevronDown, Undo2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { BULK_TYPES, roundProblems, type BulkType } from "@/lib/roulette/betting";
import { buildHistoryIndex, type ChipCount, type HistoryIndex, type PositionHistory } from "@/lib/roulette/history";
import { insideGroups, outsidePositions } from "@/lib/roulette/rules";
import type { BetPosition, Position, Round, Session } from "@/lib/roulette/types";
import { AddChipsSheet } from "@/components/AddChipsSheet";
import { LimitBanner } from "@/components/LimitBanner";
import { ScreenFrame } from "@/components/ScreenFrame";
import { Alert, Button, NumberBadge, NumberList, QtyStepper, plural, useFmt } from "@/components/ui";
import { resultIfNumberWins } from "@/lib/roulette/settlement";
import { useStore } from "@/lib/state/store";

/* ───────── Screens Six, Seven: Inside Bets, Outside Bets, chips ───────── */
export function BetsScreen() {
  const session = useStore((s) => s.session);
  const round = useStore((s) => s.currentRound());
  const rounds = useStore((s) => s.rounds);
  const outsideVisible = useStore((s) => s.outsideVisible);
  const { go, toggleOutside, undo } = useStore();
  const canUndo = useStore((s) => s.undoStack.length > 0 && s.undoStack[s.undoStack.length - 1]!.roundId === round?.id);
  const [addOpen, setAddOpen] = useState(false);
  // which numbers are unfolded; each new round starts again with only the first number open
  const [unfolded, setUnfolded] = useState<{ roundId: string; numbers: number[] } | null>(null);

  const history = useMemo(() => buildHistoryIndex(rounds, round?.roundNumber ?? 1), [rounds, round?.roundNumber]);
  if (!session || !round) return null;

  const groups = insideGroups(session.ruleset, round.selectedMainNumbers);
  const openNumbers = unfolded?.roundId === round.id ? unfolded.numbers : groups.slice(0, 1).map((g) => g.number);
  const toggleFold = (n: number) => setUnfolded({ roundId: round.id, numbers: openNumbers.includes(n) ? openNumbers.filter((x) => x !== n) : [...openNumbers, n] });
  const outside = outsidePositions(session.ruleset);
  const hiddenOutside = round.bets.filter((b) => b.category === "outside");
  const problems = roundProblems(round.bets);
  // last round's bets that can be raised in one go: only the ones shown for the current main numbers
  const previous = rounds
    .filter((r) => r.roundStatus === "completed" && r.roundNumber < round.roundNumber)
    .sort((a, b) => b.roundNumber - a.roundNumber)[0];
  const shownKeys = new Set(groups.flatMap((g) => g.positions.map((p) => p.key)));
  const lastRound: Record<BulkType, BetPosition[]> = { straight: [], split: [], corner: [], street: [], sixLine: [] };
  for (const b of previous?.bets ?? []) {
    if ((BULK_TYPES as readonly string[]).includes(b.betType) && shownKeys.has(b.key)) lastRound[b.betType as BulkType].push(b);
  }
  const canAddChips = BULK_TYPES.some((t) => lastRound[t].length > 0);

  return (
    <ScreenFrame
      title="Choose Your Bets"
      hideHeading
      onBack={() => go("numbers")}
      primaryLabel="Review My Bets"
      primaryDisabled={problems.length > 0}
      onPrimary={() => go("review")}
    >
      {round.bets.some((b) => b.validationStatus === "invalid") && (
        <Alert tone="bad">
          <p className="font-bold">Please fix this first:</p>
          <ul className="list-inside list-disc">
            {round.bets
              .filter((b) => b.validationStatus === "invalid")
              .slice(0, 3)
              .map((b) => (
                <li key={b.id}>
                  {b.label}: {b.validationMessage}
                </li>
              ))}
          </ul>
        </Alert>
      )}

      <LimitBanner />

      <Button className="w-full" disabled={!canUndo} onClick={() => void undo()}>
        <Undo2 aria-hidden size={22} /> Undo Last Chip Change
      </Button>

      {canAddChips && (
        <>
          <Button variant="primary" className="min-h-[64px] w-full text-xl" onClick={() => setAddOpen(true)}>
            Add Chips to Last Round&apos;s Bets
          </Button>
          <AddChipsSheet open={addOpen} onClose={() => setAddOpen(false)} lastRound={lastRound} />
        </>
      )}

      <section aria-label="Inside Bets" className="space-y-5">
        <h2 className="text-2xl font-bold">Inside Bets</h2>
        {groups.map((g) => (
          <NumberFold key={g.number} number={g.number} positions={g.positions} bets={round.bets} open={openNumbers.includes(g.number)} onToggle={() => toggleFold(g.number)}>
            {g.positions.map((p) => (
              <BetCard key={`${g.number}-${p.key}`} position={p} round={round} session={session} history={history} />
            ))}
          </NumberFold>
        ))}
      </section>

      <section aria-label="Outside Bets" className="space-y-3">
        <Button
          aria-pressed={outsideVisible}
          variant={outsideVisible ? "primary" : "secondary"}
          className="min-h-[64px] w-full text-xl"
          onClick={toggleOutside}
        >
          {outsideVisible ? "Hide Outside Bets" : "Show Outside Bets"}
        </Button>
        {!outsideVisible && hiddenOutside.length > 0 && (
          <Alert tone="info">
            You have {plural(hiddenOutside.length, "outside bet")} in this round ({hiddenOutside.map((b) => b.label.replace(/ \(.*\)/, "")).join(", ")}). They are hidden but still count. Tap Show Outside Bets to see them.
          </Alert>
        )}
        {outsideVisible && (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold">Outside Bets</h2>
            {outside.map((p) => (
              <BetCard key={p.key} position={p} round={round} session={session} history={history} />
            ))}
          </div>
        )}
      </section>
    </ScreenFrame>
  );
}

/** One main number with its split, street, corner and other places. Tap the header to open or close them. */
function NumberFold({
  number,
  positions,
  bets,
  open,
  onToggle,
  children,
}: {
  number: number;
  positions: Position[];
  bets: BetPosition[];
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const fmt = useFmt();
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const keys = new Set(positions.map((p) => p.key));
  const placed = bets.filter((b) => keys.has(b.key) && b.chipCount > 0);
  const chips = placed.reduce((sum, b) => sum + b.chipCount, 0);
  const money = placed.reduce((sum, b) => sum + b.stake, 0);
  const toggle = () => {
    const closing = open;
    onToggle();
    // closing from far down the list: bring this number's bar back into view so the page does not jump somewhere else
    if (closing) {
      requestAnimationFrame(() => {
        const el = wrap.current;
        if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ block: "start" });
      });
    }
  };
  return (
    <div ref={wrap} className="space-y-3">
      {/* while this number is open its bar stays at the top of the screen, so it can be folded without scrolling back up */}
      <div
        data-sticky={open ? "true" : undefined}
        className={clsx(open && "sticky z-30 -mx-4 bg-bg px-4 py-2 shadow-[0_8px_10px_-8px_rgba(0,0,0,0.7)]")}
        style={open ? { top: "env(safe-area-inset-top, 0px)" } : undefined}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-line bg-surface px-3 text-left active:scale-[0.99]"
        >
          <NumberBadge n={number} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block text-xl font-bold">Bets with {number}</span>
            <span className="block text-base text-muted">{placed.length > 0 ? `${plural(placed.length, "place")} · ${plural(chips, "chip")} · ${fmt(money)}` : "No chips yet"}</span>
          </span>
          <ChevronDown aria-hidden size={28} className={clsx("shrink-0 text-muted transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div id={id} role="region" aria-label={`Bets with ${number}`} className="space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

function CountBox({ title, sub, count, rows }: { title: string; sub: string; count: ChipCount; rows: number[] }) {
  const fmt = useFmt();
  return (
    <div className="rounded-xl bg-surface2 p-3 text-base">
      <div className="font-bold leading-tight">{title}</div>
      <div className="mb-1 text-sm text-muted">{sub}</div>
      {rows.map((v) => (
        <div key={v} className="tabular flex justify-between gap-1">
          <span className="text-muted">{fmt(v)}</span>
          <span>{count.byValue[v] ?? 0}</span>
        </div>
      ))}
      <div className="tabular mt-1 flex justify-between border-t border-line pt-1 font-bold">
        <span>Total</span>
        <span>{plural(count.chips, "chip")}</span>
      </div>
    </div>
  );
}

/**
 * One betting position. The same position always shows the same state wherever
 * it appears (e.g. split 7/8 under main number 7 and under 8).
 */
export function BetCard({ position, round, session, history }: { position: Position; round: Round; session: Session; history: HistoryIndex }) {
  const bet = round.bets.find((b) => b.key === position.key);
  const { adjustChips, removeBet } = useStore();
  const fmt = useFmt();
  const [open, setOpen] = useState(!!bet);

  const h: PositionHistory = history.get(position.key);
  const hasHistory = history.earlierRoundNumbers.length > 0;
  const current = bet?.chipCount ?? 0;
  const payout = session.ruleset.payoutRatios[position.type];
  const rows = [...new Set([...session.inventory.map((d) => d.value), ...Object.keys(h.cumulative.byValue).map(Number)])].sort((a, b) => a - b);
  const prevLabel = h.previousRoundNumber === null ? "none" : `Round ${h.previousRoundNumber}`;
  const selected = current > 0;
  const isStraight = position.type === "straight";
  // net result of the whole round if this straight's number comes up: companions win, other bets lose
  const scenario = isStraight ? resultIfNumberWins(round.bets, position.numbers[0]!) : null;
  // inside bets read "Split: 7 / 8"; outside bets already have a clear name ("Red", "First 12 (1 to 12)")
  const name = position.category === "inside" ? `${position.typeLabel}: ${position.label}` : position.label;

  return (
    <div className={clsx("rounded-2xl border-2 p-4", selected ? "border-gain bg-surface" : "border-line bg-surface")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xl font-bold">{name}</h4>
          <div className="text-base text-muted">Pays {payout} to 1</div>
          {isStraight && selected && <span className="mt-1 inline-block rounded-full bg-gain/15 px-3 py-0.5 text-base font-bold text-gain">Selected</span>}
        </div>
        {isStraight && scenario ? (
          <div className="shrink-0 text-right" aria-label={`If ${position.label} comes up: ${scenario.net >= 0 ? "you win" : "you lose"} ${fmt(Math.abs(scenario.net))}`}>
            <div className="text-sm leading-tight text-muted">If {position.label} Comes Up</div>
            <div className={clsx("tabular text-xl font-bold leading-tight", scenario.net > 0 && "text-gain", scenario.net < 0 && "text-loss")}>
              {scenario.net > 0 ? `Win ${fmt(scenario.net)}` : scenario.net < 0 ? `Lose ${fmt(-scenario.net)}` : fmt(0)}
            </div>
          </div>
        ) : (
          selected && <span className="shrink-0 rounded-full bg-gain/15 px-3 py-1 text-base font-bold text-gain">Selected</span>
        )}
      </div>

      {position.numbers.length <= 12 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-base">
          <span className="text-muted">Covers:</span>
          <NumberList numbers={position.numbers} highlight={round.selectedMainNumbers} />
        </div>
      ) : (
        <div className="mt-2 text-base text-muted">Covers {position.numbers.length} numbers</div>
      )}

      {/* Four separate figures: previous round, all earlier rounds, this round, projected total */}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-base">
        {hasHistory && (
          <>
            <Figure label={`Previous Round (${prevLabel})`} value={plural(h.previous.chips, "chip")} />
          </>
        )}
        <Figure label={`This Round (Round ${round.roundNumber})`} value={plural(current, "chip")} strong />
        {!hasHistory && <Figure label="Money on This Bet" value={fmt(bet?.stake ?? 0)} />}
      </dl>

      {isStraight && scenario && (
        <div className="mt-3 rounded-xl border-2 border-gain/40 bg-gain/5 px-3 py-2 text-base">
          {round.bets.length > 0 && (
            <div className="tabular space-y-0.5 border-b border-line pb-2">
              <div className="flex justify-between gap-2">
                <span className="text-muted">Won on bets that cover {position.label}</span>
                <b className="text-gain">{fmt(scenario.won)}</b>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted">Lost on the other bets</span>
                <b className="text-loss">{fmt(-scenario.lost)}</b>
              </div>
            </div>
          )}
          <ul className="space-y-0.5 pt-2">
            {session.inventory.map((d) => (
              <li key={d.id} className="tabular flex justify-between gap-2">
                <span className="text-muted">Each {fmt(d.value)} chip wins</span>
                <b>{fmt(d.value * payout)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!open && bet?.validationStatus === "invalid" && (
        <div className="mt-3">
          <Alert tone="bad">{bet.validationMessage}</Alert>
        </div>
      )}
      <Button className="mt-3 w-full" variant={selected ? "secondary" : "primary"} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Close" : selected ? "Change Chips" : "Place Chips"}
      </Button>

      {open && (
        <div className="mt-4 space-y-4">
          {hasHistory && (
            <div className="grid grid-cols-1 gap-2">
              <CountBox title="Previous Round" sub={prevLabel} count={h.previous} rows={rows} />
            </div>
          )}

          <div>
            <div className="mb-2 text-lg font-bold">Chips to Place Now</div>
            <ul className="space-y-3">
              {session.inventory.map((d) => {
                const qty = bet?.allocations.find((a) => a.denominationId === d.id)?.quantity ?? 0;
                return (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <div>
                      <div className="tabular text-xl font-bold">{fmt(d.value)}</div>
                      <div className="text-base text-muted">{d.availableCount} left</div>
                    </div>
                    <QtyStepper label={`${fmt(d.value)} chips on ${name}`} value={qty} max={qty + d.availableCount} onChange={(n) => void adjustChips(position.key, d.id, n - qty)} />
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-xl bg-surface2 p-3 text-lg">
            <div className="flex justify-between">
              <span className="text-muted">Chips on this bet</span>
              <b className="tabular">{current}</b>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Money on this bet</span>
              <b className="tabular">{fmt(bet?.stake ?? 0)}</b>
            </div>
          </div>

          {bet?.validationStatus === "invalid" && <Alert tone="bad">{bet.validationMessage}</Alert>}
          {selected && (
            <Button variant="danger" className="w-full" onClick={() => void removeBet(bet!.id)}>
              Take All Chips Off This Bet
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, strong, wide }: { label: string; value: React.ReactNode; strong?: boolean; wide?: boolean }) {
  return (
    <div className={clsx("rounded-xl bg-surface2 px-3 py-2", wide && "col-span-2")}>
      <dt className="text-sm leading-tight text-muted">{label}</dt>
      <dd className={clsx("tabular text-xl", strong ? "font-bold" : "font-semibold")}>{value}</dd>
    </div>
  );
}
