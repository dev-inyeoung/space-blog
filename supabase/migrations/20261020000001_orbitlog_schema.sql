-- ORBIT.LOG 스키마 + RLS (PRD §6, §7)

-- 행성 -----------------------------------------------------------------
create table public.planets (
  id          text primary key default ('u-' || substr(md5(random()::text), 1, 10))
              check (id ~ '^[a-z0-9-]{2,40}$'),
  owner_id    uuid unique default auth.uid() references auth.users(id) on delete cascade,  -- NULL = 시드
  is_seed     boolean not null default false,
  name        text not null check (char_length(name) between 1 and 24),
  author      text not null check (char_length(author) between 1 and 24),
  handle      text not null check (char_length(handle) between 2 and 17),
  orbit       jsonb not null,   -- { a, e, inc, node, peri, phase }
  look        jsonb not null,   -- { size, tex, pal, ring, tilt, spin, seed }
  created_at  timestamptz not null default now(),
  -- 엔진이 깨지지 않는 범위만 허용 (randomSpec / completeSpec 기준)
  constraint orbit_range check (
    jsonb_typeof(orbit->'a') = 'number' and jsonb_typeof(orbit->'e') = 'number' and
    (orbit->>'a')::float between 5.5 and 45 and
    (orbit->>'e')::float between 0 and 0.9
  ),
  -- tex 목록은 engine.js 의 TEXTURES 와 반드시 일치
  constraint look_range check (
    jsonb_typeof(look->'size') = 'number' and
    (look->>'size')::float between 0.3 and 2.0 and
    look->>'tex' in ('bands','storm','spots','craters','ice','lava','swirl')
  )
);

-- 글 -------------------------------------------------------------------
create table public.posts (
  id          bigint generated always as identity primary key,
  planet_id   text not null references public.planets(id) on delete cascade,
  date        date not null,
  title       text not null check (char_length(title) between 1 and 80),
  body        text not null check (char_length(body) <= 20000),
  created_at  timestamptz not null default now()
);
create index on public.posts (planet_id, date desc);

-- 충돌 기록 (개인) -----------------------------------------------------
create table public.encounters (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  other_id    text not null references public.planets(id) on delete cascade,
  at          timestamptz not null default now()
);
create index on public.encounters (user_id, at desc);
create index on public.encounters (other_id);

-- RLS ------------------------------------------------------------------
alter table public.planets    enable row level security;
alter table public.posts      enable row level security;
alter table public.encounters enable row level security;

create policy planets_select on public.planets for select to anon, authenticated using (true);
create policy planets_insert on public.planets for insert to authenticated
  with check (owner_id = (select auth.uid()) and is_seed = false);
create policy planets_delete on public.planets for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy posts_select on public.posts for select to anon, authenticated using (true);
create policy posts_insert on public.posts for insert to authenticated
  with check (exists (select 1 from public.planets p where p.id = planet_id and p.owner_id = (select auth.uid())));
create policy posts_update on public.posts for update to authenticated
  using (exists (select 1 from public.planets p where p.id = planet_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.planets p where p.id = planet_id and p.owner_id = (select auth.uid())));
create policy posts_delete on public.posts for delete to authenticated
  using (exists (select 1 from public.planets p where p.id = planet_id and p.owner_id = (select auth.uid())));

create policy encounters_select on public.encounters for select to authenticated
  using (user_id = (select auth.uid()));
create policy encounters_insert on public.encounters for insert to authenticated
  with check (user_id = (select auth.uid()));

-- 남용 방지: 행성당 분당 글 5건 ------------------------------------------
create or replace function public.posts_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.posts
      where planet_id = new.planet_id and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'rate limit: too many posts' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.posts_rate_limit() from public, anon, authenticated;
create trigger posts_rate_limit before insert on public.posts
  for each row execute function public.posts_rate_limit();

-- Realtime ---------------------------------------------------------------
alter publication supabase_realtime add table public.planets, public.posts;
