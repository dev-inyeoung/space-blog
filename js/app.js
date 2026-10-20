/*!
 * ORBIT.LOG — UI layer
 * 장면(Scene) ↔ DOM 패널(인덱스 / 리더 / 생성 모달 / HUD / 충돌 연출) 연결.
 */
(function () {
  'use strict';

  const OE = window.OrbitEngine;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n, w) => String(n).padStart(w, '0');
  const isNarrow = () => window.innerWidth <= 760;
  const DEG = 180 / Math.PI;

  /* ======================================================================
     STORE — js/store.js (LocalStore | SupabaseStore)
     ====================================================================== */
  const Store = window.OrbitStore;
  const boot0 = Store.snapshot();
  // canWrite: null = 아직 모름(세션 확보 중), false = 읽기 전용
  const state = { me: boot0.me, log: boot0.log, canWrite: Store.mode === 'local' ? true : null };
  const pending = new Set(); // 서버 확정 전인 내 새 행성 id
  const gone = new Set();    // 서버 확정 전인 폐기 id
  const fresh = new Set();   // Realtime 으로 새 글이 온 행성 (인덱스 표시용)

  /* ======================================================================
     FIGLET (ANSI Shadow)
     ====================================================================== */
  const FONT = {
    O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
    R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
    B: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██████╔╝', '╚═════╝ '],
    I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
    T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
    L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
    G: [' ██████╗ ', '██╔════╝ ', '██║  ███╗', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
    M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
    P: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
    A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
    '.': ['   ', '   ', '   ', '   ', '██╗', '╚═╝'],
  };
  function figlet(word) {
    const rows = ['', '', '', '', '', ''];
    for (const ch of word) {
      const g = FONT[ch];
      if (!g) continue;
      const w = Math.max(...g.map((l) => l.length));
      for (let i = 0; i < 6; i++) rows[i] += g[i].padEnd(w, ' ');
    }
    return rows.join('\n');
  }
  $('#figlet').textContent = figlet('ORBIT.LOG');
  $('#impact-art').textContent = figlet('IMPACT');

  /* ======================================================================
     SCENE
     ====================================================================== */
  const canvas = $('#space');
  const scene = new OE.Scene(canvas);
  const planets = new Map();

  function register(d) {
    OE.completeSpec(d);
    if (!Array.isArray(d.posts)) d.posts = [];
    planets.set(d.id, d);
    return scene.addBody(d);
  }
  function dropPlanet(id, fx) {
    const b = scene.get(id);
    if (fx && b) scene.burst(b.pos.x, b.pos.y, b.pos.z, b.st.A, b.st.B, 220);
    if (ui.reader === id) closeReader();
    scene.removeBody(id);
    planets.delete(id);
    fresh.delete(id);
    if (state.me === id) state.me = null;
  }
  boot0.planets.forEach(register);
  if (state.me && planets.has(state.me)) scene.setMine(state.me);
  else state.me = null;

  const sameKeys = (a, b) => Object.keys(Object.assign({}, a, b)).every((k) => a[k] === b[k]);

  /** 서버 우주를 id 기준으로 diff 해서 장면에 반영한다. */
  function syncUniverse(u) {
    const ids = new Set(u.planets.map((p) => p.id));
    for (const id of Array.from(planets.keys())) if (!ids.has(id) && !pending.has(id)) dropPlanet(id, false);
    let readerDirty = false;
    for (const p of u.planets) {
      if (gone.has(p.id)) continue;
      const cur = planets.get(p.id);
      if (!cur) { register(p); continue; }
      const q = OE.completeSpec({ id: p.id, orbit: p.orbit, look: p.look });
      if (!sameKeys(cur.orbit, q.orbit) || !sameKeys(cur.look, q.look)) {
        scene.removeBody(p.id); planets.delete(p.id); register(p);
        if (ui.reader === p.id) scene.focus(scene.get(p.id));
        readerDirty = readerDirty || ui.reader === p.id;
        continue;
      }
      const posts = p.id === state.me ? cur.posts : p.posts || []; // 내 글은 낙관적 반영분 유지
      if (ui.reader === p.id && posts.length !== cur.posts.length) readerDirty = true;
      Object.assign(cur, { name: p.name, author: p.author, handle: p.handle, createdAt: p.createdAt, posts, seed: p.seed, user: p.user });
    }
    const me = u.me && planets.has(u.me) ? u.me : pending.size ? state.me : null;
    if (me !== state.me || scene.mine !== scene.get(me)) { state.me = me; scene.setMine(me); }
    state.log = u.log;
    renderIndex(); refreshCTA(); refreshHUD(true);
    if (readerDirty) refreshReader();
  }

  const sorted = () => Array.from(planets.values()).sort((a, b) => a.orbit.a - b.orbit.a);
  const myData = () => (state.me ? planets.get(state.me) : null);
  const encounters = (id) => state.log.filter((l) => l.id === id);
  const palOf = (d) => OE.PALETTES[((d.look.pal % OE.PALETTES.length) + OE.PALETTES.length) % OE.PALETTES.length];
  const rgb = (a) => 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')';
  const glyphOf = (d) => (d.look.ring ? '-' : '') + OE.TEX_GLYPH[d.look.tex] + (d.look.ring ? '-' : '');
  const fmtDate = (s) => String(s || '').replace(/-/g, '.');
  function fmtPeriod(a) {
    const s = OE.periodOf(a);
    return s < 120 ? s.toFixed(1) + ' s' : (s / 60).toFixed(2) + ' min';
  }

  /* ======================================================================
     UI STATE / PANELS
     ====================================================================== */
  const ui = { index: false, reader: null, readerOpts: null, modal: false, about: false, impactUntil: 0 };

  function layout() {
    const open = ui.index || ui.reader;
    document.body.classList.toggle('panel-open', !!open);
    document.body.classList.toggle('reading', !!ui.reader);
    let ox = 0;
    if (!isNarrow()) {
      if (ui.reader) ox -= Math.min(470, window.innerWidth - 48) / 2 + 12;
      if (ui.index) ox += Math.min(380, window.innerWidth - 48) / 2 + 12;
    }
    scene.goal.ox = ox;
  }

  /* ---------- index ---------- */
  function renderIndex() {
    const q = $('#ix-search').value.trim().toLowerCase();
    const list = sorted().filter((d) => !q || (d.name + ' ' + d.author + ' ' + (d.handle || '')).toLowerCase().includes(q));
    $('#ix-list').innerHTML = list.length
      ? list.map((d, i) => {
          const A = palOf(d).a;
          const hit = (encounters(d.id).length ? '<em>✕</em>' : '') + (fresh.has(d.id) ? '<em class="fresh" title="새 로그">+NEW</em>' : '');
          return '<li tabindex="0" data-id="' + esc(d.id) + '" class="' + (d.id === state.me ? 'mine' : '') + '">' +
            '<span class="ix-n">' + pad(i + 1, 2) + '</span>' +
            '<span class="ix-name"><i style="color:' + rgb(A) + '">' + esc(glyphOf(d)) + '</i>' + (d.id === state.me ? '◆ ' : '') + esc(d.name) + hit + '</span>' +
            '<span class="ix-auth">' + esc(d.handle || d.author) + '</span>' +
            '<span class="ix-a">' + d.orbit.a.toFixed(1) + '</span></li>';
        }).join('')
      : '<li class="ix-empty">NO SIGNAL — 검색 결과 없음</li>';
    const n = pad(planets.size, 2);
    $('#nav-count').textContent = n;
    $('#hero-count').textContent = planets.size;
  }
  function openIndex() {
    ui.index = true;
    if (isNarrow() || window.innerWidth < 1100) closeReader(true);
    renderIndex();
    $('#index').classList.add('open'); $('#index').setAttribute('aria-hidden', 'false');
    layout();
  }
  function closeIndex() {
    ui.index = false; scene.hint = null;
    $('#index').classList.remove('open'); $('#index').setAttribute('aria-hidden', 'true');
    layout();
  }
  $('#ix-search').addEventListener('input', renderIndex);
  $('#ix-list').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) openReader(li.dataset.id);
  });
  $('#ix-list').addEventListener('keydown', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li && e.key === 'Enter') openReader(li.dataset.id);
  });
  $('#ix-list').addEventListener('mouseover', (e) => {
    const li = e.target.closest('li[data-id]');
    scene.hint = li ? scene.get(li.dataset.id) : null;
  });
  $('#ix-list').addEventListener('mouseleave', () => { scene.hint = null; });

  /* ---------- reader ---------- */
  const rdPortrait = new OE.Portrait(30, 15);
  function openReader(id, opts) {
    const d = planets.get(id);
    if (!d) return;
    ui.reader = id;
    ui.readerOpts = opts || {};
    if (fresh.delete(id) && ui.index) renderIndex();
    if (window.innerWidth < 1100) closeIndex();
    scene.focus(scene.get(id));
    renderReader();
    $('#rd-scroll').scrollTop = 0;
    const el = $('#reader');
    el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
    layout();
    updateLive(true);
  }
  /** 열린 리더의 내용만 다시 그린다 (스크롤 유지). */
  function refreshReader() {
    if (!ui.reader) return;
    if (!planets.has(ui.reader)) { closeReader(); return; }
    const top = $('#rd-scroll').scrollTop;
    renderReader();
    $('#rd-scroll').scrollTop = top;
  }
  function renderReader() {
    const id = ui.reader, d = planets.get(id), opts = ui.readerOpts || {};
    const list = sorted();
    $('#rd-no').textContent = pad(list.indexOf(d) + 1, 3);
    const pal = palOf(d);
    $('#rd-portrait').style.color = rgb(pal.a);

    const hits = encounters(id);
    const badges = [];
    if (id === state.me) badges.push('<span class="badge mine">◆ MY PLANET</span>');
    if (hits.length) badges.push('<span class="badge hit">✕ IMPACT ×' + hits.length + '</span>');
    badges.push('<span class="badge">' + esc(pal.name) + '</span>');
    if (d.look.ring) badges.push('<span class="badge">RINGED</span>');
    $('#rd-badges').innerHTML = badges.join('');
    $('#rd-name').textContent = d.name;
    $('#rd-name').style.color = id === state.me ? 'var(--accent)' : rgb(pal.a);
    $('#rd-author').innerHTML = esc(d.author || 'unknown') + ' <span>' + esc(d.handle || '') + ' · since ' + esc(fmtDate(d.createdAt)) + '</span>';

    const o = d.orbit, l = d.look;
    const specs = [
      ['SEMI-MAJOR', o.a.toFixed(2) + ' AU'],
      ['ECCENTRICITY', o.e.toFixed(3)],
      ['INCLINATION', (o.inc * DEG).toFixed(2) + '°'],
      ['PERIOD @1×', fmtPeriod(o.a)],
      ['RADIUS', l.size.toFixed(2) + ' R'],
      ['SURFACE', OE.TEX_LABEL[l.tex]],
      ['LOGS', pad(d.posts.length, 2)],
    ];
    $('#rd-specs').innerHTML = specs.map((s) => '<dt>' + s[0] + '</dt><dd>' + esc(s[1]) + '</dd>').join('');

    const im = $('#rd-impact');
    const me = myData();
    if (opts.impact && me) {
      im.hidden = false;
      im.innerHTML = '▲ IMPACT REPORT — 당신의 행성 <b>' + esc(me.name) + '</b> 이(가) <b>' + esc(d.name) + '</b> 와 충돌했습니다. 교차 궤도에서 수신한 로그를 표시합니다.';
    } else if (hits.length) {
      im.hidden = false;
      const last = new Date(hits[hits.length - 1].at);
      im.innerHTML = '✕ 충돌 기록 ' + hits.length + '회 · 최근 <b>' + last.toLocaleString('ko-KR') + '</b>';
    } else im.hidden = true;

    const acts = [];
    if (id === state.me) {
      acts.push('<button class="btn btn-primary" data-act="write">[ + 새 로그 작성 ]</button>');
      acts.push('<button class="btn btn-danger" data-act="destroy">[ 행성 폐기 ]</button>');
    }
    $('#rd-actions').innerHTML = acts.join('');

    const posts = d.posts.slice().sort((a, c) => String(c.date).localeCompare(String(a.date)));
    $('#rd-posts').innerHTML = posts.length
      ? posts.map((p, i) => {
          const paras = String(p.body || '').split(/\n{2,}/).map((t) => '<p>' + esc(t) + '</p>').join('');
          return '<article class="post"><div class="post-meta"><span>LOG #' + pad(posts.length - i, 3) + '</span><span class="rule"></span><time>' + esc(fmtDate(p.date)) + '</time></div>' +
            '<h3>' + esc(p.title) + '</h3><div class="post-body">' + paras + '</div></article>';
        }).join('')
      : '<p class="dim">아직 기록된 로그가 없습니다.</p>';
  }
  function closeReader(silent) {
    if (!ui.reader) return;
    ui.reader = null;
    scene.unfocus();
    const el = $('#reader');
    el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
    if (!silent) layout();
  }
  function stepReader(dir) {
    const list = sorted();
    const i = list.findIndex((d) => d.id === ui.reader);
    const n = list[(i + dir + list.length) % list.length];
    if (n) openReader(n.id);
  }
  $('#rd-prev').addEventListener('click', () => stepReader(-1));
  $('#rd-next').addEventListener('click', () => stepReader(1));
  $('#rd-actions').addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'write') openModal('post');
    if (a.dataset.act === 'destroy') destroyMine();
  });

  let liveT = 0;
  function updateLive(force) {
    if (!ui.reader) return;
    const now = performance.now();
    if (!force && now - liveT < 200) return;
    liveT = now;
    const b = scene.get(ui.reader);
    if (!b) return;
    const p = b.pos, ds = Math.hypot(p.x, p.y, p.z);
    let html = 'DIST ☉ <b>' + ds.toFixed(2) + ' AU</b>';
    const m = scene.mine;
    if (m && m !== b) html += '<br>DIST ◆ <b>' + Math.hypot(p.x - m.pos.x, p.y - m.pos.y, p.z - m.pos.z).toFixed(2) + ' AU</b> (내 행성)';
    html += '<br>POS <b>' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ', ' + p.z.toFixed(1) + '</b>';
    $('#rd-live').innerHTML = html;
  }

  /* ---------- create / write modal ---------- */
  const genPortrait = new OE.Portrait(40, 20);
  const form = $('#form');
  let draft = null, draftStyle = null;

  function rollDraft() {
    draft = OE.randomSpec();
    draftStyle = OE.makeStyle(draft.look);
    const o = draft.orbit, l = draft.look, pal = OE.PALETTES[l.pal];
    $('#gen-portrait').style.color = rgb(pal.a);
    const specs = [
      ['ORBIT a', o.a.toFixed(2) + ' AU'], ['ECC e', o.e.toFixed(3)],
      ['INCL i', (o.inc * DEG).toFixed(2) + '°'], ['PERIOD', fmtPeriod(o.a)],
      ['RADIUS', l.size.toFixed(2) + ' R'], ['RING', l.ring ? 'YES' : 'NO'],
      ['SURFACE', OE.TEX_LABEL[l.tex].split(' / ')[0]], ['SPECTRUM', pal.name],
    ];
    $('#gen-specs').innerHTML = specs.map((s) => '<dt>' + s[0] + '</dt><dd>' + esc(s[1]) + '</dd>').join('');
    const g = $('#gen');
    g.classList.remove('roll'); void g.offsetWidth; g.classList.add('roll');
  }
  function openModal(mode) {
    if (mode === 'planet' && state.me) { openReader(state.me); return; }
    if (state.canWrite === false) { failToast({ code: 'readonly' }); return; }
    ui.modal = true;
    const m = $('#modal');
    m.dataset.mode = mode;
    form.reset();
    $$('.invalid', form).forEach((x) => x.classList.remove('invalid'));
    setMsg('');
    if (mode === 'planet') {
      $('#modal-title').textContent = '// NEW PLANET — 행성 생성 프로토콜';
      $('#f-title-label').textContent = '첫 번째 로그 제목';
      $('#form-submit').textContent = '[ LAUNCH ▸ ]';
      rollDraft();
    } else {
      const me = myData();
      $('#modal-title').textContent = '// NEW LOG — ' + (me ? me.name : '');
      $('#f-title-label').textContent = '로그 제목';
      $('#form-submit').textContent = '[ TRANSMIT ▸ ]';
    }
    m.classList.add('open'); m.setAttribute('aria-hidden', 'false');
    setTimeout(() => { const f = form.querySelector(mode === 'planet' ? '[name=name]' : '[name=title]'); if (f) f.focus(); }, 60);
  }
  function closeModal() {
    ui.modal = false;
    const m = $('#modal');
    m.classList.remove('open'); m.setAttribute('aria-hidden', 'true');
  }
  function setMsg(t, err) { const el = $('#form-msg'); el.textContent = t; el.classList.toggle('err', !!err); }
  $('#gen-reroll').addEventListener('click', rollDraft);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = $('#modal').dataset.mode;
    const f = form.elements;
    const need = mode === 'planet' ? ['name', 'title'] : ['title'];
    let bad = false;
    need.forEach((n) => {
      const ok = f[n].value.trim().length > 0;
      f[n].classList.toggle('invalid', !ok);
      if (!ok) bad = true;
    });
    if (bad) { setMsg('필수 항목을 입력해 주세요.', true); return; }
    const today = new Date();
    const date = today.getFullYear() + '-' + pad(today.getMonth() + 1, 2) + '-' + pad(today.getDate(), 2);
    const post = { date, title: f.title.value.trim(), body: f.body.value.trim() || '(빈 신호)' };

    if (mode === 'planet') {
      const author = f.author.value.trim() || '익명의 관측자';
      const d = {
        id: 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: f.name.value.trim().toUpperCase(), author, handle: '@' + author.replace(/\s+/g, '').toLowerCase().slice(0, 16),
        createdAt: date, orbit: draft.orbit, look: draft.look, posts: [post], user: true,
      };
      state.me = d.id;
      pending.add(d.id);
      const b = register(d);
      Store.createPlanet(d).then(() => pending.delete(d.id), (err) => {
        pending.delete(d.id);
        if (!planets.has(d.id)) return;
        dropPlanet(d.id, true);
        renderIndex(); refreshCTA(); refreshHUD(true);
        failToast(err);
      });
      scene.setMine(d.id);
      scene.burst(b.pos.x, b.pos.y, b.pos.z, b.st.A, [255, 200, 120], 120);
      closeModal();
      renderIndex(); refreshCTA(); refreshHUD(true);
      scene.focus(b);
      setTimeout(() => { if (!ui.reader) scene.unfocus(); }, 2600);
      toast('◆ ' + d.name + ' 궤도 진입 완료 — 다른 행성과 부딪히면 그 블로그가 열립니다. 상단 WARP로 시간을 가속해 보세요.', 5200);
    } else {
      const me = myData();
      if (!me) { closeModal(); return; }
      me.posts.push(post);
      closeModal();
      openReader(me.id);
      toast('LOG TRANSMITTED — ' + post.title);
      Store.addPost(me.id, post).catch((err) => {
        const i = me.posts.indexOf(post);
        if (i >= 0) me.posts.splice(i, 1);
        if (ui.reader === me.id) refreshReader();
        failToast(err);
      });
    }
  });

  function failToast(err) {
    const code = err && err.code, msg = String((err && err.message) || '');
    if (err) console.warn('[orbitlog] write failed', err);
    if (code === 'readonly') toast('✕ 읽기 전용 모드 — 우주와 연결되지 않아 기록할 수 없습니다.', 4200);
    else if (/rate limit/.test(msg)) toast('✕ 송신 과열 — 잠시 후 다시 시도해 주세요.', 4200);
    else if (code === '23505') toast('✕ 이 계정에는 이미 행성이 있습니다. 새로고침해 주세요.', 4200);
    else toast('✕ 전송 실패 — 신호가 우주로 나가지 못했습니다', 4200);
  }

  function destroyMine() {
    const me = myData();
    if (!me) return;
    if (!window.confirm('「' + me.name + '」 행성을 궤도에서 폐기할까요? 작성한 로그도 함께 사라집니다.')) return;
    closeReader();
    gone.add(me.id);
    dropPlanet(me.id, true);
    renderIndex(); refreshCTA(); refreshHUD(true);
    toast('행성이 폐기되었습니다. 새 궤도는 언제든 다시 열 수 있습니다.');
    Store.destroyPlanet(me.id).then(() => gone.delete(me.id), (err) => {
      gone.delete(me.id);
      if (planets.has(me.id) || state.me) return;
      register(me);
      state.me = me.id; scene.setMine(me.id);
      renderIndex(); refreshCTA(); refreshHUD(true);
      failToast(err);
    });
  }

  /* ---------- about ---------- */
  function openAbout() { ui.about = true; $('#about').classList.add('open'); $('#about').setAttribute('aria-hidden', 'false'); }
  function closeAbout() { ui.about = false; $('#about').classList.remove('open'); $('#about').setAttribute('aria-hidden', 'true'); }

  /* ---------- CTA + HUD ---------- */
  function refreshCTA() {
    const me = myData();
    $('#btn-create').textContent = me ? '[ ◆ ' + me.name + ' 로 이동 ]' : '[ + 나의 행성 만들기 ]';
  }
  let hudT = 0;
  function refreshHUD(force) {
    const me = myData(), hud = $('#hud');
    hud.hidden = !me;
    document.body.classList.toggle('has-hud', !!me);
    if (!me) return;
    const now = performance.now();
    if (!force && now - hudT < 250) return;
    hudT = now;
    $('#hud-name').textContent = me.name;
    $('#hud-enc').textContent = state.log.length;
    $('#hud-prox').innerHTML = scene.proximity(4).map((p) => {
      const k = Math.max(0, Math.min(1, 1 - (p.d - p.th) / 30));
      const n = Math.round(k * 10);
      return '<li data-id="' + esc(p.b.id) + '" class="' + (p.d < p.th * 2.5 ? 'near' : '') + '"><span class="nm">' + esc(p.b.data.name) + '</span>' +
        '<span class="bar">[<b>' + '#'.repeat(n) + '</b>' + '-'.repeat(10 - n) + ']</span><span class="d">' + p.d.toFixed(1).padStart(5, '0') + '</span></li>';
    }).join('');
  }
  $('#hud-prox').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) openReader(li.dataset.id); });
  $('#hud-open').addEventListener('click', () => { if (state.me) openReader(state.me); });

  /* ---------- toast ---------- */
  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), ms || 3200);
  }

  /* ======================================================================
     COLLISION
     ====================================================================== */
  scene.onCollide = (other) => {
    setWarp(1);
    const at = Date.now();
    state.log.push({ id: other.id, at });
    Store.logEncounter(other.id, at).catch(() => {});
    refreshHUD(true);
    if (ui.index) renderIndex();
    if (ui.modal) { toast('✕ ' + other.data.name + ' 와 충돌! 작성을 마치면 인덱스에서 확인하세요.'); return; }
    if (performance.now() < ui.impactUntil) { toast('✕ 연쇄 충돌 — ' + other.data.name + ' 도 기록되었습니다.'); return; }
    const me = myData();
    $('#impact-names').textContent = (me ? me.name : '◆') + '  ✕  ' + other.data.name;
    const imp = $('#impact'), flash = $('#flash');
    imp.classList.remove('show'); flash.classList.remove('on'); void imp.offsetWidth;
    imp.classList.add('show'); flash.classList.add('on');
    document.body.classList.add('shake', 'impacting');
    ui.impactUntil = performance.now() + 4000;
    setTimeout(() => document.body.classList.remove('shake'), 550);
    setTimeout(() => {
      imp.classList.remove('show'); document.body.classList.remove('impacting');
      openReader(other.id, { impact: true });
    }, 1650);
  };

  /* ======================================================================
     WARP / PAUSE
     ====================================================================== */
  function setWarp(w) {
    scene.warp = w;
    $$('[data-warp]').forEach((b) => b.classList.toggle('on', +b.dataset.warp === w));
  }
  function togglePause() {
    scene.paused = !scene.paused;
    $('#btn-pause').classList.toggle('on', scene.paused);
    toast(scene.paused ? '|| 우주 정지 — SPACE로 재개' : '▶ 공전 재개', 1400);
  }
  $$('[data-warp]').forEach((b) => b.addEventListener('click', () => setWarp(+b.dataset.warp)));
  $('#btn-pause').addEventListener('click', togglePause);

  /* ======================================================================
     GLOBAL CONTROLS
     ====================================================================== */
  $('#btn-create').addEventListener('click', () => openModal('planet'));
  $('#brand').addEventListener('click', (e) => { e.preventDefault(); closeReader(); closeIndex(); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (a && a.closest('.top-nav')) {
      if (a.dataset.act === 'index') (ui.index ? closeIndex : openIndex)();
      if (a.dataset.act === 'about') openAbout();
    }
    const c = e.target.closest('[data-close]');
    if (c) {
      const t = c.dataset.close;
      if (t === 'index') closeIndex();
      if (t === 'reader') closeReader();
      if (t === 'modal') closeModal();
      if (t === 'about') closeAbout();
    }
  });
  $$('.modal').forEach((m) => m.addEventListener('mousedown', (e) => {
    if (e.target === m) (m.id === 'modal' ? closeModal : closeAbout)();
  }));

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (ui.modal) closeModal();
      else if (ui.about) closeAbout();
      else if (ui.reader) closeReader();
      else if (ui.index) closeIndex();
      return;
    }
    if (typing || ui.modal || ui.about || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 'n' || e.key === 'N') openModal('planet');
    else if (e.key === 'i' || e.key === 'I') (ui.index ? closeIndex : openIndex)();
    else if (ui.reader && e.key === 'ArrowRight') stepReader(1);
    else if (ui.reader && e.key === 'ArrowLeft') stepReader(-1);
    else if ('1234'.includes(e.key)) setWarp([1, 10, 50, 200][+e.key - 1]);
  });

  /* ---------- pointer: rotate / pinch / pick ---------- */
  const pointers = new Map();
  const mouse = { x: -1, y: -1, active: false };
  let drag = null, pinch = 0;
  const pinchDist = () => { const p = Array.from(pointers.values()); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { moved: 0 };
    else if (pointers.size === 2) { pinch = pinchDist(); drag = null; }
    scene.dragging = true;
    canvas.classList.add('grabbing');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; }
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinch) { const d = pinchDist(); if (d > 0) scene.zoom(pinch / d); pinch = d; }
    else if (drag) { drag.moved += Math.abs(dx) + Math.abs(dy); scene.rotate(dx, dy); }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (e.type === 'pointerup' && drag && drag.moved < 6 && pointers.size === 0) handleClick(e.clientX, e.clientY);
    if (pointers.size === 0) { drag = null; pinch = 0; scene.dragging = false; canvas.classList.remove('grabbing'); }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { mouse.active = false; setHover(null); } });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); scene.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

  function handleClick(x, y) {
    const b = scene.pick(x, y);
    if (b) { openReader(b.id); return; }
    if (scene.pickSun(x, y)) { openAbout(); return; }
    if (ui.reader && isNarrow()) closeReader();
  }

  const tip = $('#tooltip');
  function setHover(b) {
    if (scene.hover === b) { if (b) placeTip(); return; }
    scene.hover = b;
    canvas.classList.toggle('pointing', !!b);
    if (!b) {
      tip.classList.remove('on');
      $('#st-mid').textContent = '◇ 행성 위에 커서를 올려 보세요';
      return;
    }
    const d = b.data, last = d.posts[d.posts.length - 1];
    tip.innerHTML = '<b style="color:' + (d.id === state.me ? 'var(--accent)' : rgb(b.st.A)) + '">' + (d.id === state.me ? '◆ ' : '') + esc(d.name) + '</b>' +
      '<span>' + esc(d.handle || d.author) + ' · ' + d.posts.length + ' logs</span>' + (last ? '<p>“' + esc(last.title) + '”</p>' : '');
    tip.classList.add('on');
    placeTip();
    $('#st-mid').textContent = '◇ ' + d.name + ' — a ' + d.orbit.a.toFixed(1) + ' AU · ' + OE.TEX_LABEL[d.look.tex] + ' · CLICK TO OPEN';
  }
  function placeTip() {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = mouse.x + 18, y = mouse.y + 18;
    if (x + w > window.innerWidth - 8) x = mouse.x - w - 14;
    if (y + h > window.innerHeight - 40) y = mouse.y - h - 14;
    tip.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }

  /* ======================================================================
     LOOP
     ====================================================================== */
  let last = performance.now(), fpsN = 0, fpsT = 0, fps = 60, portraitT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    scene.update(dt);
    const time = now / 1000;
    scene.render(time);
    if (mouse.active && !scene.dragging) setHover(scene.pick(mouse.x, mouse.y));

    if (now - portraitT > 33) {
      portraitT = now;
      if (ui.reader) { const b = scene.get(ui.reader); if (b) $('#rd-portrait').innerHTML = rdPortrait.render(b.st, time); }
      if (ui.modal && $('#modal').dataset.mode === 'planet' && draftStyle) $('#gen-portrait').innerHTML = genPortrait.render(draftStyle, time);
    }
    updateLive(false);
    refreshHUD(false);

    fpsN++; fpsT += dt;
    if (fpsT >= 0.5) {
      fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0;
      const v = scene.view;
      const yaw = ((((v.yaw * DEG) % 360) + 360) % 360) | 0;
      $('#st-cam').textContent = 'CAM ψ' + pad(yaw, 3) + '° θ' + pad(Math.round(v.pitch * DEG), 2) + '° R' + pad(Math.round(v.dist), 3);
      $('#st-fps').textContent = 'FPS ' + pad(fps, 2) + ' · BODIES ' + pad(scene.bodies.length + 1, 2) + (scene.paused ? ' · PAUSED' : '');
    }
    $('#clock').textContent = scene.t.toFixed(1).padStart(10, '0');
    requestAnimationFrame(frame);
  }

  /* ======================================================================
     BOOT
     ====================================================================== */
  function fontsReady() {
    const wait = document.fonts && document.fonts.load
      ? Promise.all([document.fonts.load('12px "JetBrains Mono"'), document.fonts.load('12px "Nanum Gothic Coding"')]).catch(() => {})
      : Promise.resolve();
    return Promise.race([wait, new Promise((r) => setTimeout(r, 2000))]);
  }

  /* ======================================================================
     UPLINK — 서버 우주 동기화 + Realtime
     ====================================================================== */
  // 탭이 숨겨진 동안 온 이벤트는 모아 두었다가 다시 보일 때 한꺼번에 반영한다.
  const deferred = [];
  const live = (fn) => (...a) => { if (document.hidden) deferred.push(() => fn(...a)); else fn(...a); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) deferred.splice(0).forEach((f) => f()); });

  const realtime = {
    onPlanet: live((p) => {
      if (planets.has(p.id) || gone.has(p.id)) return; // 내가 만든 건 이미 낙관적으로 반영됨
      const b = register(p);
      scene.burst(b.pos.x, b.pos.y, b.pos.z, b.st.A, [255, 200, 120], 120);
      renderIndex();
      toast('✦ 새 행성 ' + p.name + ' 궤도 진입 — ' + (p.handle || p.author), 4200);
    }),
    onPlanetGone: live((id) => {
      if (!planets.has(id) || pending.has(id)) return;
      dropPlanet(id, true);
      renderIndex(); refreshCTA(); refreshHUD(true);
    }),
    onPost: live((pid, post) => {
      const d = planets.get(pid);
      if (!d || pid === state.me || d.posts.some((x) => x.id === post.id)) return;
      d.posts.push(post);
      if (ui.reader === pid) refreshReader();
      else { fresh.add(pid); if (ui.index) renderIndex(); }
    }),
  };

  const uplink = Store.init()
    .then((r) => { state.canWrite = r.canWrite; return Store.loadUniverse(); })
    .then((u) => { syncUniverse(u); Store.subscribe(realtime); return 'up'; })
    .catch((e) => { console.warn('[orbitlog] uplink offline — local cache', e); return 'down'; });

  async function boot() {
    const log = $('#boot-log'), bar = $('#boot-bar'), pct = $('#boot-pct'), el = $('#boot');
    let skipped = false;
    el.addEventListener('click', () => { skipped = true; });
    const lines = [
      ['ORBIT.LOG heliocentric renderer v2.6.10', ''],
      ['> allocating character raster ', 'OK'],
      ['> igniting SOL-0 (r=3.40) ', 'OK'],
      ['> scattering asteroid belt [24.6–27.8 AU] ', 'OK'],
      ['> resolving ' + planets.size + ' planetary blogs ', 'OK'],
      ['> solving kepler equations ', 'OK'],
      ['> syncing universe clock to UTC ', 'OK'],
      ['> collision radar ' + (state.me ? 'ARMED' : 'STANDBY'), ''],
    ];
    const W = 32;
    const sleep = (ms) => new Promise((r) => setTimeout(r, skipped ? 0 : ms));
    const fontP = fontsReady();
    for (let i = 0; i < lines.length; i++) {
      const [t, ok] = lines[i];
      log.innerHTML += esc(t) + (ok ? '<span class="dim">' + '.'.repeat(Math.max(2, 46 - t.length)) + '</span> <span class="ok">' + ok + '</span>' : '') + '\n';
      const k = Math.round(((i + 1) / lines.length) * W);
      bar.textContent = '[' + '#'.repeat(k) + '-'.repeat(W - k) + ']';
      pct.textContent = Math.round(((i + 1) / lines.length) * 100) + '%';
      await sleep(110 + Math.random() * 90);
    }
    // 첫 프레임은 서버를 기다리지 않는다: 남은 부트 시간 안에 답이 오면 그 결과를, 아니면 PENDING
    const up = Store.mode === 'local' ? 'local' : await Promise.race([uplink, sleep(900).then(() => 'wait')]);
    const upLine = {
      up: ['> uplink ', 'ESTABLISHED'], down: ['> uplink OFFLINE — local cache', ''],
      wait: ['> uplink ', 'PENDING'], local: ['> uplink LOCAL MODE — browser storage', ''],
    }[up];
    log.innerHTML += esc(upLine[0]) + (upLine[1] ? '<span class="dim">' + '.'.repeat(Math.max(2, 46 - upLine[0].length)) + '</span> <span class="ok">' + upLine[1] + '</span>' : '') + '\n';
    if (up === 'wait') uplink.then((r) => { if (r === 'down') toast('✕ uplink OFFLINE — 로컬 캐시로 표시 중입니다.', 4200); });
    await fontP;
    scene.resize();
    renderIndex(); refreshCTA(); refreshHUD(true); layout();
    requestAnimationFrame((t) => { last = t; frame(t); });
    await sleep(250);
    el.classList.add('done');
    setTimeout(() => { const me = myData(); if (me) toast('◆ ' + me.name + ' 이(가) 궤도를 돌고 있습니다. 충돌 레이더 작동 중.'); }, 900);
  }

  window.addEventListener('resize', () => { scene.resize(); layout(); });
  boot();
})();
