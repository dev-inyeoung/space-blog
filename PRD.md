# PRD — ORBIT.LOG × Supabase 연동

| 항목 | 내용 |
|---|---|
| 문서 상태 | Draft v0.1 |
| 작성일 | 2026-10-20 |
| 대상 범위 | `js/app.js`의 `Store`, `js/data.js` 시드, 신규 Supabase 프로젝트 |
| 관련 문서 | [README.md](README.md) (데이터 스키마), [CLAUDE.md](CLAUDE.md) (아키텍처) |

---

## 1. 배경

ORBIT.LOG는 모든 블로그를 행성으로 그리는 ASCII 태양계입니다. 지금은 **혼자 보는 우주**입니다.

- 다른 사람의 행성은 `data.js`에 하드코딩된 시드 13개뿐입니다.
- 내가 만든 행성, 글, 충돌 기록은 브라우저 `localStorage`(`orbitlog.v1`)에만 저장됩니다. 그래서 다른 사람에게 보이지 않고, 기기를 바꾸거나 캐시를 지우면 사라집니다.
- 반면 우주 시간(`scene.t`)은 이미 `EPOCH`(2026-01-01 UTC) 기준 실제 경과 초라서, **같은 데이터만 공유하면 모든 접속자가 같은 행성 배치를 봅니다.** 공유 우주에 필요한 시간 축은 이미 있고, 빠진 것은 데이터 레이어뿐입니다.

## 2. 목표

| # | 목표 | 성공 기준 |
|---|---|---|
| G1 | **공유 우주** — 누군가 만든 행성이 모든 방문자에게 보인다 | A가 행성을 만들면 B의 화면에 새로고침 없이 5초 안에 나타남 |
| G2 | **영속성** — 내 행성·글이 기기와 캐시에 상관없이 유지된다 | 로그인한 계정으로 다른 브라우저에서 접속하면 내 행성이 그대로 보임 |
| G3 | **마찰 없는 첫 경험 유지** — 가입 없이 바로 행성을 만들 수 있다 | 첫 방문부터 행성 생성까지 걸리는 단계 수가 지금과 같음 |
| G4 | **정적 사이트 유지** — 빌드 단계, 패키지 매니저, 자체 서버 없음 | `index.html` + 정적 파일만으로 배포 가능(GitHub Pages 등) |
| G5 | **오프라인/장애 시 퇴화** — Supabase가 죽어도 우주는 뜬다 | 네트워크 차단 상태에서도 시드 + 로컬 캐시로 렌더링 |

## 3. 비목표 (이번 범위 밖)

- 댓글, 좋아요, 팔로우 같은 소셜 기능
- 마크다운이나 이미지 첨부 (본문은 지금처럼 **plain text + 문단 분리**)
- 한 사용자가 여러 행성을 보유하는 기능 (지금처럼 **1인 1행성**)
- 서버 권위의 충돌 판정 (충돌은 계속 클라이언트에서 계산)
- 관리자 대시보드 (Supabase Studio로 대체)

## 4. 사용자 & 핵심 시나리오

| 사용자 | 시나리오 |
|---|---|
| **관측자** (비로그인 방문자) | 접속하면 모든 행성이 공전하는 우주를 본다. 행성을 클릭해 블로그를 읽는다. 다른 사람이 막 쏘아 올린 행성이 실시간으로 나타난다. |
| **행성 주인** (익명 세션) | `N` → 랜덤 행성 생성 → 첫 로그 작성. 계정 없이도 같은 브라우저에서는 계속 내 행성으로 인식된다. |
| **행성 주인** (계정 연결) | 익명 세션을 이메일/GitHub 계정에 연결해서 다른 기기에서도 내 행성을 이어서 관리한다. |
| **기존 로컬 사용자** | 연동 배포 후 첫 접속 때 `localStorage`의 내 행성과 충돌 기록이 서버로 **자동 이관**된다. |

## 5. 기능 요구사항

우선순위: **P0** = 출시 필수, **P1** = 출시 직후, **P2** = 추후.

### 5.1 인증

| ID | 요구사항 | 우선순위 |
|---|---|---|
| A-1 | 첫 방문 시 **Supabase Anonymous Sign-in**으로 세션을 자동 발급한다. UI에는 로그인 화면이 없다. | P0 |
| A-2 | 세션은 supabase-js 기본 저장소(localStorage)에 유지되고 자동으로 갱신된다. | P0 |
| A-3 | About 또는 내 행성 리더에 `[ 계정 연결 ]` 버튼을 둔다. `linkIdentity`(GitHub OAuth) 또는 이메일 매직링크로 익명 사용자를 영구 사용자로 승격한다. | P1 |
| A-4 | 다른 기기에서 `[ 로그인 ]`하면 내 행성을 불러온다. | P1 |
| A-5 | 익명 세션 생성에 실패해도(쿼터 초과, 오프라인 등) **읽기 전용 모드**로 우주는 렌더링된다. | P0 |

