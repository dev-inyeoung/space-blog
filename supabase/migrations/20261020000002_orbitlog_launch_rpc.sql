-- 글 created_at 은 API 요청에서 항상 서버 시각 (레이트 리밋 우회 방지)
-- launch_planet() 안에서만 일괄 insert 를 허용한다 (로컬 이관 M-1).
create or replace function public.posts_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.created_at := now();
  end if;
  if coalesce(current_setting('orbitlog.bulk', true), '') = 'on' then
    return new;
  end if;
  if (select count(*) from public.posts
      where planet_id = new.planet_id and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'rate limit: too many posts' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.posts_rate_limit() from public, anon, authenticated;

-- 행성 + 글을 한 트랜잭션으로 발사. 생성(글 1개)과 로컬 이관(글 N개) 겸용.
create or replace function public.launch_planet(planet jsonb, posts jsonb default '[]'::jsonb)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pid text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(posts) <> 'array' or jsonb_array_length(posts) > 200 then
    raise exception 'invalid posts' using errcode = '22023';
  end if;

  insert into public.planets (id, owner_id, is_seed, name, author, handle, orbit, look)
  values (
    coalesce(planet->>'id', 'u-' || substr(md5(random()::text), 1, 10)),
    uid, false,
    planet->>'name', planet->>'author', planet->>'handle',
    planet->'orbit', planet->'look'
  )
  returning id into pid;

  perform set_config('orbitlog.bulk', 'on', true);
  insert into public.posts (planet_id, date, title, body)
  select pid, (p->>'date')::date, p->>'title', coalesce(p->>'body', '')
  from jsonb_array_elements(posts) as p;
  perform set_config('orbitlog.bulk', 'off', true);

  return pid;
end $$;
revoke execute on function public.launch_planet(jsonb, jsonb) from public, anon;
grant execute on function public.launch_planet(jsonb, jsonb) to authenticated;
