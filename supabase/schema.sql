-- 犯人は踊る Family / Supabase initial schema
-- Run this entire file once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{4}$'),
  host_user_id uuid not null,
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  game_id uuid null,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 20),
  seat integer not null check (seat between 0 and 7),
  joined_at timestamptz not null default now(),
  unique(room_id, user_id),
  unique(room_id, seat)
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.rooms(id) on delete cascade,
  status text not null default 'playing' check (status in ('playing','finished')),
  current_turn_player_id uuid null references public.players(id) on delete set null,
  round_no integer not null default 1,
  created_at timestamptz not null default now()
);

alter table public.rooms
  drop constraint if exists rooms_game_id_fkey;
alter table public.rooms
  add constraint rooms_game_id_fkey foreign key (game_id) references public.games(id) on delete set null;

create table if not exists public.hands (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  card_id text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(game_id, card_id)
);

create index if not exists idx_players_room on public.players(room_id);
create index if not exists idx_hands_game_player on public.hands(game_id, player_id);

-- Membership helpers are SECURITY DEFINER to avoid recursive RLS policies.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.players p
    where p.room_id = p_room_id and p.user_id = auth.uid()
  );
$$;

create or replace function public.is_hand_owner(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.players p
    where p.id = p_player_id and p.user_id = auth.uid()
  );
$$;

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.hands enable row level security;

-- Clean re-runs.
drop policy if exists rooms_member_select on public.rooms;
drop policy if exists players_member_select on public.players;
drop policy if exists games_member_select on public.games;
drop policy if exists hands_owner_select on public.hands;

create policy rooms_member_select on public.rooms
for select to authenticated
using (public.is_room_member(id));

create policy players_member_select on public.players
for select to authenticated
using (public.is_room_member(room_id));

create policy games_member_select on public.games
for select to authenticated
using (public.is_room_member(room_id));

-- Critical rule: a device can SELECT only its own hand rows.
create policy hands_owner_select on public.hands
for select to authenticated
using (public.is_hand_owner(player_id));

-- Clients don't directly insert/update game state. They use checked RPC functions.
revoke insert, update, delete on public.rooms from anon, authenticated;
revoke insert, update, delete on public.players from anon, authenticated;
revoke insert, update, delete on public.games from anon, authenticated;
revoke insert, update, delete on public.hands from anon, authenticated;
grant select on public.rooms, public.players, public.games, public.hands to authenticated;

create or replace function public.create_room(p_display_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_room_id uuid;
  i integer;
begin
  if v_uid is null then raise exception '匿名セッションが必要です'; end if;
  if char_length(trim(p_display_name)) not between 1 and 20 then raise exception '名前を1〜20文字で入力してください'; end if;

  for i in 1..30 loop
    v_code := lpad((floor(random() * 10000))::integer::text, 4, '0');
    exit when not exists(select 1 from public.rooms where code = v_code and created_at > now() - interval '24 hours');
  end loop;

  if v_code is null then raise exception 'ルーム番号を作成できませんでした'; end if;

  insert into public.rooms(code, host_user_id)
  values(v_code, v_uid)
  returning id into v_room_id;

  insert into public.players(room_id, user_id, display_name, seat)
  values(v_room_id, v_uid, trim(p_display_name), 0);

  return v_code;
end;
$$;

create or replace function public.join_room(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_seat integer;
  v_existing uuid;
begin
  if v_uid is null then raise exception '匿名セッションが必要です'; end if;
  if char_length(trim(p_display_name)) not between 1 and 20 then raise exception '名前を1〜20文字で入力してください'; end if;

  select * into v_room from public.rooms where code = p_code limit 1;
  if v_room.id is null then raise exception 'ルームが見つかりません'; end if;
  if v_room.status <> 'waiting' then raise exception 'このゲームはすでに開始しています'; end if;

  select id into v_existing from public.players where room_id = v_room.id and user_id = v_uid;
  if v_existing is not null then
    update public.players set display_name = trim(p_display_name) where id = v_existing;
    return v_room.id;
  end if;

  if (select count(*) from public.players where room_id = v_room.id) >= 8 then
    raise exception 'この部屋は満員です';
  end if;

  select coalesce(min(s), 0) into v_seat
  from generate_series(0,7) s
  where not exists(select 1 from public.players p where p.room_id = v_room.id and p.seat = s);

  insert into public.players(room_id, user_id, display_name, seat)
  values(v_room.id, v_uid, trim(p_display_name), v_seat);

  return v_room.id;
end;
$$;

create or replace function public.start_game(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_count integer;
  v_target integer;
  v_game_id uuid;
  v_player_ids uuid[];
  v_all text[] := array[
    'culprit-01','first-discoverer-01','dog-01','boy-01',
    'rumor-01','rumor-02','rumor-03','rumor-04',
    'alibi-01','alibi-02','alibi-03','alibi-04','alibi-05',
    'detective-01','detective-02','detective-03','detective-04',
    'scheme-01','scheme-02','civilian-01','civilian-02',
    'witness-01','witness-02','witness-03',
    'info-01','info-02','info-03',
    'trade-01','trade-02','trade-03','trade-04','trade-05'
  ];
  -- Family MVP: these five always appear. Remaining cards are randomized.
  -- This can later be changed to an exact per-player official deck preset.
  v_required text[] := array['culprit-01','first-discoverer-01','detective-01','alibi-01','scheme-01'];
  v_selected text[];
  v_card text;
  i integer;
  v_player_index integer;
  v_first_player uuid;
begin
  if v_uid is null then raise exception '匿名セッションが必要です'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'ルームがありません'; end if;
  if v_room.host_user_id <> v_uid then raise exception 'ホストだけが開始できます'; end if;
  if v_room.status <> 'waiting' then raise exception 'すでに開始しています'; end if;

  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < 3 or v_count > 8 then raise exception '3〜8人で開始してください'; end if;
  v_target := v_count * 4;

  select array_agg(id order by seat) into v_player_ids from public.players where room_id = p_room_id;
  v_selected := v_required;

  for v_card in
    select x from unnest(v_all) x
    where not (x = any(v_required))
    order by random()
    limit (v_target - cardinality(v_required))
  loop
    v_selected := array_append(v_selected, v_card);
  end loop;

  select array_agg(x order by random()) into v_selected from unnest(v_selected) x;

  insert into public.games(room_id) values(p_room_id) returning id into v_game_id;

  for i in 1..array_length(v_selected,1) loop
    v_player_index := floor((i - 1) / 4.0)::integer + 1;
    insert into public.hands(game_id, player_id, card_id, sort_order)
    values(v_game_id, v_player_ids[v_player_index], v_selected[i], ((i - 1) % 4));
  end loop;

  select player_id into v_first_player
  from public.hands
  where game_id = v_game_id and card_id = 'first-discoverer-01';

  update public.games set current_turn_player_id = v_first_player where id = v_game_id;
  update public.rooms set status = 'playing', game_id = v_game_id where id = p_room_id;

  return v_game_id;
end;
$$;

grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text,text) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;

-- Realtime publication (safe on re-run).
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rooms') then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='players') then
    alter publication supabase_realtime add table public.players;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='games') then
    alter publication supabase_realtime add table public.games;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='hands') then
    alter publication supabase_realtime add table public.hands;
  end if;
end $$;
