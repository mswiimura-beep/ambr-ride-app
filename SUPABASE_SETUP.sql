-- Supabase Dashboard > SQL Editor で全体を1回実行してください。
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  created_at timestamptz not null default now()
);

create table if not exists public.photo_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  thumbnail_path text,
  caption text not null default '' check (char_length(caption) <= 200),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  created_at timestamptz not null default now(),
  check ((lat is null and lng is null) or (lat is not null and lng is not null))
);

alter table public.profiles enable row level security;
alter table public.photo_posts enable row level security;

drop policy if exists "members read profiles" on public.profiles;
create policy "members read profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "owner updates profile" on public.profiles;
create policy "owner updates profile" on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);

drop policy if exists "members read photos" on public.photo_posts;
create policy "members read photos" on public.photo_posts for select to authenticated using (true);
drop policy if exists "owner creates photos" on public.photo_posts;
create policy "owner creates photos" on public.photo_posts for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "owner deletes photos" on public.photo_posts;
create policy "owner deletes photos" on public.photo_posts for delete to authenticated using ((select auth.uid())=user_id);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('ride-photos','ride-photos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "members read photo files" on storage.objects;
create policy "members read photo files" on storage.objects for select to authenticated using (bucket_id='ride-photos');
drop policy if exists "owner uploads photo files" on storage.objects;
create policy "owner uploads photo files" on storage.objects for insert to authenticated with check (bucket_id='ride-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "owner deletes photo files" on storage.objects;
create policy "owner deletes photo files" on storage.objects for delete to authenticated using (bucket_id='ride-photos' and owner_id=(select auth.uid()::text));

create or replace function public.create_ambr_profile()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'メンバー'))
  on conflict(id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_ambr_profile_after_signup on auth.users;
create trigger create_ambr_profile_after_signup after insert on auth.users
for each row execute function public.create_ambr_profile();

alter table public.photo_posts add column if not exists thumbnail_path text;
create index if not exists photo_posts_user_created_idx on public.photo_posts(user_id,created_at desc);

create table if not exists public.planned_routes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null, ride_date date, notes text not null default '', special_stops text not null default '',
  distance double precision not null default 0, duration double precision not null default 0,
  geometry jsonb not null default '[]', points jsonb not null default '[]', legs jsonb not null default '[]',
  created_at timestamptz not null default now()
);
alter table public.planned_routes enable row level security;
drop policy if exists "members read shared routes" on public.planned_routes;
create policy "members read shared routes" on public.planned_routes for select to authenticated using (true);
drop policy if exists "owner creates shared routes" on public.planned_routes;
create policy "owner creates shared routes" on public.planned_routes for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "owner deletes shared routes" on public.planned_routes;
create policy "owner deletes shared routes" on public.planned_routes for delete to authenticated using ((select auth.uid())=user_id);
create index if not exists planned_routes_created_idx on public.planned_routes(created_at desc);
