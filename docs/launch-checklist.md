# 홈닉 투입 체크리스트

코드 밖에서 사람이 해야 하는 일. 끝낸 항목은 `[x]` 로 바꾸고 날짜를 적는다. 상태 확인은 등록 관리 › 시스템 진단, 가입·승인·인원은 등록 관리 › 계정 · 접근.

## 1. 비밀 · 보안

- [ ] `INGEST_TOKEN` 을 Vercel 에 넣고, SNS 구독 URL 을 `https://alert-hub-rho.vercel.app/api/webhooks/cloudwatch?token=<값>` 으로. 진단 "웹훅 인증" 행이 "토큰 필수"가 되면 끝.
- [ ] 대화에 붙여넣었던 Slack Bot 토큰(`xoxb-…`)·App 토큰(`xapp-…`) **재발급** 후 새 값으로 교체.
- [ ] Neon DB 비밀번호 교체 → `DATABASE_URL`, `DIRECT_URL` 갱신.
- [ ] `CRON_SECRET` 확인.

## 2. Slack 앱

- [ ] `SLACK_BOT_TOKEN`, `SLACK_DEFAULT_CHANNEL`(예 `#alert-hub`), `APP_URL`(`https://alert-hub-rho.vercel.app`).
- [ ] Slack 앱 › Interactivity & Shortcuts 켜기 → Request URL `https://alert-hub-rho.vercel.app/api/slack/interactive`.
- [ ] Basic Information › Signing Secret → `SLACK_SIGNING_SECRET`.
- [ ] 봇 scope 에 `users:read` 추가(`chat:write` `chat:write.public` `im:write` `users:read.email` 은 이미) → 앱 재설치.
- [ ] 알람 채널에 `/invite @alert-hub`. 진단 "Slack 봇" 연결됨 · "Slack 버튼" 켜짐 확인.

## 3. 스케줄러

- [ ] 1분 주기 외부 크론 2개: `GET /api/cron/notify`, `GET /api/cron/escalate` (헤더 `Authorization: Bearer <CRON_SECRET>` 또는 `?secret=`). Vercel Cron 은 Hobby 에서 일 1회라 외부(cron-job.org, GitHub Actions 등)로.

## 4. 인증

- [ ] `AUTH_ALLOWED_DOMAINS=mz.co.kr,megazone.com`, `AUTH_ALLOWED_EMAILS=jsmini3814@gmail.com` 확인.
- [ ] 가입 방식 결정 — 등록 관리 › 계정 · 접근 › "가입 방식"에서 승인제 / 자동 승인 선택(환경변수 `AUTH_AUTO_APPROVE` 보다 우선).
- [ ] 관리자 계정 1명 이상 확인(진단 "관리자" 행).
- [ ] 홈닉 담당자에게 화면을 열어 줄 경우: 조직 트리 › 홈닉 패널 › **담당자 로그인**에 `homenic.co.kr` 등록. 첫 로그인은 승인 대기에 "고객사 · 홈닉"으로 올라온다.

## 5. 이메일 · 문자 (선택)

- [ ] 이메일: Google Workspace SMTP(`SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM`) 또는 SES.
- [ ] 문자: 보류. 재개 시 [docs/oncall-paging.md](oncall-paging.md) — 솔라피 가입 + 발신번호 등록 신청을 먼저.

## 6. 홈닉 마스터 데이터

- [ ] `SEED_DEMO=false`, `npm run demo:reset` 으로 데모 데이터 정리(이미 했으면 건너뜀).
- [ ] 고객사 홈닉 → 프로젝트 → 서비스 → AWS 계정 매핑(온보딩 위저드).
- [ ] 팀 만들고 멤버 순번, 필요하면 시간대 온콜(시프트) 설정.
- [ ] 서비스·규칙에 팀/담당 배정. 대시보드에 "미매핑" 배지가 없어야 한다.
- [ ] 서비스 런북 링크(+본문) 등록.
- [ ] 홈닉 Slack 채널(봇 채널 또는 그쪽 웹훅) 등록, "테스트 발송"으로 도달 확인.
- [ ] 담당자 통지 채널 확인(✓) — 인원 목록의 `?` 배지가 남아 있으면 확인 요청 발송.
- [ ] CloudWatch 알람 → SNS → 웹훅 연결 뒤 테스트 알람 1건으로 Slack 도달 · 상세 화면 · Ack 버튼 확인.

## 보류 (코드 쪽)

- [ ] 솔라피 문자·전화 사다리 — 발신번호 등록 뒤.
- [ ] AI 메모 — 해결 기록이 몇 주 쌓인 뒤 ([docs/aiops-market.md](aiops-market.md) 5·7절).
