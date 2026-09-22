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