### 5.2 행성 (planets)

| ID | 요구사항 | 우선순위 |
|---|---|---|
| P-1 | 접속 시 모든 행성을 한 번에 불러와 `register()`로 장면에 추가한다. | P0 |
| P-2 | 행성 생성 = `planets` insert. `orbit`/`look`은 지금처럼 클라이언트의 `randomSpec()` 결과를 그대로 저장한다. | P0 |
| P-3 | **1인 1행성**은 DB 제약(`owner_id UNIQUE`)으로 강제한다. 클라이언트의 `state.me`는 "내 `owner_id`의 행성"에서 파생한다. | P0 |
| P-4 | 행성 폐기 = `planets` delete. 글은 `ON DELETE CASCADE`로 함께 지운다. | P0 |
| P-5 | 다른 사용자의 행성 생성과 폐기를 **Realtime**으로 받아 `register()` / `scene.removeBody()`에 반영한다. 새 행성은 `scene.burst()` 연출로 등장시킨다. | P0 |
| P-6 | 이름, 작성자 수정 | P2 |

### 5.3 글 (posts)

| ID | 요구사항 | 우선순위 |
|---|---|---|
| L-1 | 행성 목록과 함께 글을 불러온다. 첫 로드에서 행성별로 요청하지 않도록 **한 번의 쿼리**(`planets` + embedded `posts`)로 가져온다. | P0 |
| L-2 | 새 로그 작성 = `posts` insert. 소유자 검증은 RLS가 한다. | P0 |
| L-3 | 다른 사람의 새 글을 Realtime으로 받는다. 해당 행성 리더가 열려 있으면 목록을 갱신하고, 인덱스에는 표시만 한다. | P1 |
| L-4 | 글 수정과 삭제 | P1 |
| L-5 | `date`는 클라이언트 로컬 날짜(`YYYY-MM-DD`)를 유지한다. 정렬과 감사 용도로는 서버 `created_at`을 별도로 둔다. | P0 |

### 5.4 충돌 기록 (encounters)

| ID | 요구사항 | 우선순위 |
|---|---|---|
| E-1 | `scene.onCollide` 때 `{ other_id, at }`를 insert한다. 충돌 판정과 연출은 지금처럼 클라이언트에서 한다. | P0 |
| E-2 | 충돌 기록은 **본인만 읽을 수 있다**(개인 관측 일지). HUD의 `ENC` 카운트와 리더의 "충돌 기록 N회"는 이 데이터로 그린다. | P0 |
| E-3 | insert가 실패하면 로컬 큐에 쌓아 두고 다음 접속 때 재전송한다. 연출은 네트워크와 무관하게 즉시 실행한다. | P1 |
| E-4 | (선택) 행성별 "피격 횟수"를 공개 집계로 보여 준다. 개별 로그가 아니라 집계 뷰만 노출한다. | P2 |

### 5.5 시드 데이터

| ID | 요구사항 | 우선순위 |
|---|---|---|
| S-1 | `data.js`의 시드 13개를 DB로 이관한다(`owner_id = NULL`, `is_seed = true`). `completeSpec()`으로 채워진 **최종 orbit/look 값을 저장**해서, 엔진 해시 로직이 바뀌어도 배치가 유지되게 한다. | P0 |
| S-2 | `data.js`는 삭제하지 않고 **오프라인 폴백**으로 남긴다. 서버 응답이 오면 서버 데이터가 우선한다. | P0 |

### 5.6 로컬 데이터 이관

| ID | 요구사항 | 우선순위 |
|---|---|---|
| M-1 | 첫 인증 직후 `orbitlog.v1`에 `me` 행성이 있고 서버에 내 행성이 없으면 그 행성과 글을 insert한다. | P0 |
| M-2 | `log`(충돌 기록)도 함께 이관한다. 이때 시드 id는 그대로 매핑되고, 다른 로컬 행성 id는 버린다. | P1 |
| M-3 | 이관에 성공하면 `orbitlog.v1`에 `migrated: true`를 기록해서 중복 이관을 막는다. 원본 데이터는 1 버전 동안 남겨 둔다. | P0 |

## 6. 데이터 모델

```sql
-- 행성 -----------------------------------------------------------------
create table public.planets (
  id          text primary key default ('u-' || substr(md5(random()::text), 1, 10)),
  owner_id    uuid unique references auth.users(id) on delete cascade,  -- NULL = 시드
  is_seed     boolean not null default false,
  name        text not null check (char_length(name) between 1 and 24),
  author      text not null check (char_length(author) between 1 and 24),
  handle      text not null check (char_length(handle) between 2 and 17),
  orbit       jsonb not null,   -- { a, e, inc, node, peri, phase }
  look        jsonb not null,   -- { size, tex, pal, ring, tilt, spin, seed }
  created_at  timestamptz not null default now(),
  -- 엔진이 깨지지 않는 범위만 허용 (randomSpec / completeSpec 기준)
  constraint orbit_range check (
    (orbit->>'a')::float between 5.5 and 45 and
    (orbit->>'e')::float between 0 and 0.9
  ),
  constraint look_range check (
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
```

