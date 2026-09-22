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


-- Ver.0.2 additions: first discoverer action
-- 犯人は踊る Family Ver.0.2 upgrade
-- Ver.0.1 を既に導入済みの場合、このファイルを Supabase SQL Editor で1回実行してください。

alter table public.games
  add column if not exists phase text not null default 'awaiting_incident';

alter table public.games
  add column if not exists incident_text text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'games_phase_check'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_phase_check check (phase in ('awaiting_incident','turn','finished'));
  end if;
end $$;

create table if not exists public.played_cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  card_id text not null,
  played_at timestamptz not null default now()
);

create index if not exists idx_played_cards_game on public.played_cards(game_id, played_at);

alter table public.played_cards enable row level security;
drop policy if exists played_cards_member_select on public.played_cards;
create policy played_cards_member_select on public.played_cards
for select to authenticated
using (
  exists (
    select 1
    from public.games g
    where g.id = game_id
      and public.is_room_member(g.room_id)
  )
);

revoke insert, update, delete on public.played_cards from anon, authenticated;
grant select on public.played_cards to authenticated;

create or replace function public.play_first_discoverer(p_game_id uuid, p_incident_text text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_game public.games%rowtype;
  v_player public.players%rowtype;
  v_hand public.hands%rowtype;
  v_next_player uuid;
  v_incident text := trim(coalesce(p_incident_text, ''));
begin
  if v_uid is null then raise exception '匿名セッションが必要です'; end if;
  if v_incident = '' then v_incident := '大切なおやつがなくなった！'; end if;
  if char_length(v_incident) > 100 then raise exception '事件は100文字以内にしてください'; end if;

  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if v_game.id is null then raise exception 'ゲームが見つかりません'; end if;
  if v_game.status <> 'playing' then raise exception 'このゲームは進行中ではありません'; end if;
  if v_game.phase <> 'awaiting_incident' then raise exception '第一発見者はすでに使用されています'; end if;

  select * into v_player
  from public.players
  where room_id = v_game.room_id and user_id = v_uid
  limit 1;

  if v_player.id is null then raise exception 'このゲームの参加者ではありません'; end if;
  if v_game.current_turn_player_id <> v_player.id then raise exception 'あなたの手番ではありません'; end if;

  select * into v_hand
  from public.hands
  where game_id = p_game_id
    and player_id = v_player.id
    and card_id = 'first-discoverer-01'
  limit 1
  for update;

  if v_hand.id is null then raise exception '第一発見者カードを持っていません'; end if;

  delete from public.hands where id = v_hand.id;
  insert into public.played_cards(game_id, player_id, card_id)
  values(p_game_id, v_player.id, 'first-discoverer-01');

  select p.id into v_next_player
  from public.players p
  where p.room_id = v_game.room_id
    and p.seat > v_player.seat
  order by p.seat
  limit 1;

  if v_next_player is null then
    select p.id into v_next_player
    from public.players p
    where p.room_id = v_game.room_id
    order by p.seat
    limit 1;
  end if;

  update public.games
  set phase = 'turn',
      incident_text = v_incident,
      current_turn_player_id = v_next_player
  where id = p_game_id;

  return v_next_player;
end;
$$;

grant execute on function public.play_first_discoverer(uuid,text) to authenticated;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='played_cards'
  ) then
    alter publication supabase_realtime add table public.played_cards;
  end if;
end $$;


-- Ver.0.4 additions
-- 犯人は踊る Family Ver.0.4 upgrade
-- Ver.0.3.x まで導入済みのプロジェクトで、Supabase SQL Editor から1回実行してください。
-- 追加内容: 通常カード効果、秘密情報RPC、取り引き/情報操作/うわさの同期アクション。

alter table public.games add column if not exists last_public_message text null;
alter table public.games add column if not exists result_text text null;

alter table public.games drop constraint if exists games_phase_check;
alter table public.games
  add constraint games_phase_check check (phase in ('awaiting_incident','turn','action','finished'));

