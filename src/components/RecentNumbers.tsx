"use client";

import { recentWinningNumbers } from "@/lib/roulette/report";
import { useStore } from "@/lib/state/store";
import { Card, NumberBadge } from "./ui";

/** The last winning numbers of this session, newest first. Shown only when there is at least one. */
export function RecentNumbers() {
  const rounds = useStore((s) => s.rounds);
  const numbers = recentWinningNumbers(rounds, 10);
  if (numbers.length === 0) return null;
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-bold">Last Winning Numbers</h2>
      <ul className="flex flex-wrap gap-2" aria-label="Last winning numbers, newest first">
        {numbers.map((n, i) => (
          <li key={i}>
            <NumberBadge n={n} size="md" />
          </li>
        ))}
      </ul>
      <p className="text-base text-muted">Newest first.</p>
    </Card>
  );
}
