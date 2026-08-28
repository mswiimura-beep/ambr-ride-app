-- PROPOSAL ONLY. Do not apply until schema_audit_events.sql has been reviewed
-- and a Supabase backup has been taken.
--
-- The AMBR client signs in anonymously, but Supabase anonymous users receive
-- the `authenticated` database role. Anonymous sign-ins must be enabled before
-- this policy set is applied.

begin;

do $$
declare
  missing_table text;
begin
  select expected.name into missing_table
  from (values ('events'), ('event_participants')) expected(name)
  where to_regclass('public.' || expected.name) is null
  limit 1;
  if missing_table is not null then
    raise exception 'Required AMBR table is missing: %', missing_table;
  end if;

  if exists (select 1 from public.events where creator_id is null) then
    raise exception 'Ownerless events exist. Resolve them before applying RLS.';
  end if;
  if exists (select 1 from public.event_participants where user_id is null) then
    raise exception 'Ownerless participants exist. Resolve them before applying RLS.';
  end if;
  if exists (
    select 1 from public.event_participants
    group by event_id, user_id having count(*) > 1
  ) then
    raise exception 'Duplicate event participants exist. Resolve them before adding uniqueness.';
  end if;
end $$;

alter table public.events alter column creator_id set default auth.uid();
alter table public.events alter column creator_id set not null;
alter table public.event_participants alter column user_id set default auth.uid();
alter table public.event_participants alter column user_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.event_participants'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (event_id, user_id)'
  ) then
    alter table public.event_participants
      add constraint event_participants_identity_key unique (event_id, user_id);
  end if;
end $$;

create index if not exists events_date_time_idx
  on public.events (event_date, start_time);
create index if not exists event_participants_event_idx
  on public.event_participants (event_id);

alter table public.events enable row level security;
alter table public.event_participants enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('events', 'event_participants')
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

create policy ambr_events_read on public.events
  for select to authenticated using (true);
create policy ambr_events_insert on public.events
  for insert to authenticated with check (creator_id = auth.uid());
create policy ambr_events_update on public.events
  for update to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());
create policy ambr_events_delete on public.events
  for delete to authenticated using (creator_id = auth.uid());

create policy ambr_participants_read on public.event_participants
  for select to authenticated using (true);
create policy ambr_participants_insert on public.event_participants
  for insert to authenticated with check (user_id = auth.uid());
create policy ambr_participants_update on public.event_participants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy ambr_participants_delete on public.event_participants
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.events, public.event_participants from anon;
grant select, insert, update, delete
  on public.events, public.event_participants to authenticated;

do $$
declare
  sequence_name text;
begin
  foreach sequence_name in array array[
    pg_get_serial_sequence('public.events', 'id')
  ]
  loop
    if sequence_name is not null then
      execute format('grant usage, select on sequence %s to authenticated', sequence_name);
    end if;
  end loop;
end $$;

commit;