> `look_range`의 `tex` 목록은 `engine.js`의 `TEXTURES` 배열과 반드시 일치시킵니다. 텍스처를 추가할 때 마이그레이션도 함께 해야 합니다.

### 클라이언트 매핑

| DB | 클라이언트 (`Planet`) | 비고 |
|---|---|---|
| `planets.id` | `id` | 시드는 기존 id(`vela`, `nori` …) 유지 |
| `planets.created_at` | `createdAt` | `YYYY-MM-DD`로 잘라서 표시 |
| `owner_id = auth.uid()` | `user: true`, `state.me = id` | |
| `posts[]` | `posts: [{ date, title, body }]` | `id`도 함께 보관(수정/삭제용) |
| `encounters[]` | `state.log: [{ id: other_id, at: ms }]` | `at`은 `Date.parse()`로 변환 |

## 7. 보안 (RLS)

모든 테이블에 RLS를 켭니다. 클라이언트에는 **publishable(anon) key만** 둡니다. service_role key는 시드 이관 스크립트에서만 쓰고 저장소에 커밋하지 않습니다.

| 테이블 | select | insert | update | delete |
|---|---|---|---|---|
| `planets` | 모두 | `owner_id = auth.uid()` 이고 `is_seed = false` | 소유자 (P2) | 소유자 |
| `posts` | 모두 | 대상 행성의 `owner_id = auth.uid()` | 소유자 (P1) | 소유자 (P1) |
| `encounters` | `user_id = auth.uid()` | `user_id = auth.uid()` | 불가 | 불가 |

추가 방어:

- **XSS**: DB 값은 모두 사용자 입력으로 취급합니다. 지금처럼 HTML에 넣기 전에 반드시 `esc()`를 거칩니다. Realtime 페이로드도 마찬가지입니다.
- **남용 방지**: 익명 가입에 Supabase Auth의 CAPTCHA(Turnstile)나 IP당 rate limit을 걸고, 글 insert는 사용자당 분당 N건으로 제한합니다(트리거 또는 Edge Function). 1인 1행성 제약 덕분에 행성 스팸은 계정 수로 제한됩니다.
- **값 검증**: orbit/look CHECK 제약으로 엔진을 깨뜨리는 값(예: `e ≥ 1`, 거대한 `size`)을 거부합니다. 클라이언트의 `completeSpec()` 클램프는 2차 방어선으로 남깁니다.

## 8. 클라이언트 아키텍처 변경

### 8.1 로딩

- supabase-js v2를 **CDN(jsDelivr, 정확한 버전 고정)**에서 `<script>`로 불러옵니다. 빌드 단계는 없습니다.
- 스크립트 순서: `supabase-js` → `js/config.js`(URL, publishable key) → `engine.js` → `data.js` → `js/store.js`(신규) → `app.js`
- `config.js`가 없거나 비어 있으면 지금처럼 **로컬 전용 모드**로 동작합니다(개발과 폴백 겸용).

### 8.2 Store 인터페이스

지금의 `Store`는 `load()/save(state)`로 전체 상태를 통째로 덮어씁니다. 이를 **연산 단위의 async API**로 바꿉니다.

```js
Store = {
  async init()                      // 세션 확보 + 로컬 이관(M-1)
  async loadUniverse()              // → { planets: Planet[], me: id|null, log: [] }
  async createPlanet(d)             // → Planet (서버가 확정한 id)
  async addPost(planetId, post)     // → post
  async destroyPlanet(planetId)
  async logEncounter(otherId, at)
  subscribe({ onPlanet, onPlanetGone, onPost })   // Realtime
}
```

- `LocalStore`와 `SupabaseStore`가 같은 인터페이스를 구현하고, `config.js`가 있는지에 따라 하나를 고릅니다.
- `app.js`에서 `save()`를 호출하는 곳 3군데(생성, 글 작성, 폐기)와 `onCollide`를 각각 해당 메서드 호출로 바꿉니다.

### 8.3 부트 시퀀스와 낙관적 UI

