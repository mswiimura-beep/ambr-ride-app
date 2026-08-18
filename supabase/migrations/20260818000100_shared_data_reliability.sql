-- PROPOSAL ONLY: review schema_audit.sql output and take a backup before applying.
-- This migration assumes the six AMBR tables and their current columns already
-- exist. It replaces public-table policies with an authenticated-read / owner-
-- write model. Anonymous sign-in receives the authenticated role in Supabase.

begin;

do $$
declare
  missing_table text;
begin
  select expected.name into missing_table
  from (values
    ('midway_posts'), ('midway_post_reactions'), ('midway_post_comments'),
    ('events'), ('event_participants'), ('shared_routes')
  ) expected(name)
  where to_regclass('public.' || expected.name) is null
  limit 1;
  if missing_table is not null then
    raise exception 'Required AMBR table is missing: %', missing_table;
  end if;

  if exists (select 1 from public.midway_posts where user_id is null)
     or exists (select 1 from public.midway_post_reactions where user_id is null)
     or exists (select 1 from public.midway_post_comments where user_id is null)
     or exists (select 1 from public.events where creator_id is null)
     or exists (select 1 from public.event_participants where user_id is null)
     or exists (select 1 from public.shared_routes where user_id is null) then
    raise exception 'Ownerless rows exist. Resolve them manually before applying ownership constraints.';
  end if;
  if exists (select 1 from public.midway_posts group by user_id, client_post_id having count(*) > 1)
     or exists (select 1 from public.midway_post_reactions group by post_id, user_id, reaction having count(*) > 1)
     or exists (select 1 from public.event_participants group by event_id, user_id having count(*) > 1)
     or exists (select 1 from public.shared_routes group by user_id, client_ride_id having count(*) > 1) then
    raise exception 'Duplicate identity rows exist. Resolve them manually before adding uniqueness constraints.';
  end if;
end $$;

