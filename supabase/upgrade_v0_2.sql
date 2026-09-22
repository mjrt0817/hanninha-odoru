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