1. **즉시**: `data.js` 시드와 로컬 캐시(`orbitlog.cache`)로 장면을 그립니다. 부트 애니메이션은 그대로 둡니다.
2. **병렬**: `Store.init()`과 `loadUniverse()`를 실행합니다. 응답이 오면 id 기준으로 diff해서 추가/제거/갱신하고, 캐시를 갱신합니다.
3. 부트 로그에 `> uplink ESTABLISHED` / `> uplink OFFLINE — local cache` 한 줄을 추가합니다.
4. **쓰기는 낙관적으로**: 행성 생성, 글 작성은 UI에 먼저 반영합니다. 실패하면 롤백하고 토스트(`✕ 전송 실패 — 신호가 우주로 나가지 못했습니다`)를 띄웁니다.
5. 내 행성 생성처럼 id가 서버에서 확정되는 경우에는 임시 id로 `register()`했다가 응답 후 교체합니다. 아니면 클라이언트에서 id를 생성해 그대로 insert합니다(**권장 — 교체 로직이 필요 없음**).

### 8.4 Realtime

- 채널 하나에서 `planets`(INSERT/DELETE)와 `posts`(INSERT)를 구독합니다.
- 내가 일으킨 이벤트는 이미 낙관적으로 반영했으므로 id로 중복을 걸러냅니다.
- 탭이 숨겨지면(`visibilitychange`) 구독을 유지하되, 렌더 반영은 다시 보일 때 몰아서 합니다.

## 9. 비기능 요구사항

| 항목 | 기준 |
|---|---|
| 첫 렌더 | Supabase 응답을 기다리지 않음. 지금과 같은 시점에 첫 프레임이 나와야 함 |
| 전체 데이터 로드 | 행성 500개, 글 5,000개 기준 1회 쿼리 ≤ 1.5s (p75). 더 커지면 글 본문은 리더를 열 때 lazy load로 전환 |
| 렌더 성능 | 행성 수 증가가 `blit()`과 충돌 서브스텝 비용에 미치는 영향을 측정. 200개 이상이면 원거리 행성 LOD 검토 |
| 번들 | supabase-js는 CDN 1개 스크립트만 추가. 그 외 의존성 없음 |
| 무스크롤 원칙 | 신규 UI(계정 연결, 오프라인 표시)도 `overflow: hidden` 원칙과 `[ LABEL ]` 버튼 스타일을 따름 |

## 10. 마일스톤

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **M0** 준비 | Supabase 프로젝트 생성, 스키마 + RLS 마이그레이션, 익명 로그인 활성화, 시드 이관 스크립트 | Studio에서 시드 13개 확인. anon key로 select는 되고 insert는 거부됨 |
| **M1** 읽기 | `config.js`, `store.js`, 부트 시퀀스, 로컬 캐시 폴백 | 서버에서 직접 넣은 행성이 화면에 보임. 네트워크를 차단해도 렌더링됨 |
| **M2** 쓰기 | 익명 세션, 행성 생성/폐기, 글 작성, 충돌 기록, 로컬 이관 | 두 브라우저에서 각각 행성을 만들고 새로고침하면 서로 보임 |
| **M3** 실시간 | Realtime 구독, 등장 연출 | 새로고침 없이 5초 안에 상대 행성이 등장 (G1) |
| **M4** 계정 | 계정 연결/로그인(P1), 글 수정/삭제(P1), 충돌 재전송 큐 | 다른 기기에서 로그인하면 내 행성 복원 (G2) |

## 11. 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| 익명 세션이 브라우저 데이터 삭제와 함께 사라짐 | 행성 소유권 영구 상실 | 행성 생성 직후 "계정 연결" 안내 토스트(P1). 고아 행성은 정책에 따라 보존 |
| 행성 수 폭증으로 궤도가 혼잡해지고 렌더 비용이 증가 | 가독성과 FPS 저하 | 9장 성능 기준 모니터링. 장기 미활동 행성은 "외곽 궤도"로 이동하거나 숨기는 정책 검토 |
| 클라이언트 측 충돌 판정을 조작 | 충돌 기록 위조 | 기록이 본인 전용(E-2)이므로 타인에게 영향 없음. 공개 집계(E-4)를 도입할 때 재검토 |
| `completeSpec()` 해시 로직 변경 시 시드 배치가 바뀜 | 공유 배치 불일치 | S-1: 최종값을 DB에 저장해서 해시에 의존하지 않음 |
| 무료 플랜 한도(DB 크기, Realtime 동시 접속) | 서비스 중단 | 대시보드 알림 설정. 한도에 가까우면 Realtime 대신 60초 폴링으로 퇴화 |

## 12. 열린 질문

1. 계정 연결 수단은 GitHub OAuth와 이메일 매직링크 중 무엇을 우선할까?
2. 익명 사용자가 만든 뒤 오래 방치된 행성(예: 90일 무접속)을 정리할까?
3. 행성 이름에 중복을 허용할까? (지금은 허용, `id`로만 구분)
4. 충돌 횟수를 공개 랭킹으로 보여 줄까(E-4)?
5. 배포는 GitHub Pages로 확정할까? (`dev-inyeoung/space-blog` 저장소 기준)
