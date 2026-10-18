"use client";

import clsx from "clsx";
import { Minus, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { formatMoney, minorToInput, parseMoney } from "@/lib/roulette/money";
import { colourOf, gridNumber } from "@/lib/roulette/rules";
import type { Colour } from "@/lib/roulette/types";
import { useStore } from "@/lib/state/store";

export function useFmt() {
  const currency = useStore((s) => s.session?.currency ?? "LKR");
  return (minor: number, signed = false) => formatMoney(minor, currency, { sign: signed });
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx("rounded-2xl border border-line bg-surface p-4", className)}>{children}</section>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "warn" }) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center rounded-full px-3 py-1 text-base font-bold",
        tone === "neutral" && "bg-surface2 text-muted",
        tone === "good" && "bg-gain/15 text-gain",
        tone === "bad" && "bg-loss/15 text-loss",
        tone === "warn" && "bg-warn/15 text-warn",
      )}
    >
      {children}
    </span>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-xl font-bold">{children}</h2>;
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
export function Button({ variant = "secondary", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl px-5 text-lg font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "bg-felt text-white",
        variant === "secondary" && "border-2 border-line bg-surface2 text-fg",
        variant === "danger" && "border-2 border-loss/60 bg-loss/10 text-loss",
        variant === "ghost" && "text-muted underline",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Alert({ tone = "warn", children }: { tone?: "warn" | "bad" | "good" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={clsx(
        "rounded-2xl border-2 px-4 py-3 text-base",
        tone === "warn" && "border-warn/50 bg-warn/10 text-warn",
        tone === "bad" && "border-loss/50 bg-loss/10 text-loss",
        tone === "good" && "border-gain/50 bg-gain/10 text-gain",
        tone === "info" && "border-line bg-surface2 text-fg",
      )}
    >
      {children}
    </div>
  );
}

export function Row({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: "good" | "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-muted">{label}</span>
      <span className={clsx("tabular text-right", strong && "text-xl font-bold", tone === "good" && "text-gain", tone === "bad" && "text-loss")}>{value}</span>
    </div>
  );
}

const COLOUR_CLASS: Record<Colour, string> = {
  red: "bg-roulRed text-white",
  black: "bg-roulBlack text-white ring-1 ring-line",
  green: "bg-felt text-white",
};

export function NumberBadge({ n, size = "md" }: { n: number; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      aria-label={`${n} ${colourOf(n)}`}
      className={clsx(
        "tabular inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        COLOUR_CLASS[colourOf(n)],
        size === "sm" && "h-8 min-w-8 px-1 text-base",
        size === "md" && "h-10 min-w-10 px-1 text-lg",
        size === "lg" && "h-20 min-w-20 px-2 text-4xl",
      )}
    >
      {n}
    </span>
  );
}

export function NumberList({ numbers, highlight }: { numbers: number[]; highlight?: number[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {numbers.map((n) => (
        <span key={n} className={clsx("rounded-full", highlight?.includes(n) && "ring-2 ring-gain ring-offset-1 ring-offset-surface")}>
          <NumberBadge n={n} size="sm" />
        </span>
      ))}
    </span>
  );
}

/** [ − ] 3 [ + ] with 56 px buttons. */
export function QtyStepper({ value, onChange, max, label }: { value: number; onChange: (n: number) => void; max?: number; label: string }) {
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
        className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-line bg-surface2 disabled:opacity-30 active:scale-95"
      >
        <Minus size={26} />
      </button>
      <span aria-live="polite" className="tabular w-12 text-center text-3xl font-bold">
        {value}
      </span>
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(value + 1)}
        className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-line bg-surface2 disabled:opacity-30 active:scale-95"
      >
        <Plus size={26} />
      </button>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-lg font-semibold">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="text-base text-loss">
          {error}
        </p>
      ) : hint ? (
        <p className="text-base text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const inputCls = "h-16 w-full rounded-2xl border-2 border-line bg-bg px-4 text-2xl text-fg placeholder:text-muted/60";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />;
}

/** Money input: edits text and reports integer minor units (null when empty/invalid). */
export function MoneyInput({ id, value, onChange, placeholder, ariaLabel }: { id?: string; value: number | null; onChange: (minor: number | null) => void; placeholder?: string; ariaLabel?: string }) {
  const [text, setText] = useState(value === null ? "" : minorToInput(value));
  const last = useRef(value);
  useEffect(() => {
    if (last.current !== value) {
      last.current = value;
      setText(value === null ? "" : minorToInput(value));
    }
  }, [value]);
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const m = t.trim() === "" ? null : parseMoney(t);
        last.current = m;
        onChange(m);
      }}
      className={inputCls}
    />
  );
}

export function IntInput({ id, value, onChange, ariaLabel }: { id?: string; value: number | null; onChange: (n: number | null) => void; ariaLabel?: string }) {
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      inputMode="numeric"
      value={value === null ? "" : String(value)}
      onChange={(e) => {
        const t = e.target.value.trim();
        if (t === "") return onChange(null);
        if (!/^\d+$/.test(t)) return;
        onChange(Number(t));
      }}
      className={inputCls}
    />
  );
}

/** Roulette number grid: 0 on top, then 12 rows of 3. Large, high-contrast buttons. */
export function NumberGrid({ selected, onToggle, label }: { selected: number[]; onToggle: (n: number) => void; label: string }) {
  const set = new Set(selected);
  const cell = (n: number) => {
    const c = colourOf(n);
    const on = set.has(n);
    return (
      <button
        key={n}
        type="button"
        aria-pressed={on}
        aria-label={`${n} ${c}${on ? ", selected" : ""}`}
        onClick={() => onToggle(n)}
        className={clsx(
          "tabular relative flex h-14 w-full items-center justify-center rounded-xl text-2xl font-bold text-white transition active:scale-95",
          c === "red" && "bg-roulRed",
          c === "black" && "bg-roulBlack",
          c === "green" && "bg-felt",
          on ? "ring-4 ring-gain ring-offset-2 ring-offset-bg" : "opacity-85",
        )}
      >
        {n}
        {on ? (
          <span aria-hidden className="absolute right-1.5 top-0.5 text-sm leading-none">
            ✓
          </span>
        ) : null}
      </button>
    );
  };
  return (
    <div role="group" aria-label={label} className="mx-auto w-full max-w-sm space-y-2">
      {cell(0)}
      <div className="grid grid-cols-3 gap-2">{Array.from({ length: 12 }, (_, i) => i + 1).flatMap((r) => [1, 2, 3].map((c) => cell(gridNumber(r, c))))}</div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="sheet-in safe-bottom max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-line">
            <X size={26} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "No, Go Back",
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-3 text-lg">{body}</div>
      <div className="mt-5 space-y-3">
        <Button
          variant={danger ? "danger" : "primary"}
          className="w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
        <Button className="w-full" onClick={onClose}>
          {cancelLabel}
        </Button>
      </div>
    </Sheet>
  );
}
