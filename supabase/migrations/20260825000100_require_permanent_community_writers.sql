-- LOCAL PROPOSAL ONLY: do not apply until a permanent sign-in flow is available.
-- Anonymous Auth sessions keep read access through the existing SELECT policies.
-- Restrictive policies are ANDed with the existing owner/path policies, so a
-- permanent user must still own the row and use their own Storage folder.

drop policy if exists "permanent users create midway posts" on public.midway_posts;
create policy "permanent users create midway posts"
on public.midway_posts as restrictive
for insert to authenticated
with check (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false);

drop policy if exists "permanent users update midway posts" on public.midway_posts;
create policy "permanent users update midway posts"
on public.midway_posts as restrictive
for update to authenticated
using (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false)
with check (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false);

drop policy if exists "permanent users delete midway posts" on public.midway_posts;
create policy "permanent users delete midway posts"
on public.midway_posts as restrictive
for delete to authenticated
using (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false);

drop policy if exists "permanent users create midway reactions" on public.midway_post_reactions;
create policy "permanent users create midway reactions"
on public.midway_post_reactions as restrictive
for insert to authenticated
with check (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false);

drop policy if exists "permanent users delete midway reactions" on public.midway_post_reactions;
create policy "permanent users delete midway reactions"
on public.midway_post_reactions as restrictive
for delete to authenticated
using (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false);

drop policy if exists "permanent users create midway comments" on public.midway_post_comments;
create policy "permanent users create midway comments"
on public.midway_post_comments as restrictive
for insert to authenticated
with check (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false);

drop policy if exists "permanent users delete midway comments" on public.midway_post_comments;
create policy "permanent users delete midway comments"
on public.midway_post_comments as restrictive
for delete to authenticated
using (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false);

-- Scope each restrictive Storage policy to midway-photos. Other buckets keep
-- their current behaviour; writes to midway-photos require a permanent user.
drop policy if exists "permanent users upload midway photos" on storage.objects;
create policy "permanent users upload midway photos"
on storage.objects as restrictive
for insert to authenticated
with check (
  bucket_id <> 'midway-photos'
  or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false
);

drop policy if exists "permanent users update midway photos" on storage.objects;
create policy "permanent users update midway photos"
on storage.objects as restrictive
for update to authenticated
using (
  bucket_id <> 'midway-photos'
  or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false
)
with check (
  bucket_id <> 'midway-photos'
  or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false
);

drop policy if exists "permanent users delete midway photos" on storage.objects;
create policy "permanent users delete midway photos"
on storage.objects as restrictive
for delete to authenticated
using (
  bucket_id <> 'midway-photos'
  or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) is false
);
