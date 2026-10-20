-- encounters.at 은 클라이언트 시각이라 서버보다 늦을 수 있다 → 행성 생성 시각 비교에 10분 여유.
create or replace function public.can_sign(host text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.planets w
    join public.planets h on h.id = host and h.id <> w.id
    where w.owner_id = auth.uid()
      and (
        exists (select 1 from public.encounters e
                where e.user_id = w.owner_id and e.other_id = h.id
                  and e.at >= w.created_at - interval '10 minutes')
        or (h.owner_id is not null and exists (
                select 1 from public.encounters e
                where e.user_id = h.owner_id and e.other_id = w.id
                  and e.at >= h.created_at - interval '10 minutes'))
      )
  );
$$;
