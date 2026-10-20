/*!
 * ORBIT.LOG — ASCII heliocentric renderer
 * 캔버스 위에 문자 격자를 깔고, 3D 장면을 "문자 단위"로 래스터라이즈한다.
 * (Z-buffer + 구면 셰이딩 + 케플러 궤도 + 충돌 판정)
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const EPOCH = Date.UTC(2026, 0, 1);
  const RAMP = '.,:;-=+*#%@';
  const RAMP_C = Array.from(RAMP, (c) => c.charCodeAt(0));
  const RL = RAMP_C.length;
  const CORONA = "`.'-:~=*";
  const CORONA_C = Array.from(CORONA, (c) => c.charCodeAt(0));
  const CL = CORONA_C.length;
  const PCH = Array.from('*+x.:o#%', (c) => c.charCodeAt(0));
  const C = (s) => s.charCodeAt(0);
  const SUN_R = 3.4;
  const ZERO = { x: 0, y: 0, z: 0 };

  /* ---------- utils ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function pack(r, g, b) {
    r = r < 0 ? 0 : r > 255 ? 255 : r;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    b = b < 0 ? 0 : b > 255 ? 255 : b;
    return ((r & 0xf0) << 16) | ((g & 0xf0) << 8) | (b & 0xf0);
  }
  const hex = (k) => '#' + k.toString(16).padStart(6, '0');

  /* ---------- look tables ---------- */
  const PALETTES = [
    { name: 'AMBER',  a: [255, 190, 80],  b: [200, 80, 30] },
    { name: 'CYAN',   a: [130, 240, 255], b: [30, 100, 200] },
    { name: 'ROSE',   a: [255, 150, 195], b: [140, 45, 120] },
    { name: 'LIME',   a: [205, 255, 120], b: [40, 140, 80] },
    { name: 'VIOLET', a: [195, 165, 255], b: [75, 50, 175] },
    { name: 'ICE',    a: [236, 248, 255], b: [105, 150, 215] },
    { name: 'CORAL',  a: [255, 165, 125], b: [165, 55, 60] },
    { name: 'SAND',   a: [245, 226, 178], b: [150, 105, 65] },
    { name: 'TEAL',   a: [110, 255, 205], b: [20, 115, 125] },
    { name: 'BONE',   a: [242, 238, 228], b: [105, 100, 92] },
  ];
  const TEXTURES = ['bands', 'storm', 'spots', 'craters', 'ice', 'lava', 'swirl'];
  const TEX_LABEL = {
    bands: '가스 띠 / BANDED', storm: '대폭풍 / STORM', spots: '얼룩 대지 / MOTTLED',
    craters: '크레이터 / CRATERED', ice: '극관 빙하 / GLACIAL', lava: '용암 균열 / MOLTEN', swirl: '소용돌이 / SWIRL',
  };
  const TEX_GLYPH = { bands: '(=)', storm: '(@)', spots: '(%)', craters: '(o)', ice: '(*)', lava: '(#)', swirl: '(&)' };

  const periodOf = (a) => 30 * Math.pow(a / 10, 1.5);

  /* ---------- spec ---------- */
  function completeSpec(d) {
    const R = mulberry32(hashStr(String(d.id || d.name || 'x')));
    const o = (d.orbit = Object.assign({}, d.orbit));
    if (o.a == null) o.a = 8 + R() * 34;
    if (o.e == null) o.e = 0.02 + R() * 0.08;
    if (o.inc == null) o.inc = (R() - 0.5) * 0.07;
    if (o.node == null) o.node = R() * TAU;
    if (o.peri == null) o.peri = R() * TAU;
    if (o.phase == null) o.phase = R() * TAU;
    o.e = Math.min(o.e, Math.max(0, 1 - 5.5 / o.a));
    const l = (d.look = Object.assign({}, d.look));
    if (l.size == null) l.size = 0.6 + R() * 1.1;
    if (l.tex == null) l.tex = TEXTURES[(R() * TEXTURES.length) | 0];
    if (l.pal == null) l.pal = (R() * PALETTES.length) | 0;
    if (l.ring == null) l.ring = R() < 0.3;
    if (l.tilt == null) l.tilt = (R() - 0.5) * 0.9;
    if (l.spin == null) l.spin = (0.15 + R() * 0.45) * (R() < 0.15 ? -1 : 1);
    if (l.seed == null) l.seed = (R() * 1e9) | 0;
    return d;
  }

  /** 사용자 행성: 이심률을 크게 줘서 다른 궤도를 가로지르게 만든다. */
  function randomSpec() {
    const R = Math.random;
    const a = 9 + R() * 33;
    const e = Math.min(0.28 + R() * 0.3, 1 - 5.5 / a);
    return {
      orbit: { a, e, inc: (R() - 0.5) * 0.05, node: R() * TAU, peri: R() * TAU, phase: R() * TAU },
      look: {
        size: 0.6 + R() * 1.2,
        tex: TEXTURES[(R() * TEXTURES.length) | 0],
        pal: (R() * PALETTES.length) | 0,
        ring: R() < 0.35,
        tilt: (R() - 0.5) * 0.9,
        spin: (0.15 + R() * 0.45) * (R() < 0.15 ? -1 : 1),
        seed: (R() * 1e9) | 0,
      },
    };
  }

  function makeStyle(l) {
    const n = PALETTES.length;
    const pal = PALETTES[((l.pal % n) + n) % n];
    const R = mulberry32(l.seed >>> 0);
    const st = {
      tex: l.tex, seed: ((l.seed >>> 0) % 997) / 97, A: pal.a, B: pal.b, pal,
      ring: !!l.ring, spin: l.spin, ctl: Math.cos(l.tilt), stl: Math.sin(l.tilt),
      k1: 0.7 + R() * 0.9, gap: 0.3 + R() * 0.4,
    };
    const la = (R() - 0.5) * 1.1, lo = R() * TAU;
    st.sp = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
    st.cr = [];
    for (let i = 0; i < 10; i++) {
      const z = R() * 2 - 1, ph = R() * TAU, rr = Math.sqrt(1 - z * z);
      st.cr.push([rr * Math.cos(ph), z, rr * Math.sin(ph), 0.012 + R() * 0.05]);
    }
    // ring plane = equatorial plane of the tilted spin axis (0, ctl, -stl)
    st.e1 = [1, 0, 0];
    st.e2 = [0, -st.stl, -st.ctl];
    return st;
  }

  /* ---------- orbit ---------- */
  function makeOrbit(o0) {
    return {
      a: o0.a, e: o0.e, b: o0.a * Math.sqrt(1 - o0.e * o0.e), phase: o0.phase,
      cp: Math.cos(o0.peri), sp: Math.sin(o0.peri),
      ci: Math.cos(o0.inc), si: Math.sin(o0.inc),
      cn: Math.cos(o0.node), sn: Math.sin(o0.node),
      period: periodOf(o0.a),
    };
  }
  function orbitPoint(o, E, out) {
    const xp = o.a * (Math.cos(E) - o.e), zp = o.b * Math.sin(E);
    const x1 = xp * o.cp - zp * o.sp, z1 = xp * o.sp + zp * o.cp;
    const y2 = -z1 * o.si, z2 = z1 * o.ci;
    out.x = x1 * o.cn - z2 * o.sn; out.y = y2; out.z = x1 * o.sn + z2 * o.cn;
  }
  function solveE(M, e) {
    M = ((M % TAU) + TAU) % TAU;
    let E = e < 0.8 ? M : Math.PI;
    for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    return E;
  }
  function prepareBody(d) {
    const o = makeOrbit(d.orbit);
    const N = 300, path = new Float32Array(N * 3), q = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < N; i++) {
      orbitPoint(o, (i / N) * TAU, q);
      path[i * 3] = q.x; path[i * 3 + 1] = q.y; path[i * 3 + 2] = q.z;
    }
    return {
      id: d.id, data: d, o, st: makeStyle(d.look), size: d.look.size,
      pos: { x: 0, y: 0, z: 0 }, path, scr: { vis: false, x: 0, y: 0, r: 0, z: 0 },
    };
  }
  function bodyPos(b, t) {
    const o = b.o;
    orbitPoint(o, solveE(o.phase + (TAU * t) / o.period, o.e), b.pos);
  }

  /* ---------- raster + camera ---------- */
  class Raster {
    constructor() { this.cols = 0; this.rows = 0; }
    resize(c, r) {
      this.cols = c; this.rows = r;
      const n = c * r;
      this.ch = new Uint8Array(n); this.col = new Int32Array(n); this.z = new Float32Array(n);
    }
    clear() { this.ch.fill(0); this.z.fill(Infinity); }
    put(x, y, code, rgb, z) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      const i = y * this.cols + x;
      if (z < this.z[i]) { this.z[i] = z; this.ch[i] = code; this.col[i] = rgb; }
    }
  }

  class Camera {
    constructor() {
      this.pos = [0, 0, 0]; this.r = [1, 0, 0]; this.u = [0, 1, 0]; this.f = [0, 0, 1];
      this.F = 800; this.W = 1; this.H = 1; this.cw = 8; this.ch = 14; this.ox = 0;
    }
    lookAt(px, py, pz, tx, ty, tz) {
      const p = this.pos; p[0] = px; p[1] = py; p[2] = pz;
      let fx = tx - px, fy = ty - py, fz = tz - pz;
      const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
      this.f[0] = fx; this.f[1] = fy; this.f[2] = fz;
      this.r[0] = rx; this.r[1] = 0; this.r[2] = rz;
      this.u[0] = ux; this.u[1] = uy; this.u[2] = uz;
    }
    project(x, y, z, out) {
      const p = this.pos, f = this.f, r = this.r, u = this.u;
      const dx = x - p[0], dy = y - p[1], dz = z - p[2];
      const zc = dx * f[0] + dy * f[1] + dz * f[2];
      if (zc < 0.2) return false;
      const xc = dx * r[0] + dy * r[1] + dz * r[2];
      const yc = dx * u[0] + dy * u[1] + dz * u[2];
      out.px = this.W * 0.5 + this.ox + (xc * this.F) / zc;
      out.py = this.H * 0.5 - (yc * this.F) / zc;
      out.z = zc;
      return true;
    }
  }

  /* ---------- procedural surface ---------- */
  const T = { v: 0, b: 1, e: 0 };
  function noise3(x, y, z, s) {
    return 0.5 + 0.5 * (
      Math.sin(x * 3.1 + s) * Math.sin(y * 2.7 + s * 1.7) * Math.sin(z * 3.3 + s * 0.6) +
      0.5 * Math.sin(x * 6.3 + y * 4.1 + s * 2.3) * Math.sin(z * 5.7 - y * 3.9 + s) +
      0.25 * Math.sin(x * 11.7 - z * 9.3 + s * 3.1) * Math.sin(y * 12.1 + x * 2 + s * 0.3)
    ) / 1.75;
  }
  function texture(st, x, y, z, t) {
    const s = st.seed;
    T.b = 1; T.e = 0;
    switch (st.tex) {
      case 'bands': {
        const lon = Math.atan2(z, x);
        const v = Math.sin(y * st.k1 * 7 + Math.sin(lon * 2 + s) * 0.5 + noise3(x, y, z, s) * 1.4);
        T.v = 0.5 + 0.5 * v; T.b = 0.85 + 0.3 * T.v; break;
      }
      case 'storm': {
        let v = 0.5 + 0.5 * Math.sin(y * 9 * st.k1 + noise3(x * 1.5, y, z * 1.5, s) * 1.6);
        const sp = st.sp, d = 1 - (x * sp[0] + y * sp[1] + z * sp[2]);
        if (d < 0.09) { const k = d / 0.09; v = 0.5 + 0.5 * Math.cos(k * 11 - t * 0.8); T.b = 1.2; }
        T.v = v; break;
      }
      case 'spots': {
        const n = noise3(x * 1.7, y * 1.7, z * 1.7, s);
        T.v = n > 0.56 ? 0.95 : n * 0.5; T.b = 0.8 + 0.4 * n; break;
      }
      case 'craters': {
        const n = noise3(x * 2.2, y * 2.2, z * 2.2, s);
        let v = 0.3 + n * 0.45, b = 0.85 + n * 0.2;
        const cr = st.cr;
        for (let i = 0; i < cr.length; i++) {
          const c = cr[i], d = 1 - (x * c[0] + y * c[1] + z * c[2]);
          if (d < c[3]) { const k = d / c[3]; if (k > 0.72) { v = 0.95; b = 1.25; } else { v = 0.05; b = 0.6 + k * 0.3; } break; }
        }
        T.v = v; T.b = b; break;
      }
      case 'ice': {
        const n = noise3(x * 2, y * 2, z * 2, s);
        if (Math.abs(y) > 0.7 - n * 0.18) { T.v = 1; T.b = 1.25; } else { T.v = 0.15 + n * 0.4; }
        break;
      }
      case 'lava': {
        const n = noise3(x * 2, y * 2, z * 2, s);
        const crack = Math.abs(Math.sin(n * 15 + t * 0.25));
        if (crack < 0.16) { T.e = 1 - crack / 0.16; T.v = 1; } else { T.v = 0.1 + n * 0.25; T.b = 0.75; }
        break;
      }
      default: { // swirl
        const lon = Math.atan2(z, x);
        T.v = 0.5 + 0.5 * Math.sin(lon * 3 + y * 6 * st.k1 + Math.sin(y * 5 + s) * 2 + t * 0.05);
      }
    }
  }

  /* ---------- rasterizers ---------- */
  const P = { px: 0, py: 0, z: 0 };

  function drawBody(R, cam, st, size, x, y, z, lx, ly, lz, t, scr, boost) {
    if (!cam.project(x, y, z, P)) { if (scr) scr.vis = false; return; }
    const zc = P.z, pr = (size * cam.F) / zc;
    const cx = P.px / cam.cw, cy = P.py / cam.ch, rx = pr / cam.cw, ry = pr / cam.ch;
    if (scr) { scr.vis = true; scr.x = P.px; scr.y = P.py; scr.r = pr; scr.z = zc; }
    if (cx + rx < 0 || cx - rx > R.cols || cy + ry < 0 || cy - ry > R.rows) return;
    const A = st.A, B = st.B;
    if (rx < 0.75) {
      R.put(Math.floor(cx), Math.floor(cy), C(rx < 0.4 ? 'o' : '@'), pack(A[0], A[1], A[2]), zc);
      return;
    }
    const r = cam.r, u = cam.u, f = cam.f;
    const Lx = lx * r[0] + ly * r[1] + lz * r[2];
    const Ly = lx * u[0] + ly * u[1] + lz * u[2];
    const Lz = lx * f[0] + ly * f[1] + lz * f[2];
    const sa = st.spin * t + st.seed, ca = Math.cos(sa), sn = Math.sin(sa);
    const ct = st.ctl, stl = st.stl;
    const c0 = Math.max(0, Math.floor(cx - rx)), c1 = Math.min(R.cols - 1, Math.ceil(cx + rx));
    const r0 = Math.max(0, Math.floor(cy - ry)), r1 = Math.min(R.rows - 1, Math.ceil(cy + ry));
    for (let row = r0; row <= r1; row++) {
      const dy = (row + 0.5 - cy) / ry;
      if (dy * dy > 1) continue;
      for (let col = c0; col <= c1; col++) {
        const dx = (col + 0.5 - cx) / rx;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const nx = dx, ny = -dy, nzc = -nz;
        const diff = nx * Lx + ny * Ly + nzc * Lz;
        const wx = r[0] * nx + u[0] * ny + f[0] * nzc;
        const wy = r[1] * nx + u[1] * ny + f[1] * nzc;
        const wz = r[2] * nx + u[2] * ny + f[2] * nzc;
        const y1 = wy * ct - wz * stl, z1 = wy * stl + wz * ct;
        const x2 = wx * ca - z1 * sn, z2 = wx * sn + z1 * ca;
        texture(st, x2, y1, z2, t);
        let lum = (diff > 0 ? diff : 0) * 0.95 * T.b + 0.035;
        const edge = 1 - nz;
        lum += edge * edge * edge * 0.45 * (diff > -0.25 ? 1 : 0.25) + boost;
        if (T.e > lum) lum = T.e;
        if (lum > 1) lum = 1;
        const code = RAMP_C[Math.min(RL - 1, (lum * RL) | 0)];
        const v = T.v, k = 0.2 + 0.8 * lum;
        let cr = (B[0] + (A[0] - B[0]) * v) * k;
        let cg = (B[1] + (A[1] - B[1]) * v) * k;
        let cb = (B[2] + (A[2] - B[2]) * v) * k;
        if (T.e > 0) { const e = T.e; cr += (255 - cr) * e; cg += (180 - cg) * e * 0.85; cb = cb * (1 - e) + 50 * e; }
        R.put(col, row, code, pack(cr, cg, cb), zc - nz * size);
      }
    }
  }

  function drawRing(R, cam, st, size, x, y, z, pr) {
    if (!st.ring) return;
    const rxc = pr / cam.cw;
    if (rxc < 0.6) return;
    const e1 = st.e1, e2 = st.e2, A = st.A, B = st.B;
    const bands = clamp(Math.round(rxc * 0.9), 2, 7);
    const n = clamp(Math.ceil(rxc * 2.4 * TAU * 1.4), 48, 2400);
    for (let j = 0; j < bands; j++) {
      const fr = j / (bands - 1);
      if (bands > 3 && Math.abs(fr - st.gap) < 0.11) continue;
      const k = size * (1.45 + fr * 0.95);
      const code = C(fr < 0.25 ? '-' : fr < 0.8 ? '=' : '~');
      const s = Math.sin(fr * 9 + st.seed);
      const br = 0.42 + 0.45 * s * s;
      const col = pack((A[0] * 0.6 + B[0] * 0.4) * br, (A[1] * 0.6 + B[1] * 0.4) * br, (A[2] * 0.6 + B[2] * 0.4) * br);
      for (let i = 0; i < n; i++) {
        const th = (i / n) * TAU, c = Math.cos(th), sn = Math.sin(th);
        if (!cam.project(x + k * (e1[0] * c + e2[0] * sn), y + k * (e1[1] * c + e2[1] * sn), z + k * (e1[2] * c + e2[2] * sn), P)) continue;
        R.put(Math.floor(P.px / cam.cw), Math.floor(P.py / cam.ch), code, col, P.z);
      }
    }
  }

  function drawSun(R, cam, t, scr) {
    if (!cam.project(0, 0, 0, P)) { scr.vis = false; return; }
    const zc = P.z, pr = (SUN_R * cam.F) / zc;
    const cx = P.px / cam.cw, cy = P.py / cam.ch, rx = pr / cam.cw, ry = pr / cam.ch;
    scr.vis = true; scr.x = P.px; scr.y = P.py; scr.r = pr; scr.z = zc;
    const ext = 2.7;
    const c0 = Math.max(0, Math.floor(cx - rx * ext)), c1 = Math.min(R.cols - 1, Math.ceil(cx + rx * ext));
    const r0 = Math.max(0, Math.floor(cy - ry * ext)), r1 = Math.min(R.rows - 1, Math.ceil(cy + ry * ext));
    const r = cam.r, u = cam.u, f = cam.f;
    for (let row = r0; row <= r1; row++) {
      const dy = (row + 0.5 - cy) / ry;
      for (let col = c0; col <= c1; col++) {
        const dx = (col + 0.5 - cx) / rx;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 1) {
          const nz = Math.sqrt(1 - d2);
          const nx = dx, ny = -dy, nzc = -nz;
          const wx = r[0] * nx + u[0] * ny + f[0] * nzc;
          const wy = r[1] * nx + u[1] * ny + f[1] * nzc;
          const wz = r[2] * nx + u[2] * ny + f[2] * nzc;
          const n1 = noise3(wx * 2.4 + t * 0.11, wy * 2.4 - t * 0.07, wz * 2.4, 1.7);
          const n2 = noise3(wx * 6 - t * 0.2, wy * 6, wz * 6 + t * 0.15, 4.2);
          const lum = clamp(0.4 + 0.4 * nz + (n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.35, 0.05, 1);
          let cr, cg, cb;
          if (lum < 0.55) { const k = lum / 0.55; cr = 190 + 65 * k; cg = 50 + 90 * k; cb = 10 + 20 * k; }
          else { const k = (lum - 0.55) / 0.45; cr = 255; cg = 140 + 104 * k; cb = 30 + 180 * k; }
          R.put(col, row, RAMP_C[Math.min(RL - 1, (lum * RL) | 0)], pack(cr, cg, cb), zc - nz * SUN_R);
        } else {
          const d = Math.sqrt(d2);
          if (d > ext) continue;
          const ang = Math.atan2(dy, dx);
          const rays = 0.55 + 0.45 * Math.sin(ang * 5 + t * 0.35) * Math.sin(ang * 9 - t * 0.23 + 1.3);
          const fall = Math.pow(1 - (d - 1) / (ext - 1), 2.4);
          const flick = 0.85 + 0.15 * Math.sin(col * 12.9898 + row * 78.233 + t * 3);
          const it = fall * rays * flick * 1.15;
          if (it < 0.07) continue;
          R.put(col, row, CORONA_C[Math.min(CL - 1, (it * CL) | 0)], pack(70 + 185 * it, 25 + 105 * it, 10 + 25 * it), 1e7);
        }
      }
    }
  }

  function makeStars(n, seed) {
    const R = mulberry32(seed), out = [];
    for (let i = 0; i < n; i++) {
      const z = R() * 2 - 1, ph = R() * TAU, rr = Math.sqrt(1 - z * z);
      out.push({ x: rr * Math.cos(ph), y: z, z: rr * Math.sin(ph), m: Math.pow(R(), 2.6), w: 0.4 + R() * 2.2, p: R() * TAU });
    }
    return out;
  }
  function drawStars(R, cam, stars, t) {
    const r = cam.r, u = cam.u, f = cam.f, W2 = cam.W * 0.5 + cam.ox * 0.25, H2 = cam.H * 0.5, F = cam.F * 0.8;
    const S1 = C('*'), S2 = C('+'), S3 = C('.'), S4 = C('`');
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const zc = s.x * f[0] + s.y * f[1] + s.z * f[2];
      if (zc < 0.15) continue;
      const px = W2 + ((s.x * r[0] + s.y * r[1] + s.z * r[2]) * F) / zc;
      const py = H2 - ((s.x * u[0] + s.y * u[1] + s.z * u[2]) * F) / zc;
      const b = s.m * (0.55 + 0.45 * Math.sin(t * s.w + s.p));
      const code = b > 0.62 ? S1 : b > 0.36 ? S2 : b > 0.12 ? S3 : S4;
      const k = 0.22 + 0.78 * b;
      R.put(Math.floor(px / cam.cw), Math.floor(py / cam.ch), code, pack((150 + 105 * b) * k, (160 + 95 * b) * k, (195 + 60 * b) * k), 1e9);
    }
  }

  function makeBelt(n, seed) {
    const R = mulberry32(seed), out = [];
    for (let i = 0; i < n; i++) {
      const a = 24.6 + R() * 3.2;
      out.push({ a, ph: R() * TAU, inc: (R() - 0.5) * 0.08, y: (R() - 0.5) * 0.5, w: TAU / periodOf(a), c: C(R() < 0.75 ? '.' : R() < 0.5 ? ',' : "'"), k: 0.25 + R() * 0.35 });
    }
    return out;
  }
  function drawBelt(R, cam, belt, t) {
    for (let i = 0; i < belt.length; i++) {
      const b = belt[i], ang = b.ph + b.w * t;
      const x = b.a * Math.cos(ang), z = b.a * Math.sin(ang), y = b.y + Math.sin(ang) * b.a * b.inc;
      if (!cam.project(x, y, z, P)) continue;
      R.put(Math.floor(P.px / cam.cw), Math.floor(P.py / cam.ch), b.c, pack(225 * b.k, 200 * b.k, 160 * b.k), P.z);
    }
  }

  /* ---------- portrait (DOM <pre>) ---------- */
  class Portrait {
    constructor(cols, rows) {
      this.cols = cols; this.rows = rows;
      this.R = new Raster(); this.R.resize(cols, rows);
      this.cam = new Camera();
      const l = [-0.72, 0.48, 0.5], ll = Math.hypot(l[0], l[1], l[2]);
      this.L = l.map((v) => v / ll);
    }
    render(st, t) {
      const R = this.R, cam = this.cam;
      R.clear();
      // <pre> 셀 비율: 폭 0.6em × 높이 1em (line-height:1)
      const A = 1 / 0.6;
      cam.W = this.cols; cam.H = this.rows * A; cam.cw = 1; cam.ch = A; cam.ox = 0;
      const ext = st.ring ? 2.45 : 1.06, D = 9;
      cam.F = ((Math.min(this.cols / 2, (this.rows * A) / 2) * D) / ext) * 0.94;
      const el = st.ring ? 0.32 : 0.16;
      cam.lookAt(0, D * Math.sin(el), D * Math.cos(el), 0, 0, 0);
      drawBody(R, cam, st, 1, 0, 0, 0, this.L[0], this.L[1], this.L[2], t, null, 0);
      drawRing(R, cam, st, 1, 0, 0, 0, cam.F / D);
      let html = '';
      for (let row = 0; row < this.rows; row++) {
        let run = '', rc = -2;
        for (let col = 0; col < this.cols; col++) {
          const i = row * this.cols + col, c = R.ch[i];
          const k = c ? R.col[i] : -1;
          if (k !== rc) {
            if (run) html += rc === -1 ? run : '<span style="color:' + hex(rc) + '">' + run + '</span>';
            run = ''; rc = k;
          }
          run += c ? String.fromCharCode(c) : ' ';
        }
        if (run) html += rc === -1 ? run : '<span style="color:' + hex(rc) + '">' + run + '</span>';
        html += '\n';
      }
      return html;
    }
  }

  /* ---------- scene ---------- */
  class Scene {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.R = new Raster(); this.cam = new Camera();
      this.bodies = []; this.byId = new Map();
      this.mine = null; this.hover = null; this.selected = null; this.hint = null; this.follow = null;
      this.t = (Date.now() - EPOCH) / 1000;
      this.warp = 1; this.paused = false; this.dragging = false;
      this.view = { yaw: 2.4, pitch: 1.3, dist: 360, ox: 0, tx: 0, ty: 0, tz: 0 };
      this.goal = { yaw: 0.85, pitch: 0.44, dist: 112, ox: 0 };
      this.baseDist = 112;
      this.particles = []; this.contact = new Set(); this.grace = 3;
      this.onCollide = null;
      this.stars = makeStars(1300, 7); this.belt = makeBelt(560, 11);
      this.family = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
      this.fs = 12;
      this.cssCache = new Map();
      this.sunScr = { vis: false, x: 0, y: 0, r: 0, z: 0 };
      this.bloomA = document.createElement('canvas'); this.bloomB = document.createElement('canvas');
      this.actx = this.bloomA.getContext('2d'); this.bctx = this.bloomB.getContext('2d');
    }

    resize() {
      const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = W; this.H = H;
      this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
      this.fs = W < 640 ? 9 : W < 1100 ? 11 : 12;
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = this.fs + 'px ' + this.family;
      this.cw = ctx.measureText('MMMMMMMMMM').width / 10;
      this.ch = Math.round(this.fs * 1.2);
      this.R.resize(Math.ceil(W / this.cw), Math.ceil(H / this.ch));
      const cam = this.cam;
      cam.W = W; cam.H = H; cam.cw = this.cw; cam.ch = this.ch;
      cam.F = Math.min(W, H * 1.6) * 0.95;
      this.bloomA.width = Math.max(1, Math.round(W / 4)); this.bloomA.height = Math.max(1, Math.round(H / 4));
      this.bloomB.width = Math.max(1, Math.round(W / 12)); this.bloomB.height = Math.max(1, Math.round(H / 12));
    }

    addBody(d) {
      const b = prepareBody(d);
      bodyPos(b, this.t);
      this.bodies.push(b); this.byId.set(b.id, b);
      return b;
    }
    removeBody(id) {
      const b = this.byId.get(id);
      if (!b) return;
      this.bodies.splice(this.bodies.indexOf(b), 1); this.byId.delete(id);
      if (this.mine === b) this.mine = null;
      if (this.follow === b) this.unfocus();
      if (this.hover === b) this.hover = null;
      this.contact.delete(id);
    }
    get(id) { return this.byId.get(id) || null; }
    setMine(id) { this.mine = this.get(id); this.contact.clear(); this.grace = 3; }

    focus(b) { this.follow = b; this.selected = b; this.goal.dist = clamp(b.size * 15 + 10, 16, 44); }
    unfocus() { this.follow = null; this.selected = null; this.goal.dist = this.baseDist; }
    zoom(f) {
      const g = this.goal;
      if (this.follow) g.dist = clamp(g.dist * f, 6, 90);
      else { g.dist = clamp(g.dist * f, 26, 280); this.baseDist = g.dist; }
    }
    rotate(dx, dy) {
      this.goal.yaw -= dx * 0.0055;
      this.goal.pitch = clamp(this.goal.pitch + dy * 0.0045, 0.03, 1.5);
    }

    positions() { for (let i = 0; i < this.bodies.length; i++) bodyPos(this.bodies[i], this.t); }

    collide() {
      const m = this.mine;
      for (let i = 0; i < this.bodies.length; i++) {
        const b = this.bodies[i];
        if (b === m) continue;
        const dx = b.pos.x - m.pos.x, dy = b.pos.y - m.pos.y, dz = b.pos.z - m.pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const th = (m.size + b.size) * 1.3 + 0.35;
        if (d < th) {
          if (!this.contact.has(b.id)) {
            this.contact.add(b.id);
            const px = (b.pos.x + m.pos.x) / 2, py = (b.pos.y + m.pos.y) / 2, pz = (b.pos.z + m.pos.z) / 2;
            this.burst(px, py, pz, m.st.A, b.st.A, 180);
            if (this.onCollide) this.onCollide(b, m);
          }
        } else if (d > th * 2.2) this.contact.delete(b.id);
      }
    }

    /** 가장 가까운 행성들 (내 행성 기준) */
    proximity(n) {
      const m = this.mine;
      if (!m) return [];
      const out = [];
      for (const b of this.bodies) {
        if (b === m) continue;
        const d = Math.hypot(b.pos.x - m.pos.x, b.pos.y - m.pos.y, b.pos.z - m.pos.z);
        out.push({ b, d, th: (m.size + b.size) * 1.3 + 0.35 });
      }
      out.sort((a, c) => a.d - c.d);
      return out.slice(0, n);
    }

    burst(x, y, z, A, B, n) {
      for (let i = 0; i < n; i++) {
        const zz = Math.random() * 2 - 1, ph = Math.random() * TAU, rr = Math.sqrt(1 - zz * zz);
        const sp = 1.5 + Math.random() * 8, life = 0.8 + Math.random() * 2;
        this.particles.push({
          x, y, z, vx: rr * Math.cos(ph) * sp, vy: zz * sp * 0.6, vz: rr * Math.sin(ph) * sp,
          life, max: life, c: PCH[(Math.random() * PCH.length) | 0], A: Math.random() < 0.5 ? A : B,
        });
      }
    }

    update(dt) {
      const v = this.view, g = this.goal;
      if (!this.dragging && !this.follow) g.yaw += dt * 0.028;
      const k = 1 - Math.exp(-dt * 3.2);
      v.yaw += (g.yaw - v.yaw) * k; v.pitch += (g.pitch - v.pitch) * k;
      v.dist += (g.dist - v.dist) * k; v.ox += (g.ox - v.ox) * k;

      if (!this.paused) {
        const sdt = dt * this.warp;
        if (this.mine && this.grace <= 0) {
          const steps = Math.max(1, Math.ceil(sdt / 0.15)), h = sdt / steps;
          for (let s = 0; s < steps; s++) { this.t += h; this.positions(); if (this.mine) this.collide(); }
        } else { this.t += sdt; this.positions(); }
      }
      if (this.grace > 0) this.grace -= dt;

      const kt = 1 - Math.exp(-dt * 5);
      const tg = this.follow ? this.follow.pos : ZERO;
      v.tx += (tg.x - v.tx) * kt; v.ty += (tg.y - v.ty) * kt; v.tz += (tg.z - v.tz) * kt;

      const ps = this.particles, drag = Math.exp(-dt * 1.2);
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life -= dt;
        if (p.life <= 0) { ps.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vx *= drag; p.vy *= drag; p.vz *= drag;
      }
    }

    pick(mx, my) {
      let best = null, bz = Infinity;
      for (const b of this.bodies) {
        const s = b.scr;
        if (!s.vis) continue;
        const rr = Math.max(s.r * 1.2, 13), dx = mx - s.x, dy = my - s.y;
        if (dx * dx + dy * dy < rr * rr && s.z < bz) { best = b; bz = s.z; }
      }
      return best;
    }
    pickSun(mx, my) {
      const s = this.sunScr;
      return s.vis && Math.hypot(mx - s.x, my - s.y) < Math.max(s.r, 14);
    }

    render(time) {
      const R = this.R, cam = this.cam, v = this.view;
      R.clear();
      const cp = Math.cos(v.pitch);
      cam.ox = v.ox;
      cam.lookAt(
        v.tx + v.dist * cp * Math.sin(v.yaw), v.ty + v.dist * Math.sin(v.pitch), v.tz + v.dist * cp * Math.cos(v.yaw),
        v.tx, v.ty, v.tz
      );
      drawStars(R, cam, this.stars, time);
      drawBelt(R, cam, this.belt, this.t);
      for (const b of this.bodies) this.drawOrbit(b);
      drawSun(R, cam, time, this.sunScr);
      for (const b of this.bodies) {
        const p = b.pos;
        let lx = -p.x, ly = -p.y, lz = -p.z;
        const l = Math.hypot(lx, ly, lz) || 1; lx /= l; ly /= l; lz /= l;
        const boost = b === this.hover || b === this.selected ? 0.07 : 0;
        drawBody(R, cam, b.st, b.size, p.x, p.y, p.z, lx, ly, lz, time, b.scr, boost);
        if (b.scr.vis) drawRing(R, cam, b.st, b.size, p.x, p.y, p.z, b.scr.r);
      }
      this.drawParticles();
      this.blit();
      this.applyBloom();
      this.drawOverlay();
    }

    drawOrbit(b) {
      const R = this.R, cam = this.cam, path = b.path, n = path.length / 3;
      const em = b === this.hover || b === this.selected || b === this.hint;
      const mine = b === this.mine, A = b.st.A;
      const kk = em ? 0.85 : mine ? 0.75 : 0.26;
      const col = mine && !em ? pack(255 * kk, 125 * kk, 30 * kk) : pack(A[0] * kk, A[1] * kk, A[2] * kk);
      const dot = C('.'), plus = C('+'), colon = C(':');
      for (let i = 0; i < n; i++) {
        if (!cam.project(path[i * 3], path[i * 3 + 1], path[i * 3 + 2], P)) continue;
        const code = em ? colon : mine && i % 6 === 0 ? plus : dot;
        R.put(Math.floor(P.px / cam.cw), Math.floor(P.py / cam.ch), code, col, P.z + 0.02);
      }
    }

    drawParticles() {
      const R = this.R, cam = this.cam;
      for (const p of this.particles) {
        if (!cam.project(p.x, p.y, p.z, P)) continue;
        const k = p.life / p.max, A = p.A, w = k * k * 0.6;
        R.put(Math.floor(P.px / cam.cw), Math.floor(P.py / cam.ch), p.c,
          pack((A[0] + (255 - A[0]) * w) * (0.3 + 0.7 * k), (A[1] + (255 - A[1]) * w) * (0.3 + 0.7 * k), (A[2] + (255 - A[2]) * w) * (0.3 + 0.7 * k)),
          P.z - 0.5);
      }
    }

    css(k) {
      let s = this.cssCache.get(k);
      if (!s) { s = hex(k); this.cssCache.set(k, s); }
      return s;
    }

    /** 행 단위로 같은 색 글자를 하나의 문자열로 묶어 fillText 호출 수를 최소화 */
    blit() {
      const ctx = this.ctx, R = this.R, cw = this.cw, ch = this.ch, cols = R.cols;
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.font = this.fs + 'px ' + this.family;
      ctx.textBaseline = 'top';
      if (!this.sp || this.sp.length < cols + 1) {
        this.sp = [''];
        for (let i = 1; i <= cols; i++) this.sp.push(this.sp[i - 1] + ' ');
      }
      const SP = this.sp, buckets = new Map();
      for (let row = 0; row < R.rows; row++) {
        const base = row * cols;
        buckets.clear();
        for (let col = 0; col < cols; col++) {
          const c = R.ch[base + col];
          if (c === 0) continue;
          const k = R.col[base + col];
          const b = buckets.get(k);
          if (!b) buckets.set(k, { s: String.fromCharCode(c), start: col, end: col });
          else { b.s += SP[col - b.end - 1] + String.fromCharCode(c); b.end = col; }
        }
        const y = row * ch;
        for (const [k, b] of buckets) { ctx.fillStyle = this.css(k); ctx.fillText(b.s, b.start * cw, y); }
      }
    }

    applyBloom() {
      const a = this.bloomA, b = this.bloomB, ctx = this.ctx;
      this.actx.drawImage(this.cv, 0, 0, a.width, a.height);
      this.bctx.drawImage(a, 0, 0, b.width, b.height);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.5; ctx.drawImage(b, 0, 0, this.W, this.H);
      ctx.globalAlpha = 0.22; ctx.drawImage(a, 0, 0, this.W, this.H);
      ctx.restore();
    }

    drawOverlay() {
      const ctx = this.ctx;
      ctx.save();
      ctx.font = this.fs - 1 + 'px ' + this.family;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 1;
      const s0 = this.sunScr;
      if (s0.vis) {
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffb46b';
        ctx.fillText('SOL-0', s0.x - ctx.measureText('SOL-0').width / 2, s0.y + s0.r * 2.9 + 8);
      }
      for (const b of this.bodies) {
        const s = b.scr;
        if (!s.vis || s.x < -80 || s.x > this.W + 80 || s.y < -40 || s.y > this.H + 40) continue;
        const isH = b === this.hover || b === this.hint, isS = b === this.selected, isM = b === this.mine;
        const A = b.st.A;
        const col = isM ? '#ff8a3d' : 'rgb(' + A[0] + ',' + A[1] + ',' + A[2] + ')';
        const rr = Math.max(s.r, 4);
        const a = isH || isS ? 1 : isM ? 0.95 : clamp(1.45 - s.z / 160, 0.32, 0.8);
        const lx = s.x + rr * 0.8 + 14, ly = s.y - rr * 0.6 - 10;
        ctx.globalAlpha = a * 0.6;
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(s.x + rr * 0.72 + 2, s.y - rr * 0.5 - 2); ctx.lineTo(lx - 4, ly); ctx.stroke();
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        ctx.fillText((isM ? '◆ ' : '') + b.data.name, lx, ly);
        if (isH || isS) {
          ctx.globalAlpha = 0.6; ctx.fillStyle = '#e9e4d8';
          ctx.fillText(b.data.handle || b.data.author || '', lx, ly + this.fs + 2);
          const h = rr + 9, L = 7;
          ctx.globalAlpha = 0.95; ctx.strokeStyle = '#e9e4d8';
          ctx.beginPath();
          ctx.moveTo(s.x - h, s.y - h + L); ctx.lineTo(s.x - h, s.y - h); ctx.lineTo(s.x - h + L, s.y - h);
          ctx.moveTo(s.x + h - L, s.y - h); ctx.lineTo(s.x + h, s.y - h); ctx.lineTo(s.x + h, s.y - h + L);
          ctx.moveTo(s.x - h, s.y + h - L); ctx.lineTo(s.x - h, s.y + h); ctx.lineTo(s.x - h + L, s.y + h);
          ctx.moveTo(s.x + h - L, s.y + h); ctx.lineTo(s.x + h, s.y + h); ctx.lineTo(s.x + h, s.y + h - L);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  global.OrbitEngine = {
    Scene, Portrait, PALETTES, TEXTURES, TEX_LABEL, TEX_GLYPH, EPOCH,
    completeSpec, randomSpec, makeStyle, periodOf, hashStr,
  };
})(window);
