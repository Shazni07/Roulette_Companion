# Online storage (Supabase) and hosting (Vercel): set-up steps

The app always saves on the phone first, so it works with no internet. When someone signs in, every change is also copied to Supabase, and another phone can pick it up.

## 1. Supabase (once)

1. **Run the database file.** Supabase → **SQL Editor** → **New query**. Paste everything from `supabase/schema.sql` and click **Run**. It says "Success". (It is safe to run again.)
2. **Make sign-up easy.** Supabase → **Authentication** → **Sign In / Providers** → **Email**. Turn **Confirm email** OFF and save. Otherwise every new account must first open an email, and Supabase's free email sender allows only a few per hour.
3. **Site address (after the Vercel link exists).** Supabase → **Authentication** → **URL Configuration**. Put the Vercel address (for example `https://roulette-companion.vercel.app`) in **Site URL**. This only matters if "Confirm email" is turned back on.

## 2. Local run

`.env.local` already holds the project URL and the anon (publishable) key. It is ignored by Git, so it never goes to GitHub. On another computer copy `.env.example` to `.env.local` and fill in the two values.

```
npm install
npm run dev
```

On the home screen: **Sign In or Create Account**.

## 3. Vercel

1. Push the code to GitHub (by hand).
2. vercel.com → **Add New → Project** → pick the repository → **Import**.
3. Before clicking Deploy, open **Environment Variables** and add these two (same values as `.env.local`):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | the Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon / publishable key |

4. Click **Deploy**. If the variables are added later, open **Deployments → Redeploy**, because the values are built into the app.

Never put the `service_role` / secret key or the database password anywhere in this project.

## How the saving works

- Each saved change is written on the phone and added to a small waiting list. About 1.5 seconds later (or when the internet comes back) the list is sent to Supabase.
- When the app opens, comes back to the front, or **Save Online Now** is tapped, newer data from Supabase is also brought onto the phone.
- If the same record was changed on two phones, the newest one wins. The database enforces this too (`keep_newest` in the SQL file).
- Deleting a session removes it online and on the other phones.
- The first time someone signs in on a phone, the sessions already on that phone are uploaded.
- Signing in as a different account on the same phone clears the phone's saved data first, because it belongs to the other account. Signing out waits until everything is uploaded (or asks first).
- Row Level Security: each account can read and change only its own rows. Without signing in the database returns nothing.

## Tables

`sessions`, `rounds`, `transactions`: one row per record with a JSON `data` column, `updated_at` (milliseconds) and the owner `user_id`. Sessions also have `deleted`.
