-- Roulette Companion: online storage.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. It is safe to run twice.
--
-- Every row belongs to one signed-in user. Row Level Security makes sure a user can only
-- ever see or change their own rows. Signed-out visitors (the anon key alone) get nothing.

create table if not exists public.sessions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (user_id, id)
);

create table if not exists public.rounds (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  session_id text not null,
  data jsonb not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

create table if not exists public.transactions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  session_id text not null,
  data jsonb not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

create index if not exists rounds_by_session on public.rounds (user_id, session_id);
create index if not exists transactions_by_session on public.transactions (user_id, session_id);

-- Last write wins: an older copy (for example from a phone that was offline) never overwrites a newer one.
create or replace function public.keep_newest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then
    return null; -- skip this update, keep the newer row
  end if;
  return new;
end;
$$;

drop trigger if exists keep_newest on public.sessions;
create trigger keep_newest before update on public.sessions for each row execute function public.keep_newest();
drop trigger if exists keep_newest on public.rounds;
create trigger keep_newest before update on public.rounds for each row execute function public.keep_newest();
drop trigger if exists keep_newest on public.transactions;
create trigger keep_newest before update on public.transactions for each row execute function public.keep_newest();

-- Security: each user sees only their own rows.
alter table public.sessions enable row level security;
alter table public.rounds enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "own rows" on public.sessions;
create policy "own rows" on public.sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own rows" on public.rounds;
create policy "own rows" on public.rounds for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own rows" on public.transactions;
create policy "own rows" on public.transactions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The anon key (no sign-in) has no access at all.
revoke all on public.sessions, public.rounds, public.transactions from anon;
