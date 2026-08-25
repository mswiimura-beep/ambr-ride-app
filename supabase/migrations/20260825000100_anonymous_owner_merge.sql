-- PROPOSAL ONLY. Apply only after 20260818000100_shared_data_reliability.sql,
-- the read-only audit, and a verified backup. The public client cannot call the
-- merge RPC; only the merge-anonymous-owner Edge Function may use service_role.

begin;

create table if not exists public.ownership_merge_audit (
  source_user_id uuid primary key,
  target_user_id uuid not null,
  merged_at timestamptz not null default now(),
  moved_counts jsonb not null default '{}'::jsonb
);

alter table public.ownership_merge_audit enable row level security;
revoke all on public.ownership_merge_audit from public, anon, authenticated;

create or replace function public.ambr_owner_active(owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select owner_id is not null
    and not exists (
      select 1
      from public.ownership_merge_audit audit
      where audit.source_user_id = owner_id
    );
$$;

revoke all on function public.ambr_owner_active(uuid) from public, anon, authenticated;
grant execute on function public.ambr_owner_active(uuid) to authenticated, service_role;

-- A merged post keeps its original object key (source-user-id/...).  Keep a
-- durable, server-verified mapping so the new owner can clean up that object
-- even after the post row itself has been deleted.
create or replace function public.ambr_can_manage_storage_prefix(prefix text, owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select prefix = owner_id::text
    or exists (
      select 1
      from public.ownership_merge_audit audit
      where audit.source_user_id::text = prefix
        and audit.target_user_id = owner_id
    );
$$;

revoke all on function public.ambr_can_manage_storage_prefix(text, uuid) from public, anon, authenticated;
grant execute on function public.ambr_can_manage_storage_prefix(text, uuid) to authenticated, service_role;

create or replace function public.merge_anonymous_user_data(source_user uuid, target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_target uuid;
  moved integer;
  counts jsonb := '{}'::jsonb;
begin
  if source_user is null or target_user is null or source_user = target_user then
    raise exception 'Source and target users must be different';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(source_user::text, 0));

  select audit.target_user_id into existing_target
  from public.ownership_merge_audit audit
  where audit.source_user_id = source_user;
  if existing_target is not null then
    if existing_target <> target_user then
      raise exception 'Anonymous owner was already merged to another account';
    end if;
    return (
      select jsonb_build_object(
        'sourceUserId', audit.source_user_id,
        'targetUserId', audit.target_user_id,
        'alreadyMerged', true,
        'counts', audit.moved_counts
      )
      from public.ownership_merge_audit audit
      where audit.source_user_id = source_user
    );
  end if;

  if not exists (
    select 1 from auth.users users
    where users.id = source_user and users.is_anonymous is true
  ) then
    raise exception 'Source user is not an anonymous account';
  end if;
  if not exists (
    select 1 from auth.users users
    where users.id = target_user and users.is_anonymous is false
  ) then
    raise exception 'Target user is not a permanent account';
  end if;
  if exists (
    select 1 from public.ownership_merge_audit audit
    where audit.source_user_id = target_user
  ) then
    raise exception 'Target account is no longer active';
  end if;

  -- Normal client writes do not take our advisory lock. These short-lived
  -- table locks close the race where the source JWT writes after a table was
  -- moved but before the merge tombstone commits. After commit RLS blocks it.
  perform set_config('lock_timeout', '5s', true);
  lock table public.midway_posts, public.midway_post_reactions,
    public.midway_post_comments, public.events, public.event_participants,
    public.shared_routes, storage.objects in share row exclusive mode;

  insert into public.ownership_merge_audit (
    source_user_id, target_user_id, moved_counts
  ) values (source_user, target_user, '{}'::jsonb);

  update public.midway_posts source
  set client_post_id = gen_random_uuid()
  where source.user_id = source_user
    and source.client_post_id is not null
    and exists (
      select 1 from public.midway_posts target
      where target.user_id = target_user
        and target.client_post_id = source.client_post_id
    );
  update public.midway_posts set user_id = target_user where user_id = source_user;
  get diagnostics moved = row_count;
  counts := counts || jsonb_build_object('midway_posts', moved);

  delete from public.midway_post_reactions source
  where source.user_id = source_user
    and exists (
      select 1 from public.midway_post_reactions target
      where target.user_id = target_user
        and target.post_id = source.post_id
        and target.reaction = source.reaction
    );
  update public.midway_post_reactions set user_id = target_user where user_id = source_user;
  get diagnostics moved = row_count;
  counts := counts || jsonb_build_object('midway_post_reactions', moved);

  update public.midway_post_comments source
  set client_comment_id = gen_random_uuid()
  where source.user_id = source_user
    and source.client_comment_id is not null
    and exists (
      select 1 from public.midway_post_comments target
      where target.user_id = target_user
        and target.client_comment_id = source.client_comment_id
    );
  update public.midway_post_comments set user_id = target_user where user_id = source_user;
  get diagnostics moved = row_count;
  counts := counts || jsonb_build_object('midway_post_comments', moved);

  update public.events source
  set client_event_id = gen_random_uuid()
  where source.creator_id = source_user
    and source.client_event_id is not null
    and exists (
      select 1 from public.events target
      where target.creator_id = target_user
        and target.client_event_id = source.client_event_id
    );
  update public.events set creator_id = target_user where creator_id = source_user;
  get diagnostics moved = row_count;
  counts := counts || jsonb_build_object('events', moved);

  delete from public.event_participants source
  where source.user_id = source_user
    and exists (
      select 1 from public.event_participants target
      where target.user_id = target_user
        and target.event_id = source.event_id
    );
  update public.event_participants set user_id = target_user where user_id = source_user;
  get diagnostics moved = row_count;
  counts := counts || jsonb_build_object('event_participants', moved);

  update public.shared_routes source
  set client_ride_id = gen_random_uuid()::text
  where source.user_id = source_user
    and exists (
      select 1 from public.shared_routes target
      where target.user_id = target_user
        and target.client_ride_id = source.client_ride_id
    );
  update public.shared_routes set user_id = target_user where user_id = source_user;
  get diagnostics moved = row_count;
  counts := counts || jsonb_build_object('shared_routes', moved);

  update public.ownership_merge_audit
  set moved_counts = counts, merged_at = now()
  where source_user_id = source_user;

  return jsonb_build_object(
    'sourceUserId', source_user,
    'targetUserId', target_user,
    'alreadyMerged', false,
    'counts', counts
  );
end;
$$;

revoke all on function public.merge_anonymous_user_data(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_user_data(uuid, uuid) to service_role;

drop policy if exists ambr_posts_insert on public.midway_posts;
drop policy if exists ambr_posts_update on public.midway_posts;
drop policy if exists ambr_posts_delete on public.midway_posts;
create policy ambr_posts_insert on public.midway_posts for insert to authenticated
  with check (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_posts_update on public.midway_posts for update to authenticated
  using (user_id = auth.uid() and public.ambr_owner_active(auth.uid()))
  with check (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_posts_delete on public.midway_posts for delete to authenticated
  using (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));

drop policy if exists ambr_reactions_insert on public.midway_post_reactions;
drop policy if exists ambr_reactions_delete on public.midway_post_reactions;
create policy ambr_reactions_insert on public.midway_post_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_reactions_delete on public.midway_post_reactions for delete to authenticated
  using (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));

drop policy if exists ambr_comments_insert on public.midway_post_comments;
drop policy if exists ambr_comments_update on public.midway_post_comments;
drop policy if exists ambr_comments_delete on public.midway_post_comments;
create policy ambr_comments_insert on public.midway_post_comments for insert to authenticated
  with check (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_comments_update on public.midway_post_comments for update to authenticated
  using (user_id = auth.uid() and public.ambr_owner_active(auth.uid()))
  with check (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_comments_delete on public.midway_post_comments for delete to authenticated
  using (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));

drop policy if exists ambr_events_insert on public.events;
drop policy if exists ambr_events_update on public.events;
drop policy if exists ambr_events_delete on public.events;
create policy ambr_events_insert on public.events for insert to authenticated
  with check (creator_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_events_update on public.events for update to authenticated
  using (creator_id = auth.uid() and public.ambr_owner_active(auth.uid()))
  with check (creator_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_events_delete on public.events for delete to authenticated
  using (creator_id = auth.uid() and public.ambr_owner_active(auth.uid()));

drop policy if exists ambr_participants_insert on public.event_participants;
drop policy if exists ambr_participants_update on public.event_participants;
drop policy if exists ambr_participants_delete on public.event_participants;
create policy ambr_participants_insert on public.event_participants for insert to authenticated
  with check (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_participants_update on public.event_participants for update to authenticated
  using (user_id = auth.uid() and public.ambr_owner_active(auth.uid()))
  with check (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_participants_delete on public.event_participants for delete to authenticated
  using (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));

drop policy if exists ambr_routes_insert on public.shared_routes;
drop policy if exists ambr_routes_update on public.shared_routes;
drop policy if exists ambr_routes_delete on public.shared_routes;
create policy ambr_routes_insert on public.shared_routes for insert to authenticated
  with check (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_routes_update on public.shared_routes for update to authenticated
  using (user_id = auth.uid() and public.ambr_owner_active(auth.uid()))
  with check (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));
create policy ambr_routes_delete on public.shared_routes for delete to authenticated
  using (user_id = auth.uid() and public.ambr_owner_active(auth.uid()));

drop policy if exists ambr_midway_photos_delete on storage.objects;
drop policy if exists ambr_midway_photos_insert on storage.objects;
drop policy if exists ambr_midway_photos_update on storage.objects;
create policy ambr_midway_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'midway-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.ambr_owner_active(auth.uid())
  );
create policy ambr_midway_photos_update on storage.objects for update to authenticated
  using (
    bucket_id = 'midway-photos'
    and public.ambr_can_manage_storage_prefix((storage.foldername(name))[1], auth.uid())
    and public.ambr_owner_active(auth.uid())
  )
  with check (
    bucket_id = 'midway-photos'
    and public.ambr_can_manage_storage_prefix((storage.foldername(name))[1], auth.uid())
    and public.ambr_owner_active(auth.uid())
  );
create policy ambr_midway_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'midway-photos'
    and public.ambr_owner_active(auth.uid())
    and public.ambr_can_manage_storage_prefix(
      (storage.foldername(name))[1], auth.uid()
    )
  );

commit;
