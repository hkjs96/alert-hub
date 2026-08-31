---
name: persona-check
description: docs/personas.md의 페르소나 시나리오를 실제 화면에서 밟아 사용자 관점으로 검증한다. 인자로 페르소나 지정(온콜|관리자|고객사), 없으면 풀 패스. 기능 커밋 전 관련 시나리오 실행, 페이즈 종료 시 풀 패스.
---

# persona-check — 페르소나 관점 검증

docs/personas.md에 정의된 페르소나의 시나리오를 **실행 중인 실제 앱**에서
수행하고 P0/P1/P2 보고서를 만든다.

## 절차

1. **환경 기동**: 로컬 Postgres + `next start`(빌드돼 있으면) 또는
   `npm run demo`. 시드 데이터와 FIRING 알람이 최소 1건 있어야 한다 —
   없으면 README의 curl로 주입한다 (매핑 계정 123456789012, 미매핑
   999999999999).

2. **검증자 분리 (필수)**: 시나리오 수행은 **구현 컨텍스트가 없는
   서브에이전트**에게 시킨다. 서브에이전트에게 주는 것:
   - docs/personas.md의 해당 페르소나 섹션 (또는 파일 경로)
   - 실행 중인 앱 주소 (http://localhost:3000)
   - Playwright 구동법 (아래 스니펫)
   - 보고 형식
   서브에이전트에게 **금지**할 것: `src/` 소스 코드 읽기. 화면과 문서만 보고
   판단해야 실제 사용자의 시야가 재현된다. 페르소나가 여럿이면 병렬로 띄운다.

3. **판정**: 시나리오별로 성공/P0/P1/P2 + 근거 스크린샷. 등급 정의는
   personas.md를 따른다.

4. **후처리**: P0는 즉시 수정 후 해당 시나리오 재실행. P1은 커밋 전 수정이
   원칙(예외는 사유와 함께 백로그). P2는 백로그. 보고서 요약을 커밋 메시지나
   사용자 보고에 포함한다.

## Playwright 구동 (이 환경 기준)

```js
import { createRequire } from "module";
const require = createRequire("/opt/node22/lib/node_modules/playwright/");
const { chromium } = require("playwright");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
// page.goto / click / fill / screenshot({ fullPage: true }) 로 시나리오 수행
```

로컬 개발 머신이라면 `npx playwright test` 대신 위 스니펫을 node로 직접
실행하는 편이 간단하다. 스크린샷은 스크래치 디렉토리에 페르소나별로 모은다.

## 보고 형식

```
## 페르소나: 온콜 엔지니어 하은
- 시나리오 1 (한눈 파악): ✅ / P1 — <한 줄 근거> (shot: path)
- ...
### 종합: P0 n건 · P1 n건 · P2 n건
<페르소나의 한 줄 소감 — 등급 없는 인상은 여기만>
```
