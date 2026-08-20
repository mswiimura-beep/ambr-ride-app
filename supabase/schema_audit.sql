-- Read-only audit for the AMBR shared-data schema.
-- Run in the Supabase SQL editor before reviewing the migration. This file does
-- not change schema or data and intentionally returns counts, not row contents.

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'midway_posts', 'midway_post_reactions', 'midway_post_comments',
    'events', 'event_participants', 'shared_routes'
  )
order by table_name, ordinal_position;

select tc.table_name, tc.constraint_name, tc.constraint_type,
       string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_name = tc.table_name
where tc.table_schema = 'public'
  and tc.table_name in (
    'midway_posts', 'midway_post_reactions', 'midway_post_comments',
    'events', 'event_participants', 'shared_routes'
  )
group by tc.table_name, tc.constraint_name, tc.constraint_type
order by tc.table_name, tc.constraint_type, tc.constraint_name;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in (
    'midway_posts', 'midway_post_reactions', 'midway_post_comments',
    'events', 'event_participants', 'shared_routes'
  ))
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in (
    'midway_posts', 'midway_post_reactions', 'midway_post_comments',
    'events', 'event_participants', 'shared_routes'
  )
order by table_name, grantee, privilege_type;

select 'midway_posts_without_owner' as check_name, count(*) as problem_count
from public.midway_posts where user_id is null
union all
select 'reactions_without_owner', count(*) from public.midway_post_reactions where user_id is null
union all
select 'comments_without_owner', count(*) from public.midway_post_comments where user_id is null
union all
select 'events_without_owner', count(*) from public.events where creator_id is null
union all
select 'participants_without_owner', count(*) from public.event_participants where user_id is null
union all
select 'shared_routes_without_owner', count(*) from public.shared_routes where user_id is null
union all
select 'duplicate_posts', count(*) from (
  select user_id, client_post_id from public.midway_posts
  group by user_id, client_post_id having count(*) > 1
) duplicates
union all
select 'duplicate_reactions', count(*) from (
  select post_id, user_id, reaction from public.midway_post_reactions
  group by post_id, user_id, reaction having count(*) > 1
) duplicates
union all
select 'duplicate_comment_client_ids', count(*) from (
  select user_id, to_jsonb(c)->>'client_comment_id' as client_comment_id
  from public.midway_post_comments c
  where to_jsonb(c)->>'client_comment_id' is not null
  group by user_id, to_jsonb(c)->>'client_comment_id' having count(*) > 1
) duplicates
union all
select 'duplicate_event_client_ids', count(*) from (
  select creator_id, to_jsonb(e)->>'client_event_id' as client_event_id
  from public.events e
  where to_jsonb(e)->>'client_event_id' is not null
  group by creator_id, to_jsonb(e)->>'client_event_id' having count(*) > 1
) duplicates
union all
select 'duplicate_participants', count(*) from (
  select event_id, user_id from public.event_participants
  group by event_id, user_id having count(*) > 1
) duplicates
union all
select 'duplicate_shared_routes', count(*) from (
  select user_id, client_ride_id from public.shared_routes
  group by user_id, client_ride_id having count(*) > 1
) duplicates;

select 'post_photo_path_missing_from_storage' as check_name, count(*) as problem_count
from public.midway_posts p
cross join lateral (
  select p.photo_path as path where p.photo_path is not null
  union
  select value from jsonb_array_elements_text(coalesce(to_jsonb(p)->'photo_paths', '[]'::jsonb)) as valueset(value)
) as paths
where path is not null
  and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'midway-photos' and o.name = path
  )
union all
select 'storage_object_without_post_reference', count(*)
from storage.objects o
where o.bucket_id = 'midway-photos'
  and not exists (
    select 1 from public.midway_posts p
    where o.name = p.photo_path
       or exists (
         select 1
         from jsonb_array_elements_text(coalesce(to_jsonb(p)->'photo_paths', '[]'::jsonb)) as valueset(value)
         where value = o.name
       )
  );
