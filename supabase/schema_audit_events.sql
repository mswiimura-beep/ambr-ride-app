-- READ ONLY: run in the Supabase SQL editor before reviewing or applying the
-- event ownership migration. This returns structure and counts, not row data.

select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('events', 'event_participants')
order by c.table_name, c.ordinal_position;

select n.nspname as schema_name, cls.relname as table_name, cls.relrowsecurity as rls_enabled
from pg_class cls
join pg_namespace n on n.oid = cls.relnamespace
where n.nspname = 'public'
  and cls.relname in ('events', 'event_participants');

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('events', 'event_participants')
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('events', 'event_participants')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

select 'events_without_creator' as check_name, count(*) as problem_count
from public.events where creator_id is null
union all
select 'participants_without_user', count(*)
from public.event_participants where user_id is null
union all
select 'duplicate_participants', count(*)
from (
  select event_id, user_id
  from public.event_participants
  group by event_id, user_id
  having count(*) > 1
) duplicates;

select tc.table_name, tc.constraint_name, tc.constraint_type,
       string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_name = tc.table_name
where tc.table_schema = 'public'
  and tc.table_name in ('events', 'event_participants')
group by tc.table_name, tc.constraint_name, tc.constraint_type
order by tc.table_name, tc.constraint_type, tc.constraint_name;