create table if not exists public.game_actions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  action_type text not null check (action_type in ('trade','info','rumor')),
  actor_player_id uuid not null references public.players(id) on delete cascade,
  target_player_id uuid null references public.players(id) on delete cascade,
  status text not null default 'active' check (status in ('active','completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);
create unique index if not exists uq_game_actions_one_active
  on public.game_actions(game_id) where status = 'active';

create table if not exists public.action_selections (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.game_actions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  hand_id uuid not null references public.hands(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(action_id, player_id)
);

alter table public.game_actions enable row level security;
alter table public.action_selections enable row level security;

drop policy if exists game_actions_member_select on public.game_actions;
create policy game_actions_member_select on public.game_actions
for select to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = game_id and public.is_room_member(g.room_id)
  )
);

drop policy if exists action_selections_owner_select on public.action_selections;
create policy action_selections_owner_select on public.action_selections
for select to authenticated
using (public.is_hand_owner(player_id));

revoke insert, update, delete on public.game_actions from anon, authenticated;
revoke insert, update, delete on public.action_selections from anon, authenticated;
grant select on public.game_actions, public.action_selections to authenticated;

create or replace function public.advance_game_turn(p_game_id uuid, p_from_player_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room_id uuid;
  v_from_seat integer;
  v_next uuid;
begin
  select room_id into v_room_id from public.games where id = p_game_id;
  select seat into v_from_seat from public.players where id = p_from_player_id;

  select p.id into v_next
  from public.players p
  where p.room_id = v_room_id
    and exists (select 1 from public.hands h where h.game_id = p_game_id and h.player_id = p.id)
  order by case when p.seat > v_from_seat then p.seat - v_from_seat else p.seat - v_from_seat + 8 end
  limit 1;

  if v_next is null then
    update public.games
      set status='finished', phase='finished', current_turn_player_id=null,
          last_public_message=coalesce(p_message,'ゲーム終了'), result_text='全員の手札がなくなりました。'
    where id=p_game_id;
    update public.rooms set status='finished' where id=v_room_id;
    return null;
  end if;

  update public.games
    set phase='turn', current_turn_player_id=v_next, last_public_message=p_message
  where id=p_game_id;
  return v_next;
end;
$$;

create or replace function public.finish_family_game(p_game_id uuid, p_result text, p_message text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_room_id uuid;
begin
  select room_id into v_room_id from public.games where id=p_game_id;
  update public.games
    set status='finished', phase='finished', current_turn_player_id=null,
        result_text=p_result, last_public_message=coalesce(p_message,p_result)
  where id=p_game_id;
  update public.rooms set status='finished' where id=v_room_id;
end;
$$;

create or replace function public.get_hand_counts(p_game_id uuid)
returns table(player_id uuid, hand_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_room_id uuid;
begin
  select room_id into v_room_id from public.games where id=p_game_id;
  if v_room_id is null or not public.is_room_member(v_room_id) then raise exception '参加者ではありません'; end if;
  return query
    select p.id, count(h.id)
    from public.players p
    left join public.hands h on h.player_id=p.id and h.game_id=p_game_id
    where p.room_id=v_room_id
    group by p.id, p.seat
    order by p.seat;
end;
$$;
grant execute on function public.get_hand_counts(uuid) to authenticated;

create or replace function public.play_simple_card(p_game_id uuid, p_card_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_hand public.hands%rowtype;
  v_kind text; v_name text; v_msg text;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if v_game.id is null or v_game.status<>'playing' or v_game.phase<>'turn' then raise exception '今はカードを出せません'; end if;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  if v_player.id is null or v_game.current_turn_player_id<>v_player.id then raise exception 'あなたの手番ではありません'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id=p_card_id for update;
  if v_hand.id is null then raise exception 'そのカードを持っていません'; end if;
  v_kind := split_part(p_card_id,'-',1);
  if v_kind not in ('civilian','alibi','scheme') then raise exception 'この関数では処理できないカードです'; end if;
  v_name := case v_kind when 'civilian' then '一般人' when 'alibi' then 'アリバイ' else 'たくらみ' end;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,p_card_id);
  v_msg := v_player.display_name || 'が「' || v_name || '」を出しました。' || case when v_kind='scheme' then ' 犯人側になりました。' else '' end;
  perform public.advance_game_turn(p_game_id,v_player.id,v_msg);
  return jsonb_build_object('message',v_msg);
end;
$$;
grant execute on function public.play_simple_card(uuid,text) to authenticated;

create or replace function public.play_boy(p_game_id uuid, p_card_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_hand public.hands%rowtype; v_culprit_name text; v_msg text;
begin
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  if v_game.status<>'playing' or v_game.phase<>'turn' or v_game.current_turn_player_id<>v_player.id then raise exception 'あなたの手番ではありません'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id=p_card_id for update;
  if v_hand.id is null or split_part(p_card_id,'-',1)<>'boy' then raise exception '少年カードを持っていません'; end if;
  select p.display_name into v_culprit_name from public.hands h join public.players p on p.id=h.player_id where h.game_id=p_game_id and h.card_id='culprit-01' limit 1;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,p_card_id);
  v_msg := v_player.display_name || 'が「少年」を使いました。';
  perform public.advance_game_turn(p_game_id,v_player.id,v_msg);
  return jsonb_build_object('message',v_msg,'secret',case when v_culprit_name is null then '犯人カードはすでに場に出ています。' else '犯人カードを持っているのは「'||v_culprit_name||'」です。' end);
end;
$$;
grant execute on function public.play_boy(uuid,text) to authenticated;

create or replace function public.play_witness(p_game_id uuid, p_card_id text, p_target_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_target public.players%rowtype; v_hand public.hands%rowtype;
  v_cards jsonb; v_msg text;
begin
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  select * into v_target from public.players where id=p_target_player_id and room_id=v_game.room_id;
  if v_game.status<>'playing' or v_game.phase<>'turn' or v_game.current_turn_player_id<>v_player.id then raise exception 'あなたの手番ではありません'; end if;
  if v_target.id is null or v_target.id=v_player.id then raise exception '別の参加者を選んでください'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id=p_card_id for update;
  if v_hand.id is null or split_part(p_card_id,'-',1)<>'witness' then raise exception '目撃者カードを持っていません'; end if;
  select coalesce(jsonb_agg(card_id order by sort_order,created_at),'[]'::jsonb) into v_cards from public.hands where game_id=p_game_id and player_id=v_target.id;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,p_card_id);
  v_msg := v_player.display_name || 'が' || v_target.display_name || 'に「目撃者」を使いました。';
  perform public.advance_game_turn(p_game_id,v_player.id,v_msg);
  return jsonb_build_object('message',v_msg,'target_name',v_target.display_name,'cards',v_cards);
end;
$$;
grant execute on function public.play_witness(uuid,text,uuid) to authenticated;

create or replace function public.play_detective(p_game_id uuid, p_card_id text, p_target_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_target public.players%rowtype; v_hand public.hands%rowtype;
  v_played integer; v_has_culprit boolean; v_has_alibi boolean; v_msg text; v_result text;
begin
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  select * into v_target from public.players where id=p_target_player_id and room_id=v_game.room_id;
  if v_game.status<>'playing' or v_game.phase<>'turn' or v_game.current_turn_player_id<>v_player.id then raise exception 'あなたの手番ではありません'; end if;
  if v_target.id is null or v_target.id=v_player.id then raise exception '別の参加者を選んでください'; end if;
  select count(*) into v_played from public.played_cards where game_id=p_game_id and player_id=v_player.id;
  if v_played<1 then raise exception '探偵は2周目から使えます'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id=p_card_id for update;
  if v_hand.id is null or split_part(p_card_id,'-',1)<>'detective' then raise exception '探偵カードを持っていません'; end if;
  select exists(select 1 from public.hands where game_id=p_game_id and player_id=v_target.id and card_id='culprit-01') into v_has_culprit;
  select exists(select 1 from public.hands where game_id=p_game_id and player_id=v_target.id and split_part(card_id,'-',1)='alibi') into v_has_alibi;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,p_card_id);
  if v_has_culprit and not v_has_alibi then
    v_result := '🕵️ '||v_player.display_name||'の探偵が的中！ '||v_target.display_name||'から犯人を発見。'||v_player.display_name||'の勝利！';
    perform public.finish_family_game(p_game_id,v_result,v_result);
    return jsonb_build_object('won',true,'message',v_result);
  end if;
  v_msg := case when v_has_culprit and v_has_alibi then '🪪 '||v_target.display_name||'にはアリバイがありました。' else '❌ '||v_target.display_name||'は犯人ではありませんでした。' end;
  perform public.advance_game_turn(p_game_id,v_player.id,v_msg);
  return jsonb_build_object('won',false,'message',v_msg);
end;
$$;
grant execute on function public.play_detective(uuid,text,uuid) to authenticated;

create or replace function public.play_dog(p_game_id uuid, p_card_id text, p_target_player_id uuid, p_slot integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_target public.players%rowtype; v_hand public.hands%rowtype; v_selected public.hands%rowtype;
  v_msg text; v_result text;
begin
  if p_slot<0 then raise exception 'カード位置が不正です'; end if;
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  select * into v_target from public.players where id=p_target_player_id and room_id=v_game.room_id;
  if v_game.status<>'playing' or v_game.phase<>'turn' or v_game.current_turn_player_id<>v_player.id then raise exception 'あなたの手番ではありません'; end if;
  if v_target.id is null or v_target.id=v_player.id then raise exception '別の参加者を選んでください'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id=p_card_id for update;
  if v_hand.id is null or split_part(p_card_id,'-',1)<>'dog' then raise exception 'いぬカードを持っていません'; end if;
  select * into v_selected from public.hands where game_id=p_game_id and player_id=v_target.id order by sort_order,created_at,id offset p_slot limit 1;
  if v_selected.id is null then raise exception 'その位置にカードがありません'; end if;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,p_card_id);
  if v_selected.card_id='culprit-01' then
    v_result := '🐶 '||v_player.display_name||'のいぬが、'||v_target.display_name||'の「犯人」を発見！ '||v_player.display_name||'の勝利！';
    perform public.finish_family_game(p_game_id,v_result,v_result);
    return jsonb_build_object('won',true,'revealed_card',v_selected.card_id,'message',v_result);
  end if;
  v_msg := '🐶 '||v_target.display_name||'の手札から「'||v_selected.card_id||'」が公開されました。犯人ではありません。';
  perform public.advance_game_turn(p_game_id,v_player.id,v_msg);
  return jsonb_build_object('won',false,'revealed_card',v_selected.card_id,'message',v_msg);
end;
$$;
grant execute on function public.play_dog(uuid,text,uuid,integer) to authenticated;

create or replace function public.play_culprit(p_game_id uuid, p_card_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_hand public.hands%rowtype; v_count integer; v_accomplices text; v_result text;
begin
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  if v_game.status<>'playing' or v_game.phase<>'turn' or v_game.current_turn_player_id<>v_player.id then raise exception 'あなたの手番ではありません'; end if;
  select count(*) into v_count from public.hands where game_id=p_game_id and player_id=v_player.id;
  if v_count<>1 then raise exception '犯人は最後の手札1枚のときだけ出せます'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id=p_card_id for update;
  if v_hand.id is null or p_card_id<>'culprit-01' then raise exception '犯人カードを持っていません'; end if;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,p_card_id);
  select string_agg(distinct p.display_name,'・' order by p.display_name) into v_accomplices
    from public.played_cards pc join public.players p on p.id=pc.player_id
    where pc.game_id=p_game_id and split_part(pc.card_id,'-',1)='scheme' and p.id<>v_player.id;
  v_result := '🎉 犯人側の勝利！ 勝者：'||v_player.display_name||case when v_accomplices is null then '' else '・'||v_accomplices end;
  perform public.finish_family_game(p_game_id,v_result,v_result);
  return jsonb_build_object('won',true,'message',v_result);
end;
$$;
grant execute on function public.play_culprit(uuid,text) to authenticated;

create or replace function public.start_trade(p_game_id uuid, p_card_id text, p_target_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_target public.players%rowtype; v_hand public.hands%rowtype; v_action uuid; v_a integer; v_b integer;
begin
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  select * into v_target from public.players where id=p_target_player_id and room_id=v_game.room_id;
  if v_game.status<>'playing' or v_game.phase<>'turn' or v_game.current_turn_player_id<>v_player.id then raise exception 'あなたの手番ではありません'; end if;
  if v_target.id is null or v_target.id=v_player.id then raise exception '別の参加者を選んでください'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id=p_card_id for update;
  if v_hand.id is null or split_part(p_card_id,'-',1)<>'trade' then raise exception '取り引きカードを持っていません'; end if;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,p_card_id);
  select count(*) into v_a from public.hands where game_id=p_game_id and player_id=v_player.id;
  select count(*) into v_b from public.hands where game_id=p_game_id and player_id=v_target.id;
  if v_a=0 or v_b=0 then
    perform public.advance_game_turn(p_game_id,v_player.id,v_player.display_name||'が「取り引き」を出しましたが、交換できる手札がありませんでした。');
    return null;
  end if;
  insert into public.game_actions(game_id,action_type,actor_player_id,target_player_id) values(p_game_id,'trade',v_player.id,v_target.id) returning id into v_action;
  update public.games set phase='action',last_public_message=v_player.display_name||'と'||v_target.display_name||'が取り引き中です…' where id=p_game_id;
  return v_action;
end;
$$;
grant execute on function public.start_trade(uuid,text,uuid) to authenticated;

create or replace function public.submit_trade(p_action_id uuid, p_hand_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_action public.game_actions%rowtype; v_player public.players%rowtype; v_hand public.hands%rowtype; v_count integer; v_actor_hand uuid; v_target_hand uuid;
begin
  select * into v_action from public.game_actions where id=p_action_id and status='active' for update;
  if v_action.id is null or v_action.action_type<>'trade' then raise exception '取り引きは終了しています'; end if;
  select p.* into v_player from public.players p join public.games g on g.room_id=p.room_id where g.id=v_action.game_id and p.user_id=v_uid limit 1;
  if v_player.id not in (v_action.actor_player_id,v_action.target_player_id) then raise exception 'この取り引きの当事者ではありません'; end if;
  select * into v_hand from public.hands where id=p_hand_id and game_id=v_action.game_id and player_id=v_player.id;
  if v_hand.id is null then raise exception '自分の手札から選んでください'; end if;
  insert into public.action_selections(action_id,player_id,hand_id) values(p_action_id,v_player.id,p_hand_id)
    on conflict(action_id,player_id) do update set hand_id=excluded.hand_id,created_at=now();
  select count(*) into v_count from public.action_selections where action_id=p_action_id;
  if v_count<2 then return false; end if;
  select hand_id into v_actor_hand from public.action_selections where action_id=p_action_id and player_id=v_action.actor_player_id;
  select hand_id into v_target_hand from public.action_selections where action_id=p_action_id and player_id=v_action.target_player_id;
  update public.hands set player_id=v_action.target_player_id where id=v_actor_hand;
  update public.hands set player_id=v_action.actor_player_id where id=v_target_hand;
  update public.game_actions set status='completed',completed_at=now() where id=p_action_id;
  perform public.advance_game_turn(v_action.game_id,v_action.actor_player_id,'🔄 取り引きが成立しました。');
  return true;
end;
$$;
grant execute on function public.submit_trade(uuid,uuid) to authenticated;

create or replace function public.start_info(p_game_id uuid, p_card_id text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_hand public.hands%rowtype; v_action uuid; v_remaining integer;
begin
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  if v_game.status<>'playing' or v_game.phase<>'turn' or v_game.current_turn_player_id<>v_player.id then raise exception 'あなたの手番ではありません'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id=p_card_id for update;
  if v_hand.id is null or split_part(p_card_id,'-',1)<>'info' then raise exception '情報操作カードを持っていません'; end if;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,p_card_id);
  select count(*) into v_remaining from public.hands where game_id=p_game_id;
  if v_remaining=0 then perform public.advance_game_turn(p_game_id,v_player.id,'情報操作を出しましたが、渡せるカードがありませんでした。'); return null; end if;
  insert into public.game_actions(game_id,action_type,actor_player_id) values(p_game_id,'info',v_player.id) returning id into v_action;
  update public.games set phase='action',last_public_message='📡 情報操作：全員が左隣へ渡すカードを選んでいます…' where id=p_game_id;
  return v_action;
end;
$$;
grant execute on function public.start_info(uuid,text) to authenticated;

create or replace function public.submit_info(p_action_id uuid, p_hand_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_action public.game_actions%rowtype; v_game public.games%rowtype; v_player public.players%rowtype; v_hand public.hands%rowtype; v_required integer; v_done integer; r record; v_left uuid; v_max_seat integer;
begin
  select * into v_action from public.game_actions where id=p_action_id and status='active' for update;
  if v_action.id is null or v_action.action_type<>'info' then raise exception '情報操作は終了しています'; end if;
  select * into v_game from public.games where id=v_action.game_id;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  select * into v_hand from public.hands where id=p_hand_id and game_id=v_action.game_id and player_id=v_player.id;
  if v_hand.id is null then raise exception '自分の手札から選んでください'; end if;
  insert into public.action_selections(action_id,player_id,hand_id) values(p_action_id,v_player.id,p_hand_id)
    on conflict(action_id,player_id) do update set hand_id=excluded.hand_id,created_at=now();
  select count(distinct player_id) into v_required from public.hands where game_id=v_action.game_id;
  select count(*) into v_done from public.action_selections where action_id=p_action_id;
  if v_done<v_required then return false; end if;
  select max(seat) into v_max_seat from public.players where room_id=v_game.room_id;
  for r in select s.player_id,s.hand_id,p.seat from public.action_selections s join public.players p on p.id=s.player_id where s.action_id=p_action_id loop
    select id into v_left from public.players where room_id=v_game.room_id and seat=case when r.seat=v_max_seat then 0 else r.seat+1 end;
    update public.hands set player_id=v_left where id=r.hand_id;
  end loop;
  update public.game_actions set status='completed',completed_at=now() where id=p_action_id;
  perform public.advance_game_turn(v_action.game_id,v_action.actor_player_id,'📡 情報操作：全員が左隣へカードを1枚渡しました。');
  return true;
end;
$$;
grant execute on function public.submit_info(uuid,uuid) to authenticated;

create or replace function public.start_rumor(p_game_id uuid, p_card_id text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_hand public.hands%rowtype; v_action uuid; v_remaining integer;
begin
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  if v_game.status<>'playing' or v_game.phase<>'turn' or v_game.current_turn_player_id<>v_player.id then raise exception 'あなたの手番ではありません'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id=p_card_id for update;
  if v_hand.id is null or split_part(p_card_id,'-',1)<>'rumor' then raise exception 'うわさカードを持っていません'; end if;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,p_card_id);
  select count(*) into v_remaining from public.hands where game_id=p_game_id;
  if v_remaining=0 then perform public.advance_game_turn(p_game_id,v_player.id,'うわさを出しましたが、取れるカードがありませんでした。'); return null; end if;
  insert into public.game_actions(game_id,action_type,actor_player_id) values(p_game_id,'rumor',v_player.id) returning id into v_action;
  update public.games set phase='action',last_public_message='📢 うわさ：全員が右隣の人からカードを選んでいます…' where id=p_game_id;
  return v_action;
end;
$$;
grant execute on function public.start_rumor(uuid,text) to authenticated;

create or replace function public.submit_rumor(p_action_id uuid, p_slot integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_action public.game_actions%rowtype; v_game public.games%rowtype; v_player public.players%rowtype; v_right public.players%rowtype; v_hand public.hands%rowtype;
  v_max_seat integer; v_required integer; v_done integer; r record;
begin
  if p_slot<0 then raise exception 'カード位置が不正です'; end if;
  select * into v_action from public.game_actions where id=p_action_id and status='active' for update;
  if v_action.id is null or v_action.action_type<>'rumor' then raise exception 'うわさは終了しています'; end if;
  select * into v_game from public.games where id=v_action.game_id;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  select max(seat) into v_max_seat from public.players where room_id=v_game.room_id;
  select * into v_right from public.players where room_id=v_game.room_id and seat=case when v_player.seat=0 then v_max_seat else v_player.seat-1 end;
  select * into v_hand from public.hands where game_id=v_action.game_id and player_id=v_right.id order by sort_order,created_at,id offset p_slot limit 1;
  if v_hand.id is null then raise exception '右隣の人に選べる手札がありません'; end if;
  insert into public.action_selections(action_id,player_id,hand_id) values(p_action_id,v_player.id,v_hand.id)
    on conflict(action_id,player_id) do update set hand_id=excluded.hand_id,created_at=now();

  select count(*) into v_required
  from public.players chooser
  where chooser.room_id=v_game.room_id
    and exists (
      select 1 from public.players rp
      where rp.room_id=v_game.room_id
        and rp.seat=case when chooser.seat=0 then v_max_seat else chooser.seat-1 end
        and exists(select 1 from public.hands hh where hh.game_id=v_action.game_id and hh.player_id=rp.id)
    );
  select count(*) into v_done from public.action_selections where action_id=p_action_id;
  if v_done<v_required then return false; end if;
  for r in select player_id,hand_id from public.action_selections where action_id=p_action_id loop
    update public.hands set player_id=r.player_id where id=r.hand_id;
  end loop;
  update public.game_actions set status='completed',completed_at=now() where id=p_action_id;
  perform public.advance_game_turn(v_action.game_id,v_action.actor_player_id,'📢 うわさ：全員が右隣の人からカードを1枚取りました。');
  return true;
end;
$$;
grant execute on function public.submit_rumor(uuid,integer) to authenticated;

-- 第一発見者もVer.0.4の共通ターン進行を使うよう更新。
create or replace function public.play_first_discoverer(p_game_id uuid, p_incident_text text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_player public.players%rowtype; v_hand public.hands%rowtype; v_incident text:=trim(coalesce(p_incident_text,'')); v_next uuid;
begin
  if v_incident='' then v_incident:='大切なおやつがなくなった！'; end if;
  if char_length(v_incident)>100 then raise exception '事件は100文字以内にしてください'; end if;
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_player from public.players where room_id=v_game.room_id and user_id=v_uid limit 1;
  if v_game.status<>'playing' or v_game.phase<>'awaiting_incident' or v_game.current_turn_player_id<>v_player.id then raise exception '第一発見者を出せません'; end if;
  select * into v_hand from public.hands where game_id=p_game_id and player_id=v_player.id and card_id='first-discoverer-01' for update;
  if v_hand.id is null then raise exception '第一発見者カードを持っていません'; end if;
  delete from public.hands where id=v_hand.id;
  insert into public.played_cards(game_id,player_id,card_id) values(p_game_id,v_player.id,'first-discoverer-01');
  update public.games set incident_text=v_incident where id=p_game_id;
  v_next:=public.advance_game_turn(p_game_id,v_player.id,v_player.display_name||'が事件を発表しました。');
  return v_next;
end;
$$;
grant execute on function public.play_first_discoverer(uuid,text) to authenticated;

-- Realtime
DO $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_actions') then
    alter publication supabase_realtime add table public.game_actions;
  end if;
end $$;

-- Ver.0.5 additions
-- 犯人は踊る Family Ver.0.5 upgrade
-- Ver.0.4 導入済みのプロジェクトで、Supabase SQL Editor から1回実行してください。
-- 追加内容: 再接続支援、二重実行対策を補助する進行状態、待機状況、結果公開、犯人カード移動履歴、リプレイ/リセット。

alter table public.game_actions
  add column if not exists updated_at timestamptz not null default now();

-- 犯人カードの所在変化だけを、安全にサーバー側へ記録する。
create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  event_type text not null check (event_type in ('culprit_owner')),
  card_id text not null default 'culprit-01',
  from_player_id uuid null references public.players(id) on delete set null,
  to_player_id uuid null references public.players(id) on delete set null,
  action_type text null,
  detail text null,
  created_at timestamptz not null default now()
);
create index if not exists idx_game_events_game on public.game_events(game_id, created_at, id);

alter table public.game_events enable row level security;
-- 進行中に犯人の所在が漏れないよう、直接SELECTは許可しない。
revoke all on public.game_events from anon, authenticated;

create or replace function public.log_culprit_owner_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action_type text;
begin
  if new.card_id <> 'culprit-01' then return new; end if;

  if tg_op = 'INSERT' then
    insert into public.game_events(game_id,event_type,from_player_id,to_player_id,action_type,detail)
    values(new.game_id,'culprit_owner',null,new.player_id,'deal','配札');
    return new;
  end if;

  if old.player_id is distinct from new.player_id then
    select ga.action_type into v_action_type
      from public.game_actions ga
      where ga.game_id=new.game_id and ga.status='active'
      order by ga.created_at desc
      limit 1;
    insert into public.game_events(game_id,event_type,from_player_id,to_player_id,action_type,detail)
    values(new.game_id,'culprit_owner',old.player_id,new.player_id,coalesce(v_action_type,'move'),'犯人カードが移動');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_culprit_owner_change on public.hands;
create trigger trg_log_culprit_owner_change
after insert or update of player_id on public.hands
for each row execute function public.log_culprit_owner_change();

-- v0.5適用時点ですでに進行中のゲームがあれば、現在地だけをスナップショットとして補完。
insert into public.game_events(game_id,event_type,from_player_id,to_player_id,action_type,detail)
select h.game_id,'culprit_owner',null,h.player_id,'snapshot','Ver.0.5導入時の現在地'
from public.hands h
where h.card_id='culprit-01'
  and not exists(select 1 from public.game_events e where e.game_id=h.game_id and e.card_id='culprit-01');

-- 誰かが選択したら game_actions.updated_at を更新し、全端末のRealtime購読を発火させる。
create or replace function public.touch_game_action_on_selection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.game_actions set updated_at=now() where id=new.action_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_game_action_on_selection on public.action_selections;
create trigger trg_touch_game_action_on_selection
after insert or update on public.action_selections
for each row execute function public.touch_game_action_on_selection();

-- カード選択を待っているプレイヤーを、カード内容を漏らさず返す。
create or replace function public.get_action_progress(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action public.game_actions%rowtype;
  v_room_id uuid;
  v_max_seat integer;
  v_rows jsonb;
begin
  select * into v_action from public.game_actions where id=p_action_id;
  if v_action.id is null then return '[]'::jsonb; end if;
  select room_id into v_room_id from public.games where id=v_action.game_id;
  if v_room_id is null or not public.is_room_member(v_room_id) then raise exception '参加者ではありません'; end if;
  select max(seat) into v_max_seat from public.players where room_id=v_room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', p.id,
    'required', case
      when v_action.action_type='trade' then p.id in (v_action.actor_player_id,v_action.target_player_id)
      when v_action.action_type='info' then exists(select 1 from public.hands h where h.game_id=v_action.game_id and h.player_id=p.id)
      when v_action.action_type='rumor' then exists(
        select 1
        from public.players rp
        where rp.room_id=v_room_id
          and rp.seat=case when p.seat=0 then v_max_seat else p.seat-1 end
          and exists(select 1 from public.hands hh where hh.game_id=v_action.game_id and hh.player_id=rp.id)
      )
      else false
    end,
    'selected', exists(select 1 from public.action_selections s where s.action_id=v_action.id and s.player_id=p.id)
  ) order by p.seat), '[]'::jsonb)
  into v_rows
  from public.players p
  where p.room_id=v_room_id;

  return v_rows;
end;
$$;
grant execute on function public.get_action_progress(uuid) to authenticated;

-- ゲーム終了後だけ、全員の残り手札・犯人側・犯人カードの軌跡を公開する。
create or replace function public.get_game_summary(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games%rowtype;
  v_players jsonb;
  v_trail jsonb;
begin
  select * into v_game from public.games where id=p_game_id;
  if v_game.id is null then raise exception 'ゲームが見つかりません'; end if;
  if not public.is_room_member(v_game.room_id) then raise exception '参加者ではありません'; end if;
  if v_game.status <> 'finished' then raise exception '結果はゲーム終了後に公開されます'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', p.id,
    'display_name', p.display_name,
    'seat', p.seat,
    'accomplice', exists(
      select 1 from public.played_cards pc
      where pc.game_id=p_game_id and pc.player_id=p.id and split_part(pc.card_id,'-',1)='scheme'
    ),
    'hand', coalesce((
      select jsonb_agg(h.card_id order by h.sort_order,h.created_at,h.id)
      from public.hands h where h.game_id=p_game_id and h.player_id=p.id
    ), '[]'::jsonb)
  ) order by p.seat), '[]'::jsonb)
  into v_players
  from public.players p
  where p.room_id=v_game.room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', e.id,
    'from_player_id', e.from_player_id,
    'from_name', fp.display_name,
    'to_player_id', e.to_player_id,
    'to_name', tp.display_name,
    'action_type', e.action_type,
    'detail', e.detail,
    'created_at', e.created_at
  ) order by e.created_at,e.id), '[]'::jsonb)
  into v_trail
  from public.game_events e
  left join public.players fp on fp.id=e.from_player_id
  left join public.players tp on tp.id=e.to_player_id
  where e.game_id=p_game_id and e.card_id='culprit-01';

  return jsonb_build_object(
    'result_text', v_game.result_text,
    'incident_text', v_game.incident_text,
    'players', v_players,
    'culprit_trail', v_trail
  );
end;
$$;
grant execute on function public.get_game_summary(uuid) to authenticated;

-- ホストだけがゲームを待機室へ戻せる。参加者は残し、ゲーム状態だけを削除する。
create or replace function public.reset_room(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_room public.rooms%rowtype;
  v_game_id uuid;
begin
  select * into v_room from public.rooms where id=p_room_id for update;
  if v_room.id is null then raise exception 'ルームが見つかりません'; end if;
  if v_room.host_user_id<>v_uid then raise exception 'ホストだけがリセットできます'; end if;

  v_game_id:=v_room.game_id;
  update public.rooms set status='waiting',game_id=null where id=p_room_id;
  if v_game_id is not null then delete from public.games where id=v_game_id; end if;
  return true;
end;
$$;
grant execute on function public.reset_room(uuid) to authenticated;

-- game_actions のupdated_at変更をRealtimeへ流すため、既存publicationをそのまま利用。
