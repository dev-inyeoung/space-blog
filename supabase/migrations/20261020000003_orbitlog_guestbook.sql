-- 방명록: 충돌한 행성끼리만 서로의 행성에 짧은 신호를 남긴다.

create table public.guestbook (
  id          bigint generated always as identity primary key,
  planet_id   text not null constraint guestbook_planet_fk references public.planets(id) on delete cascade,  -- 방명록 주인
  author_id   text not null constraint guestbook_author_fk references public.planets(id) on delete cascade,  -- 남긴 행성
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 280),
  created_at  timestamptz not null default now(),
  constraint guestbook_not_self check (planet_id <> author_id)
);
create index on public.guestbook (planet_id, created_at);
create index on public.guestbook (author_id);
create index on public.guestbook (owner_id);

-- 내 행성(auth.uid() 소유)이 host 와 충돌한 적이 있는가.
-- 어느 쪽 브라우저에서 기록됐든 인정한다: 내가 host 에 부딪혔거나, host 주인이 내 행성에 부딪혔거나.
-- 충돌 시각은 각자 행성 생성 이후여야 한다 (폐기 후 재생성한 행성에 예전 기록이 붙지 않도록).
create or replace function public.can_sign(host text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.planets w
    join public.planets h on h.id = host and h.id <> w.id
    where w.owner_id = auth.uid()
      and (
        exists (select 1 from public.encounters e
                where e.user_id = w.owner_id and e.other_id = h.id and e.at >= w.created_at)
        or (h.owner_id is not null and exists (
                select 1 from public.encounters e
                where e.user_id = h.owner_id and e.other_id = w.id and e.at >= h.created_at))
      )
  );
$$;
revoke execute on function public.can_sign(text) from public, anon;
grant execute on function public.can_sign(text) to authenticated;

alter table public.guestbook enable row level security;

create policy guestbook_select on public.guestbook for select to anon, authenticated using (true);
create policy guestbook_insert on public.guestbook for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.planets p where p.id = author_id and p.owner_id = (select auth.uid()))
    and public.can_sign(planet_id)
  );
-- 쓴 사람, 또는 방명록 주인이 지울 수 있다
create policy guestbook_delete on public.guestbook for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.planets p where p.id = planet_id and p.owner_id = (select auth.uid()))
  );

-- 남용 방지: 사람당 분당 3건, created_at 은 항상 서버 시각
create or replace function public.guestbook_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  if (select count(*) from public.guestbook
      where owner_id = new.owner_id and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'rate limit: too many signals' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.guestbook_rate_limit() from public, anon, authenticated;
create trigger guestbook_rate_limit before insert on public.guestbook
  for each row execute function public.guestbook_rate_limit();

alter publication supabase_realtime add table public.guestbook;