alter table public.midway_posts alter column user_id set default auth.uid();
alter table public.midway_posts alter column user_id set not null;
alter table public.events alter column creator_id set default auth.uid();
alter table public.events alter column creator_id set not null;
alter table public.shared_routes alter column user_id set default auth.uid();
alter table public.shared_routes alter column user_id set not null;
alter table public.midway_post_reactions alter column user_id set default auth.uid();
alter table public.midway_post_reactions alter column user_id set not null;
alter table public.midway_post_comments alter column user_id set default auth.uid();
alter table public.midway_post_comments alter column user_id set not null;
alter table public.event_participants alter column user_id set default auth.uid();
alter table public.event_participants alter column user_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'midway_posts_user_client_key') then
    alter table public.midway_posts
      add constraint midway_posts_user_client_key unique (user_id, client_post_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'midway_post_reactions_identity_key') then
    alter table public.midway_post_reactions
      add constraint midway_post_reactions_identity_key unique (post_id, user_id, reaction);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_participants_identity_key') then
    alter table public.event_participants
      add constraint event_participants_identity_key unique (event_id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shared_routes_user_client_key') then
    alter table public.shared_routes
      add constraint shared_routes_user_client_key unique (user_id, client_ride_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'midway_reaction_kind_check') then
    alter table public.midway_post_reactions
      add constraint midway_reaction_kind_check check (reaction in ('like', 'photo', 'ride')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'midway_comment_body_length_check') then
    alter table public.midway_post_comments
      add constraint midway_comment_body_length_check check (char_length(btrim(body)) between 1 and 300) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_participation_type_check') then
    alter table public.event_participants
      add constraint event_participation_type_check check (participation_type in ('start', 'join_later')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'midway_posts_owner_fkey') then
    alter table public.midway_posts add constraint midway_posts_owner_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'midway_reactions_post_fkey') then
    alter table public.midway_post_reactions add constraint midway_reactions_post_fkey
      foreign key (post_id) references public.midway_posts(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'midway_reactions_owner_fkey') then
    alter table public.midway_post_reactions add constraint midway_reactions_owner_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'midway_comments_post_fkey') then
    alter table public.midway_post_comments add constraint midway_comments_post_fkey
      foreign key (post_id) references public.midway_posts(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'midway_comments_owner_fkey') then
    alter table public.midway_post_comments add constraint midway_comments_owner_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_owner_fkey') then
    alter table public.events add constraint events_owner_fkey
      foreign key (creator_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_participants_event_fkey') then
    alter table public.event_participants add constraint event_participants_event_fkey
      foreign key (event_id) references public.events(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_participants_owner_fkey') then
    alter table public.event_participants add constraint event_participants_owner_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shared_routes_owner_fkey') then
    alter table public.shared_routes add constraint shared_routes_owner_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
end $$;

create index if not exists midway_posts_created_at_idx on public.midway_posts (created_at desc);
create index if not exists midway_post_reactions_post_idx on public.midway_post_reactions (post_id);
create index if not exists midway_post_comments_post_created_idx on public.midway_post_comments (post_id, created_at desc);
create index if not exists events_date_time_idx on public.events (event_date, start_time);
create index if not exists event_participants_event_idx on public.event_participants (event_id);
create index if not exists shared_routes_updated_idx on public.shared_routes (updated_at desc);

alter table public.midway_posts enable row level security;
alter table public.midway_post_reactions enable row level security;
alter table public.midway_post_comments enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.shared_routes enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'midway_posts', 'midway_post_reactions', 'midway_post_comments',
        'events', 'event_participants', 'shared_routes'
      )
  loop
    execute format('drop policy %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end $$;

create policy ambr_posts_read on public.midway_posts for select to authenticated using (true);
create policy ambr_posts_insert on public.midway_posts for insert to authenticated with check (user_id = auth.uid());
create policy ambr_posts_update on public.midway_posts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ambr_posts_delete on public.midway_posts for delete to authenticated using (user_id = auth.uid());

create policy ambr_reactions_read on public.midway_post_reactions for select to authenticated using (true);
create policy ambr_reactions_insert on public.midway_post_reactions for insert to authenticated with check (user_id = auth.uid());
create policy ambr_reactions_delete on public.midway_post_reactions for delete to authenticated using (user_id = auth.uid());

create policy ambr_comments_read on public.midway_post_comments for select to authenticated using (true);
create policy ambr_comments_insert on public.midway_post_comments for insert to authenticated with check (user_id = auth.uid());
create policy ambr_comments_update on public.midway_post_comments for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ambr_comments_delete on public.midway_post_comments for delete to authenticated using (user_id = auth.uid());

create policy ambr_events_read on public.events for select to authenticated using (true);
create policy ambr_events_insert on public.events for insert to authenticated with check (creator_id = auth.uid());
create policy ambr_events_update on public.events for update to authenticated using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy ambr_events_delete on public.events for delete to authenticated using (creator_id = auth.uid());

create policy ambr_participants_read on public.event_participants for select to authenticated using (true);
create policy ambr_participants_insert on public.event_participants for insert to authenticated with check (user_id = auth.uid());
create policy ambr_participants_update on public.event_participants for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ambr_participants_delete on public.event_participants for delete to authenticated using (user_id = auth.uid());

create policy ambr_routes_read on public.shared_routes for select to authenticated using (true);
create policy ambr_routes_insert on public.shared_routes for insert to authenticated with check (user_id = auth.uid());
create policy ambr_routes_update on public.shared_routes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ambr_routes_delete on public.shared_routes for delete to authenticated using (user_id = auth.uid());

revoke all on public.midway_posts, public.midway_post_reactions, public.midway_post_comments,
  public.events, public.event_participants, public.shared_routes from anon;
grant select, insert, update, delete on public.midway_posts, public.midway_post_reactions, public.midway_post_comments,
  public.events, public.event_participants, public.shared_routes to authenticated;

do $$
declare
  sequence_name text;
begin
  foreach sequence_name in array array[
    pg_get_serial_sequence('public.midway_posts', 'id'),
    pg_get_serial_sequence('public.midway_post_reactions', 'id'),
    pg_get_serial_sequence('public.midway_post_comments', 'id'),
    pg_get_serial_sequence('public.events', 'id'),
    pg_get_serial_sequence('public.shared_routes', 'id')
  ]
  loop
    if sequence_name is not null then
      execute format('grant usage, select on sequence %s to authenticated', sequence_name);
    end if;
  end loop;
end $$;

insert into storage.buckets (id, name, public)
values ('midway-photos', 'midway-photos', false)
on conflict (id) do update set public = false;

drop policy if exists ambr_midway_photos_read on storage.objects;
drop policy if exists ambr_midway_photos_insert on storage.objects;
drop policy if exists ambr_midway_photos_update on storage.objects;
drop policy if exists ambr_midway_photos_delete on storage.objects;
create policy ambr_midway_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'midway-photos');
create policy ambr_midway_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'midway-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy ambr_midway_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'midway-photos' and owner_id = auth.uid()::text)
  with check (bucket_id = 'midway-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy ambr_midway_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'midway-photos' and owner_id = auth.uid()::text);

-- Existing generic storage.objects policies are intentionally not removed here
-- because they may serve other buckets. Review schema_audit.sql output and remove
-- any broad policy that also grants write/delete access to midway-photos.

commit;
