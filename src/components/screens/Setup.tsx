"use client";

import { useState } from "react";
import { CloudCard } from "@/components/CloudCard";
import { MainNumbersBar } from "@/components/MainNumbersBar";
import { InstallCard } from "@/components/PwaParts";
import { ScreenFrame } from "@/components/ScreenFrame";
import { SettingsCard } from "@/components/SettingsCard";
import { Alert, Button, Card, ConfirmDialog, Field, MoneyInput, Sheet, TextInput, plural } from "@/components/ui";
import { inventoryTotals, suggestChipCount } from "@/lib/roulette/inventory";
import { allCurrencies, formatMoney, registerCurrency, removeCurrency, saveCurrencyList, validateNewCurrency } from "@/lib/roulette/money";
import { useStore } from "@/lib/state/store";
import type { Currency, Session } from "@/lib/roulette/types";

/* ───────── Screen One: Start Session ───────── */
export function HomeScreen() {
  const sessions = useStore((s) => s.sessions);
  const { openSession, go, deleteSession, openHistory } = useStore();
  const [deleting, setDeleting] = useState<Session | null>(null);
  // a session whose setup was never finished has no chips or rounds, so it is not offered
  const unfinished = sessions.filter((s) => s.sessionStatus !== "finished" && s.setupStep === "done").sort((a, b) => b.startedAt - a.startedAt);

  return (
    <div className="space-y-6 pt-6">
      <header className="text-center">
        <h1 className="text-4xl font-bold">Roulette Companion</h1>
        <p className="mt-2 text-xl text-muted">Manage your chips and track each round.</p>
      </header>

      {unfinished.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold">You have an unfinished session</h2>
          {unfinished.map((s) => (
            <SessionCard key={s.id} s={s} onContinue={() => openSession(s.id)} onDelete={() => setDeleting(s)} />
          ))}
        </div>
      )}

      <Button variant={unfinished.length ? "secondary" : "primary"} className="min-h-[72px] w-full text-2xl" onClick={() => go("setup")}>
        {unfinished.length ? "Start a New Session" : "Start Session"}
      </Button>
      {unfinished.length > 0 && <p className="text-center text-base text-muted">Starting a new session keeps your other session safe.</p>}

      {sessions.some((s) => s.sessionStatus === "finished") && (
        <Button className="w-full" onClick={() => void openHistory()}>
          Past Sessions
        </Button>
      )}

      <CloudCard />

      <InstallCard />

      <SettingsCard />

      <ConfirmDialog
        open={!!deleting}
        title="Delete this session?"
        danger
        confirmLabel="Yes, Delete It Forever"
        body={<p>All the rounds of this session will be removed from this phone. This cannot be undone.</p>}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteSession(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function SessionCard({ s, onContinue, onDelete }: { s: Session; onContinue: () => void; onDelete: () => void }) {
  const t = inventoryTotals(s.inventory);
  return (
    <Card className="space-y-3">
      <div>
        <div className="text-xl font-bold">Started {new Date(s.startedAt).toLocaleDateString()}</div>
        <div className="text-lg text-muted">
          {plural(s.totalRounds, "round")} played · {plural(t.totalChips, "chip")} · started with {formatMoney(s.startingMoney, s.currency)}
        </div>
      </div>
      <Button variant="primary" className="w-full" onClick={onContinue}>
        Continue Session
      </Button>
      <button className="min-h-[44px] w-full text-base text-muted underline" onClick={onDelete}>
        Delete this session
      </button>
    </Card>
  );
}

/* ───────── Screen Two: money, currency and chips on ONE page ───────── */
export function StartScreen() {
  const { startSession, go } = useStore();
  const [currency, setCurrency] = useState<Currency>("LKR");
  const [currencies, setCurrencies] = useState(allCurrencies);
  const [adding, setAdding] = useState(false);
  const [removingCurrency, setRemovingCurrency] = useState<string | null>(null);
  const [mainNumbers, setMainNumbers] = useState<number[]>([]);
  const [money, setMoney] = useState<number | null>(null);
  const [chipValue, setChipValue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const fmt = (minor: number) => formatMoney(minor, currency);
  // one chip value: the number of chips is the money divided by the value (whole chips only)
  const chipCount = money && chipValue ? suggestChipCount(money, chipValue) : 0;
  const leftOver = money && chipValue ? money - chipCount * chipValue : 0;
  const ready = !!money && money > 0 && !!chipValue && chipCount > 0;

  return (
    <ScreenFrame
      title="Start Your Session"
      subtitle="Enter your money, choose the currency, type your chip value, and pick your main numbers."
      onBack={() => go("home")}
      primaryLabel={busy ? "Starting…" : "Continue"}
      primaryDisabled={!ready || busy}
      onPrimary={async () => {
        setBusy(true);
        await startSession({ currency, startingMoney: money!, chips: [{ value: chipValue!, count: chipCount }], mainNumbers });
        setBusy(false);
      }}
    >
      <Card className="space-y-4">
        <Field label="Money to Play">{(id) => <MoneyInput id={id} value={money} onChange={setMoney} placeholder="0" />}</Field>
        <div>
          <div className="mb-2 text-lg font-semibold">Currency</div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Currency">
            {currencies.map((c) => (
              <div key={c.code} className="relative">
                <button
                  role="radio"
                  aria-checked={currency === c.code}
                  onClick={() => setCurrency(c.code)}
                  className={`min-h-[56px] w-full rounded-2xl border-2 text-lg font-bold ${currency === c.code ? "border-gain bg-gain/10 text-gain" : "border-line bg-surface2"}`}
                >
                  {c.code}
                </button>
                {currencies.length > 1 && (
                  <button
                    aria-label={`Remove ${c.code}`}
                    onClick={() => setRemovingCurrency(c.code)}
                    className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-line bg-surface text-lg font-bold text-muted"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button className="mt-3 w-full" onClick={() => setAdding(true)}>
            + Add Currency
          </Button>
          <p className="mt-2 text-base text-muted">Amounts are never converted between currencies.</p>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-2xl font-bold">My Chips</h2>
        <Field label="Chip value" hint="For example 100 or 500. We work out how many chips your money makes.">
          {(id) => <MoneyInput id={id} value={chipValue} onChange={setChipValue} />}
        </Field>
        {money && chipValue ? (
          chipCount > 0 ? (
            <div className="rounded-xl bg-surface2 p-3" aria-live="polite">
              <div className="text-base text-muted">Number of chips</div>
              <div className="tabular text-3xl font-bold">{chipCount}</div>
              <div className="tabular text-base text-muted">
                {plural(chipCount, "chip")} of {fmt(chipValue)} = {fmt(chipCount * chipValue)}
              </div>
              {leftOver > 0 && <div className="tabular mt-1 text-base text-muted">{fmt(leftOver)} is left over: not enough for one more chip.</div>}
            </div>
          ) : (
            <Alert tone="warn">Your money is less than one chip of {fmt(chipValue)}. Type a smaller chip value.</Alert>
          )
        ) : null}
        <p className="text-base text-muted">Other chip values can be added later with Change My Chips.</p>
      </Card>

      <MainNumbersBar
        selected={mainNumbers}
        onToggle={(n) => setMainNumbers((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b)))}
        onSetAll={setMainNumbers}
      />

      <ConfirmDialog
        open={!!removingCurrency}
        title={`Remove ${removingCurrency ?? ""}?`}
        danger
        confirmLabel="Yes, Remove"
        body={<p>{removingCurrency} is taken off this list. Sessions that already use it are not changed. You can add it again with Add Currency.</p>}
        onClose={() => setRemovingCurrency(null)}
        onConfirm={() => {
          if (removingCurrency && removeCurrency(removingCurrency)) {
            saveCurrencyList();
            const left = allCurrencies();
            setCurrencies(left);
            if (currency === removingCurrency) setCurrency(left[0]!.code);
          }
          setRemovingCurrency(null);
        }}
      />

      <AddCurrencySheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(info) => {
          registerCurrency(info);
          saveCurrencyList();
          setCurrencies(allCurrencies());
          setCurrency(info.code);
          setAdding(false);
        }}
      />
    </ScreenFrame>
  );
}

function AddCurrencySheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (info: { code: string; symbol: string; name: string }) => void }) {
  const [code, setCode] = useState("");
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setCode("");
    setSymbol("");
    setError(null);
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title="Add Currency">
      <div className="space-y-4">
        <Field label="Currency code" hint="2 to 5 letters, for example EUR or GBP">
          {(id) => <TextInput id={id} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" maxLength={5} />}
        </Field>
        <Field label="Symbol (optional)" hint="For example € or £. If you leave it empty the code is shown.">
          {(id) => <TextInput id={id} value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={4} />}
        </Field>
        {error && (
          <p role="alert" className="text-lg text-loss">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          className="w-full"
          disabled={code.trim().length < 2}
          onClick={() => {
            const r = validateNewCurrency(code, symbol);
            if (!r.ok) return setError(r.error);
            onAdd(r.info);
            setCode("");
            setSymbol("");
            setError(null);
          }}
        >
          Add This Currency
        </Button>
      </div>
    </Sheet>
  );
}
