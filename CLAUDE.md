# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ORBIT.LOG — a no-scroll, single-page "solar system of blogs" where the whole 3D scene is rasterized into an ASCII character grid on a `<canvas>`. Pure static HTML/CSS/vanilla JS: no build step, no package manager, no tests, no framework. UI copy is Korean.

## Running

- Any static server works; `file://` also works for normal use.
- Preview config: `.claude/launch.json` → `orbitlog` runs `.claude/serve.ps1` (a PowerShell `HttpListener` static server) on **port 8642**. Node is not installed and `python` on this machine is the Windows Store stub, so don't rely on them. Port 5173 is taken on this machine.
- The browser pane throttles or pauses `requestAnimationFrame` when hidden. The on-screen FPS counter and the sim clock stall there, so measure engine cost by constructing a detached `new OrbitEngine.Scene(canvas)` in the console and calling `render()`/`update()` directly. That's also how to test collision frequency headlessly (step `update(1/60)` with `warp = 200`).

## Architecture

Scripts load in order as plain globals (no modules): supabase-js (jsDelivr, pinned) → `js/config.js` → `js/engine.js` → `js/data.js` → `js/store.js` → `js/app.js`.

- **`store.js`** exposes `window.OrbitStore`: `SupabaseStore` when `ORBIT_CONFIG` has a URL + key, else `LocalStore`. Same interface: sync `snapshot()` for the first frame, then async `init()` / `loadUniverse()` / `createPlanet` / `addPost` / `destroyPlanet` / `logEncounter` / `subscribe()`. Supabase project `orbitlog` (ref `eofftrzjhvdogucscngd`); schema/RLS in `supabase/migrations/`. Planet creation goes through the `launch_planet` RPC (atomic planet + posts, also used for the one-time `orbitlog.v1` migration). If `TEXTURES` in engine.js changes, the `look_range` CHECK needs a migration too.
- app.js renders from `snapshot()` immediately, then `syncUniverse()` diffs the server universe by id. Writes are optimistic with rollback; `pending`/`gone` sets keep in-flight creates/deletes from being undone by a concurrent sync.

- **`engine.js`** exposes `window.OrbitEngine` and knows nothing about the DOM panels.
  - `Raster`: per-cell `ch` (char code) / `col` (packed RGB) / `z` (depth) typed arrays. Every draw goes through `put()` with a depth test, so draw order doesn't matter for occlusion.
  - `Camera`: spherical orbit camera with perspective projection. It works in pixel space, then divides by cell width/height (`cw`/`ch`) to get grid coords, so the non-square cell aspect is handled there. `ox` shifts the projection center so a focused planet stays visible beside an open side panel.
  - Passes: stars → asteroid belt → orbit paths → sun (+ corona) → bodies (sphere shading + procedural `texture()` + ring) → particles → `blit()` → `applyBloom()` → `drawOverlay()` (labels and brackets drawn as real canvas text/lines, so they handle Hangul).
  - **`blit()` performance**: it groups same-colored glyphs per row into one space-padded string per color. Per-cell `fillText` and a glyph-atlas `drawImage` approach were both measured slower. `pack()` quantizes colors to 16 levels per channel to keep the color-bucket count low; don't make that finer casually.
  - Orbits are Keplerian (`solveE` Newton iteration); period = `30 * (a/10)^1.5` s at 1×. Sim time `scene.t` = real seconds since `EPOCH` (2026-01-01 UTC) plus local warp offset, so every visitor sees the same planet layout.
  - Collision: `Scene.update` sub-steps the sim (≤0.15 sim-s per step) only when a "mine" body exists, and checks distance < `(sizeA+sizeB)*1.3+0.35`. The `contact` set (with hysteresis at 2.2× threshold) prevents re-triggering; `grace` delays checks after load/launch. It fires `scene.onCollide(other, mine)`.
  - `Portrait` reuses the same rasterizers into a small raster for the `<pre>` planet previews. It assumes the CSS cell is 0.6em × 1em (`line-height: 1`); changing `.portrait` font/line-height requires changing the aspect constant in `Portrait.render`.
- **`data.js`**: `window.ORBIT_SEEDS`, the "other people's" planets. `orbit`/`look` fields may be partial; `completeSpec()` fills the gaps deterministically from a hash of `id`.
- **`app.js`**: the UI layer.
  - `Store` (`window.OrbitStore`, see store.js) is the single persistence point. localStorage keys: `orbitlog.v1` (legacy/local mode), `orbitlog.cache` (last server universe), `orbitlog.queue` (unsent encounters), `orbitlog.auth` (Supabase session).
  - `register()` is the path for any planet into both the `planets` Map and the scene.
  - One user planet per browser (`state.me`). Its orbit comes from `randomSpec()`, which deliberately uses high eccentricity (0.28–0.58) so it crosses other orbits.
  - `onCollide` resets warp to 1×, logs the encounter, plays the impact overlay, then calls `openReader(id, {impact:true})`. A cooldown (`ui.impactUntil`) and the open-modal case only log and toast.
  - `layout()` sets `body.panel-open` / `body.reading` and the camera `goal.ox` offset from which panels are open. Narrow screens (≤760px) make panels full-width and skip the offset.

## Conventions

- No page scroll is a requirement: `html, body { overflow: hidden }`. Long content scrolls inside panels only.
- Visual language: ASCII/box-drawing glyphs, monospace (JetBrains Mono + Nanum Gothic Coding), `.frame` corner-bracket borders, buttons written as `[ LABEL ]`. Color tokens live on `:root` in `css/style.css`.
- Escape all user content with `esc()` before inserting it as HTML.
