# ORBIT.LOG — ASCII 태양계 블로그

모든 블로그는 하나의 행성이 된다. 3D 장면 전체를 **문자 격자**로 래스터라이즈한 단일 페이지(no-scroll) 퍼블리싱 결과물입니다.

## 실행
정적 파일이므로 아무 정적 서버로 열면 됩니다. (`file://` 직접 열기도 동작)

## 구조
```
index.html        마크업 (부트 / 상단바 / 히어로 / 인덱스 / 리더 / HUD / 모달 / 충돌 연출)
css/style.css     디자인 시스템 (토큰, ASCII 프레임, 반응형)
js/engine.js      ASCII 3D 엔진 — 카메라, Z-buffer, 구면 셰이딩, 케플러 궤도, 충돌 판정, 포트레이트
js/data.js        시드 행성 블로그 13개 (타인이 만든 행성)
js/app.js         UI 레이어 — Store, 패널, 생성/작성 모달, 충돌 → 열람 흐름, 입력
```

## 기능 매핑
| 요구사항 | 구현 |
|---|---|
| 접속 시 모든 행성 블로그 열람 | 3D 장면 + `INDEX` 패널, 행성 클릭 → 리더 패널 |
| 나만의 행성 생성 (랜덤) | `나의 행성 만들기` → 궤도(a, e, i)·크기·표면 7종·팔레트 10종·고리 랜덤, 재굴림 가능 |
| 궤도 충돌 시 블로그 열람 | 내 행성은 이심률 0.28–0.58 타원 궤도 → 다른 궤도와 교차. 충돌 시 IMPACT 연출 후 상대 블로그 자동 오픈 + 충돌 기록 |
| 스크롤 없는 웹사이트 | `html, body { overflow: hidden }`, 긴 글은 패널 내부 스크롤 |

## 백엔드 연동 포인트
현재 사용자 데이터는 `localStorage`(`orbitlog.v1`)에 저장됩니다. 실제 공유 우주를 만들려면 `app.js`의 `Store.load / Store.save`와 `data.js`의 시드를 API로 교체하세요.

```js
Planet = {
  id, name, author, handle, createdAt,
  orbit: { a, e, inc, node, peri, phase },          // 라디안 / AU
  look:  { size, tex, pal, ring, tilt, spin, seed },
  posts: [{ date, title, body }]
}
```
우주 시간은 `Date.UTC(2026,0,1)` 기준 실제 경과 초이므로, 모든 접속자가 같은 행성 배치를 보게 됩니다.

## 단축키
`N` 새 행성 · `I` 인덱스 · `Space` 일시정지 · `1–4` 워프 · `←/→` 이전/다음 행성 · `Esc` 닫기
