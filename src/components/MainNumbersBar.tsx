"use client";

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { ALL_NUMBERS } from "@/lib/roulette/rules";
import { Button, NumberGrid, NumberList, plural } from "./ui";

/**
 * Main Numbers as a bar: tap it to open the number grid, tap it again to shrink
 * it. When it is shrunk the chosen numbers stay visible on the bar.
 */
export function MainNumbersBar({
  selected,
  onToggle,
  onSetAll,
  defaultOpen = false,
  title = "Main Numbers",
}: {
  selected: number[];
  onToggle: (n: number) => void;
  /** replaces the whole selection (Select All / Clear Selection) */
  onSetAll: (numbers: number[]) => void;
  defaultOpen?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-2xl border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="main-numbers-panel"
        onClick={() => setOpen(!open)}
        className="flex min-h-[64px] w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-bold">{title}</span>
          <span className="block text-base text-muted">{plural(selected.length, "number")} selected</span>
          {!open && selected.length > 0 && (
            <span className="mt-2 block">
              <NumberList numbers={selected} />
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-base font-semibold text-muted">
          {open ? "Close" : "Open"}
          <ChevronDown aria-hidden size={24} className={clsx("transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div id="main-numbers-panel" className="border-t border-line p-4">
          <NumberGrid selected={selected} onToggle={onToggle} label="Main numbers" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button onClick={() => onSetAll([...ALL_NUMBERS])}>Select All</Button>
            <Button disabled={selected.length === 0} onClick={() => onSetAll([])}>
              Clear Selection
            </Button>
          </div>
          {selected.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-lg font-semibold">My Main Numbers</div>
              <NumberList numbers={selected} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
