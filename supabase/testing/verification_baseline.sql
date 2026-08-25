-- Verification-project scaffold matching the production AMBR table shapes.
-- Synthetic test data only. Never apply this file to production.

create table public.midway_posts (
  id uuid primary key default gen_random_uuid(),
  client_post_id uuid not null unique,
  user_id uuid not null default auth.uid(),
  author_name text not null check (char_length(btrim(author_name)) between 1 and 30),
  place_name text not null check (char_length(btrim(place_name)) between 1 and 80),
  comment text not null default '' check (char_length(comment) <= 500),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  photo_path text not null check (char_length(photo_path) between 3 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  photo_paths text[] not null default '{}'::text[] check (cardinality(photo_paths) between 0 and 5)
);

create table public.midway_post_reactions (
  post_id uuid not null,
  user_id uuid not null default auth.uid(),
  reaction text not null check (reaction in ('like', 'photo', 'ride')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, reaction)
);

create table public.midway_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  user_id uuid not null default auth.uid(),
  author_name text not null check (char_length(btrim(author_name)) between 1 and 30),
  body text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now()
);

create table public.events (
  id bigint generated always as identity primary key,
  creator_id uuid not null default auth.uid(),
  creator_name text not null check (char_length(btrim(creator_name)) between 1 and 30),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  event_date date not null,
  start_time time,
  location_name text not null check (char_length(btrim(location_name)) between 1 and 120),
  latitude double precision,
  longitude double precision,
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  route_url text check (route_url is null or char_length(route_url) <= 4096),
  route_points jsonb check (route_points is null or (jsonb_typeof(route_points) = 'array' and jsonb_array_length(route_points) between 2 and 500)),
  route_distance_km numeric check (route_distance_km is null or route_distance_km between 0 and 5000),
  route_duration_minutes integer check (route_duration_minutes is null or route_duration_minutes between 0 and 10080)
);

create table public.event_participants (
  event_id bigint not null,
  user_id uuid not null default auth.uid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 30),
  joined_at timestamptz not null default now(),
  participation_type text not null default 'start',
  join_time time,
  join_location_name text,
  join_latitude double precision,
  join_longitude double precision,
  primary key (event_id, user_id)
);

create table public.shared_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_ride_id text not null check (char_length(client_ride_id) between 1 and 80),
  owner_name text not null check (char_length(btrim(owner_name)) between 1 and 30),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  ride_date date,
  distance_km numeric check (distance_km is null or distance_km between 0 and 5000),
  route_points jsonb not null check (jsonb_typeof(route_points) = 'array' and jsonb_array_length(route_points) between 2 and 500),
  source_url text check (source_url is null or char_length(source_url) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
