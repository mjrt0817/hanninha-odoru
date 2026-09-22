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
