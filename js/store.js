/*!
 * ORBIT.LOG — Store
 * LocalStore(브라우저 전용)와 SupabaseStore(공유 우주)가 같은 인터페이스를 구현한다.
 *   snapshot()                 → { planets, me, log }  동기. 첫 프레임용 (시드 + 로컬 캐시)
 *   async init()               → { canWrite }          세션 확보 + 로컬 이관(M-1) + 충돌 재전송(E-3)
 *   async loadUniverse()       → { planets, me, log }  서버 기준 전체 우주
 *   async createPlanet(d) / addPost(id, post) / destroyPlanet(id) / logEncounter(otherId, at)
 *   async signGuestbook(hostId, fromId, body) → entry / eraseGuestbook(entryId)
 *   async canSign(hostId)      → boolean           상대 쪽에서 기록된 충돌까지 포함한 서버 판정
 *   subscribe({ onPlanet, onPlanetGone, onPost, onGuest, onGuestGone })     Realtime
 * planet.guestbook = [{ id, from, body, at }]  (from = 남긴 행성 id, at = ms)
 * config.js 가 있으면 SupabaseStore, 없으면 LocalStore.
 */
(function () {
  'use strict';

  const KEY = 'orbitlog.v1', CACHE = 'orbitlog.cache', QUEUE = 'orbitlog.queue';
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const seeds = () => clone(window.ORBIT_SEEDS || []);

  function loadLegacy() {
    const s = read(KEY);
    const gb = s && Array.isArray(s.guestbook) ? s.guestbook : [];
    if (s && Array.isArray(s.planets)) return { planets: s.planets, me: s.me || null, log: Array.isArray(s.log) ? s.log : [], guestbook: gb, migrated: !!s.migrated };
    return { planets: [], me: null, log: [], guestbook: gb, migrated: false };
  }

  /* ======================================================================
     LOCAL — localStorage 전용 (config.js 없음)
     ====================================================================== */
  function LocalStore() {
    const s = loadLegacy();
    const save = () => write(KEY, { planets: s.planets, me: s.me, log: s.log, guestbook: s.guestbook, migrated: s.migrated });
    const universe = () => {
      const planets = seeds().concat(clone(s.planets));
      const ids = new Set(planets.map((p) => p.id));
      planets.forEach((p) => {
        p.guestbook = s.guestbook.filter((g) => g.planet === p.id && ids.has(g.from)).map((g) => ({ id: g.id, from: g.from, body: g.body, at: g.at }));
      });
      return { planets, me: s.me, log: clone(s.log) };
    };
    return {
      mode: 'local',
      snapshot: universe,
      async init() { return { canWrite: true }; },
      async loadUniverse() { return universe(); },
      async createPlanet(d) { s.planets.push(clone(d)); s.me = d.id; save(); return d; },
      async addPost(id, post) {
        const p = s.planets.find((x) => x.id === id);
        if (!p) throw new Error('planet not found');
        p.posts.push(clone(post)); save();
        return post;
      },
      async destroyPlanet(id) {
        s.planets = s.planets.filter((p) => p.id !== id);
        s.guestbook = s.guestbook.filter((g) => g.planet !== id && g.from !== id);
        if (s.me === id) s.me = null;
        save();
      },
      async logEncounter(otherId, at) { s.log.push({ id: otherId, at }); save(); },
      async signGuestbook(hostId, fromId, body) {
        const g = { id: 'l-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), planet: hostId, from: fromId, body: String(body).slice(0, 280), at: Date.now() };
        s.guestbook.push(g); save();
        return { id: g.id, from: g.from, body: g.body, at: g.at };
      },
      async eraseGuestbook(id) { s.guestbook = s.guestbook.filter((g) => g.id !== id); save(); },
      // 로컬 모드에서는 내 충돌 기록(log)만이 근거다
      async canSign() { return false; },
      subscribe() {},
    };
  }

  /* ======================================================================
     SUPABASE — 공유 우주
     ====================================================================== */
  function SupabaseStore(cfg) {
    // CDN 스크립트가 못 떴으면(오프라인) sb 없이 캐시만으로 동작한다.
    const sb = window.supabase && window.supabase.createClient
      ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'orbitlog.auth' } })
      : null;
    let uid = null, ready = null;
    let u = null; // 마지막으로 알려진 우주 → orbitlog.cache
    const saveCache = () => { if (u) write(CACHE, u); };

    const toPost = (r) => ({ id: r.id, date: r.date, title: r.title, body: r.body });
    const toGuest = (r) => ({ id: r.id, from: r.author_id, body: r.body, at: Date.parse(r.created_at) });
    const toPlanet = (r) => ({
      id: r.id, name: r.name, author: r.author, handle: r.handle,
      createdAt: String(r.created_at || '').slice(0, 10), bornAt: Date.parse(r.created_at) || 0,
      orbit: r.orbit, look: r.look, seed: !!r.is_seed,
      user: !!uid && r.owner_id === uid,
      posts: (r.posts || []).map(toPost),
      guestbook: (r.guestbook || []).map(toGuest).sort((a, b) => a.at - b.at),
    });
    const findPlanet = (id) => u && u.planets.find((x) => x.id === id);
    const planetRow = (d) => ({
      id: d.id, name: String(d.name).slice(0, 24), author: String(d.author).slice(0, 24),
      handle: String(d.handle || '@' + d.author).slice(0, 17), orbit: d.orbit, look: d.look,
    });
    const postRow = (p) => ({ date: p.date, title: String(p.title).slice(0, 80) || '(무제)', body: String(p.body || '').slice(0, 20000) });

    function requireWrite() {
      if (uid) return;
      const e = new Error('read-only'); e.code = 'readonly';
      throw e;
    }

    const queue = () => { const q = read(QUEUE); return Array.isArray(q) ? q : []; };
    async function flushQueue() {
      const q = queue();
      if (!q.length) return;
      const { error } = await sb.from('encounters').insert(q);
      if (!error) { write(QUEUE, []); return; }
      // 23503: 상대 행성이 폐기됨 → 하나씩 보내고 그런 건 버린다
      if (error.code !== '23503') return;
      const keep = [];
      for (const row of q) {
        const r = await sb.from('encounters').insert(row);
        if (r.error && r.error.code !== '23503') keep.push(row);
      }
      write(QUEUE, keep);
    }

    /** M-1 / M-2 / M-3: orbitlog.v1 의 내 행성·글·충돌 기록을 서버로 한 번만 옮긴다. */
    async function migrateLocal() {
      const s = read(KEY);
      if (!s || s.migrated || !s.me || !Array.isArray(s.planets)) return;
      const mine = s.planets.find((p) => p.id === s.me);
      if (mine) {
        const own = await sb.from('planets').select('id').eq('owner_id', uid).maybeSingle();
        if (own.error) throw own.error;
        if (!own.data) {
          const r = await sb.rpc('launch_planet', { planet: planetRow(mine), posts: (mine.posts || []).map(postRow) });
          if (r.error && r.error.code !== '23505') throw r.error; // 23505: 이미 올라간 id
          const seedIds = new Set((window.ORBIT_SEEDS || []).map((x) => x.id));
          const rows = (s.log || []).filter((l) => seedIds.has(l.id)).map((l) => ({ other_id: l.id, at: new Date(l.at).toISOString() }));
          if (!r.error && rows.length) await sb.from('encounters').insert(rows);
        }
      }
      s.migrated = true; // 원본은 1 버전 동안 남겨 둔다
      write(KEY, s);
    }

    const S = {
      mode: 'supabase',

      snapshot() {
        const c = read(CACHE);
        if (c && Array.isArray(c.planets)) return clone(c);
        // 첫 접속: 시드 + (이관 전이라면) 로컬 행성
        const s = loadLegacy();
        if (s.migrated) return { planets: seeds(), me: null, log: [] };
        return { planets: seeds().concat(clone(s.planets)), me: s.me, log: clone(s.log) };
      },

      init() {
        return ready || (ready = (async () => {
          if (!sb) return { canWrite: false };
          try {
            const { data } = await sb.auth.getSession();
            let user = data && data.session ? data.session.user : null;
            if (!user) {
              const r = await sb.auth.signInAnonymously();
              if (r.error) throw r.error;
              user = r.data.user;
            }
            uid = user.id;
          } catch (e) {
            console.warn('[orbitlog] auth unavailable → read-only', e);
            uid = null;
          }
          if (uid) {
            await migrateLocal().catch((e) => console.warn('[orbitlog] local migration failed', e));
            await flushQueue().catch(() => {});
          }
          return { canWrite: !!uid };
        })());
      },

      async loadUniverse() {
        await S.init();
        if (!sb) throw new Error('offline');
        const { data, error } = await sb.from('planets')
          .select('id, owner_id, is_seed, name, author, handle, orbit, look, created_at, posts(id, date, title, body), guestbook!guestbook_planet_fk(id, author_id, body, created_at)')
          .order('created_at', { ascending: true });
        if (error) throw error;
        let log = [];
        if (uid) {
          const r = await sb.from('encounters').select('other_id, at').order('at', { ascending: true });
          if (!r.error) log = r.data.map((e) => ({ id: e.other_id, at: Date.parse(e.at) }));
        }
        log = log.concat(queue().map((q) => ({ id: q.other_id, at: Date.parse(q.at) })));
        const planets = data.map(toPlanet);
        const mine = planets.find((p) => p.user);
        u = { planets, me: mine ? mine.id : null, log };
        saveCache();
        return clone(u);
      },

      async createPlanet(d) {
        await S.init(); requireWrite();
        const { error } = await sb.rpc('launch_planet', { planet: planetRow(d), posts: (d.posts || []).map(postRow) });
        if (error) throw error;
        if (u) { u.planets.push(clone(d)); u.me = d.id; saveCache(); }
        return d;
      },

      async addPost(id, post) {
        await S.init(); requireWrite();
        const { data, error } = await sb.from('posts').insert(Object.assign({ planet_id: id }, postRow(post))).select('id').single();
        if (error) throw error;
        post.id = data.id;
        const p = u && u.planets.find((x) => x.id === id);
        if (p) { p.posts.push(clone(post)); saveCache(); }
        return post;
      },

      async destroyPlanet(id) {
        await S.init(); requireWrite();
        const { data, error } = await sb.from('planets').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data.length) { const e = new Error('not owner'); e.code = 'readonly'; throw e; }
        if (u) { u.planets = u.planets.filter((p) => p.id !== id); if (u.me === id) u.me = null; saveCache(); }
      },

      /** 실패해도 던지지 않는다. 큐에 쌓았다가 다음 접속 때 재전송(E-3). */
      async logEncounter(otherId, at) {
        const row = { other_id: otherId, at: new Date(at).toISOString() };
        if (u) { u.log.push({ id: otherId, at }); saveCache(); }
        await S.init();
        if (!uid) return;
        const { error } = await sb.from('encounters').insert(row);
        if (error && error.code !== '23503') write(QUEUE, queue().concat([row]));
      },

      async signGuestbook(hostId, fromId, body) {
        await S.init(); requireWrite();
        // 방금 난 충돌이 아직 큐에 있으면 먼저 올려야 RLS(can_sign)를 통과한다
        await flushQueue().catch(() => {});
        const { data, error } = await sb.from('guestbook')
          .insert({ planet_id: hostId, author_id: fromId, body: String(body).slice(0, 280) })
          .select('id, author_id, body, created_at').single();
        if (error) throw error;
        const g = toGuest(data);
        const p = findPlanet(hostId);
        if (p && !p.guestbook.some((x) => x.id === g.id)) { p.guestbook.push(clone(g)); saveCache(); }
        return g;
      },

      async eraseGuestbook(id) {
        await S.init(); requireWrite();
        const { data, error } = await sb.from('guestbook').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data.length) { const e = new Error('not owner'); e.code = 'readonly'; throw e; }
        if (u) { u.planets.forEach((p) => { p.guestbook = (p.guestbook || []).filter((g) => g.id !== id); }); saveCache(); }
      },

      async canSign(hostId) {
        await S.init();
        if (!uid) return false;
        const { data, error } = await sb.rpc('can_sign', { host: hostId });
        return !error && data === true;
      },

      subscribe(h) {
        if (!sb) return;
        sb.channel('universe')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'planets' }, (m) => {
            const p = toPlanet(m.new);
            if (u && !u.planets.some((x) => x.id === p.id)) { u.planets.push(clone(p)); saveCache(); }
            if (h.onPlanet) h.onPlanet(p);
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planets' }, (m) => {
            const id = m.old && m.old.id;
            if (!id) return;
            if (u) { u.planets = u.planets.filter((x) => x.id !== id); if (u.me === id) u.me = null; saveCache(); }
            if (h.onPlanetGone) h.onPlanetGone(id);
          })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (m) => {
            const post = toPost(m.new), pid = m.new.planet_id;
            const p = u && u.planets.find((x) => x.id === pid);
            if (p && pid !== u.me && !p.posts.some((x) => x.id === post.id)) { p.posts.push(clone(post)); saveCache(); }
            if (h.onPost) h.onPost(pid, post);
          })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guestbook' }, (m) => {
            const g = toGuest(m.new), pid = m.new.planet_id;
            const p = findPlanet(pid);
            if (p && !(p.guestbook || (p.guestbook = [])).some((x) => x.id === g.id)) { p.guestbook.push(clone(g)); saveCache(); }
            if (h.onGuest) h.onGuest(pid, g);
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'guestbook' }, (m) => {
            const id = m.old && m.old.id;
            if (!id) return;
            if (u) { u.planets.forEach((p) => { p.guestbook = (p.guestbook || []).filter((g) => g.id !== id); }); saveCache(); }
            if (h.onGuestGone) h.onGuestGone(id);
          })
          .subscribe();
      },
    };
    return S;
  }

  const cfg = window.ORBIT_CONFIG;
  window.OrbitStore = cfg && cfg.supabaseUrl && cfg.supabaseKey ? SupabaseStore(cfg) : LocalStore();
})();
