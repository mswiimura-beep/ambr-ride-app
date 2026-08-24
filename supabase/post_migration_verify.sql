-- Read-only verification after both proposed AMBR migrations are applied in a
-- disposable/staging project. No row contents or email addresses are returned.

select 'rls_disabled' as check_name, count(*) as problem_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'midway_posts', 'midway_post_reactions', 'midway_post_comments',
    'events', 'event_participants', 'shared_routes', 'ownership_merge_audit'
  )
  and not c.relrowsecurity
union all
select 'merge_rpc_executable_by_client', count(*)
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'merge_anonymous_user_data'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
union all
select 'merge_audit_readable_by_client', count(*)
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'ownership_merge_audit'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
union all
select 'merged_source_posts_remaining', count(*)
from public.midway_posts row
where exists (select 1 from public.ownership_merge_audit audit where audit.source_user_id = row.user_id)
union all
select 'merged_source_reactions_remaining', count(*)
from public.midway_post_reactions row
where exists (select 1 from public.ownership_merge_audit audit where audit.source_user_id = row.user_id)
union all
select 'merged_source_comments_remaining', count(*)
from public.midway_post_comments row
where exists (select 1 from public.ownership_merge_audit audit where audit.source_user_id = row.user_id)
union all
select 'merged_source_events_remaining', count(*)
from public.events row
where exists (select 1 from public.ownership_merge_audit audit where audit.source_user_id = row.creator_id)
union all
select 'merged_source_participants_remaining', count(*)
from public.event_participants row
where exists (select 1 from public.ownership_merge_audit audit where audit.source_user_id = row.user_id)
union all
select 'merged_source_routes_remaining', count(*)
from public.shared_routes row
where exists (select 1 from public.ownership_merge_audit audit where audit.source_user_id = row.user_id);

select policyname, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in (
    'midway_posts', 'midway_post_reactions', 'midway_post_comments',
    'events', 'event_participants', 'shared_routes', 'ownership_merge_audit'
  ))
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;
