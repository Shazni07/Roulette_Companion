# Roulette Companion

A very simple, mobile-first helper for a British (single-zero) roulette session: money, chips, bets, result, and chip history across rounds.
It tracks and calculates. It does not predict results or advise bets.

## Run it

```bash
cd C:\Users\Asus\Desktop\Roulette
npm install        # first time only
npm run dev        # open http://localhost:3000
```

Other commands: `npm test` (Vitest) · `npm run typecheck` · `npm run lint` · `npm run build` then `npm start`.

Saved sessions live in the browser's IndexedDB (database `roulette-companion-v2`). No server, login or cloud is used.

## The journey (one purpose per screen)

Start Session → Start Your Session (money, currency LKR / INR / USD or one you add yourself with "+ Add Currency", one chip value (the number of chips is worked out from the money) and, if you like, the main numbers on one page) → Main Numbers (an open/close bar) → Choose Your Bets (inside bets; Outside Bets hidden until you tap *Show Outside Bets*) → Check Your Bets → Winning Number → Round Result (with *Chips I Have Now*) → Save Round → Yes, Next Round / Finish Session → Keep / Change / New numbers → repeat.

*Add Chips to Last Round's Bets* (Round 2 onward, on the bets page) sets every straight, split, corner, street and double street bet from last round to last round's chips plus extra chips you choose, in one tap. *Add More Money* and *Change My Chips* are on every round screen; *Change My Chips* is where extra chip values are added. There are no table limits in this version (the client works those out himself).

## Run a whole session from a file (7 rounds, or any number)

`scripts/seven-rounds.config.json` holds your plan: starting money, chip values, and for every round the **winning number** and the **bets with their chips**. Edit it, then run:

```bash
cd C:\Users\Asus\Desktop\Roulette
npm run simulate                      # uses scripts/seven-rounds.config.json
npm run simulate -- my-other-plan.json
```

It uses the app's real calculation code (the same rules, payouts, chips and totals as the screens), prints a round-by-round report and saves it to `reports/`. Amounts are normal numbers (500 means Rs. 500).

```json
{
  "currency": "LKR",
  "startingMoney": 500000,
  "chips": [{ "value": 500 }, { "value": 100, "count": 200 }],
  "mainNumbers": [6, 17, 20, 34],
  "rounds": [
    {
      "winningNumber": 5,
      "addMoney": 10000,
      "bets": [
        { "type": "straight", "numbers": [6], "chips": { "500": 2, "100": 3 } },
        { "type": "split", "numbers": [5, 6], "chips": { "500": 1 } },
        { "type": "red", "chips": { "500": 1 } },
        { "type": "dozen", "dozen": 1, "chips": { "100": 4 } }
      ]
    }
  ]
}
```

- `type` is one of `straight split street corner sixLine zeroTrio firstFour dozen low high red black odd even`. Inside bets need `numbers` (a real position on the table: split 5/7 is refused); `dozen` needs `"dozen": 1, 2 or 3`; the other outside bets need no numbers.
- Leave a chip's `count` out and it is worked out from the money left (money / chip value), as on the start page.
- `addMoney` (optional) adds money before that round; it does not add chips.
- `mainNumbers` per round is optional and only shown in the report.
- A mistake is explained in plain words with the round and bet, for example "Round 3, bet 2 (Straight: 6): you have no chips of value 250".

## Install on a phone and use offline (PWA)

- The app has a manifest, app icons (`public/icon-*.png`, `apple-touch-icon.png`) and an offline service worker (`public/sw.js`).
- On the home screen of a phone that has not installed it yet, a card explains how: an **Install App** button on Android, **Share → Add to Home Screen** on iPhone (Safari only).
- After the first visit it opens with no internet. A new version waits until the player taps **Update**, so a round is never interrupted.
- The service worker only runs in the production build (`npm run build`, then `npm start`) and only over `https://` or `localhost`. In `npm run dev` it is off on purpose.
- Rebuild the icons with `npm run icons` if the design in `scripts/make-icons.mjs` changes. When `public/sw.js` changes its behaviour, bump `VERSION` inside it.

## Comfort features

- **Undo Last Chip Change** on the bets screen (up to 30 steps in the current round; confirmed rounds cannot be changed this way).
- **Past Sessions** on the home screen: every finished session, with totals per currency and each round; share a summary or download a spreadsheet (CSV).
- **Settings** card on the home screen: text size (Normal or Large) and vibration (on phones that support it). Kept on the phone only.
- The screen stays on while a session is open (wake lock, where the phone supports it).
- **Stop limits** (optional) under the money bar: a calm reminder when total profit or loss reaches the chosen amount. It never blocks play.
- **Last Winning Numbers** on the numbers, winning-number and saved screens.
- **Share This Round** on the Round Saved screen (share menu, or copied text).
- **Forgot password** and a **Saved online** status line while playing (when signed in).

Code: `src/lib/roulette/report.ts` (messages, CSV, limits), `src/lib/prefs.ts`, `src/lib/wakeLock.ts`, `src/lib/share.ts`, `src/components/screens/History.tsx`, `SettingsCard.tsx`, `LimitBanner.tsx`, `RecentNumbers.tsx`, `ShareButtons.tsx`.

## Online storage (Supabase)

Optional sign-in saves sessions online and lets another phone open them. The phone stays the main copy: everything works offline and uploads when the internet is back. Steps (run the SQL file, Vercel variables): see [supabase/SETUP.md](supabase/SETUP.md). Without the two `NEXT_PUBLIC_SUPABASE_*` settings the sign-in card is simply hidden.

Code: `src/lib/sync/engine.ts` (push, pull, newest wins), `client.ts` (Supabase), `cloud.ts` (sign-in state), `src/components/CloudCard.tsx`, and the waiting list in `src/lib/state/db.ts`.

## Chip history on each bet card

Derived only from **saved** rounds:

| Figure | Meaning |
|---|---|
| Previous Round (Round N) | chips on the same position in the immediately preceding round only (0 if unused) |
| This Round | chips being entered now (starts at 0, never copied) |

The "All Earlier Rounds" and "Projected Total" figures were removed from the screen at the client's request. The earlier-rounds total is still worked out in `history.ts` but is not shown. Positions match by type + covered numbers (`src/lib/roulette/history.ts`).

## Source map

| Path | Purpose |
|---|---|
| `src/lib/roulette/rules.ts` | colours, betting grid, every legal position, canonical position keys |
| `src/lib/roulette/betting.ts` | chip allocation and validation (a position is one bet) |
| `src/lib/roulette/settlement.ts` | payouts (profit ratios; returned stake is not profit) |
| `src/lib/roulette/chips.ts` | chips lost / estimated winning chips |
| `src/lib/roulette/history.ts` | previous-round and cumulative chip counts |
| `src/lib/roulette/session.ts` | session, added money, chips held; money balance |
| `src/lib/roulette/rounds.ts` | round lifecycle, confirm, settle, save, clear draft |
| `src/lib/state/*` | IndexedDB (Dexie) and the Zustand store |
| `src/components/*` | screens and shared large-print controls |

All money is stored as integer minor units. Net = payout − total bet = gross winning profit − gross loss.
Money balance = starting money + added money + net of saved rounds; chip value is tracked separately, so nothing is counted twice.

## Not supported

La Partage, En Prison, column bets (not requested), American double-zero. A saved round cannot be edited afterwards; before saving, a result can be undone and confirmed bets can be reopened.
