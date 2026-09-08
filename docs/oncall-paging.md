# 온콜 호출(문자 · 전화) 조사 — 보류 (2026-09-08)

상태: **보류**. 결론은 났고 구현은 다른 기능 뒤로 미룬다. 재개할 때 이 문서부터 읽는다.

## 전제

- 온콜 에스컬레이션 사다리를 넣을 것이므로 문자와 전화는 같은 축에서 결정한다.
- 물량은 작다. 고객사 5곳 · 월 알람 300건 기준, 미ack 에스컬레이션만 나가므로 **문자 100통 · 전화 30통 / 월** 안팎.
- 지금 있는 것: Slack 봇/웹훅, SMTP 이메일, Twilio SMS 어댑터(`src/lib/notify/twilio.ts`). 전화는 없음.

## 결론

**문자와 전화 모두 솔라피(SOLAPI) 한 계정으로 간다.** Amazon Connect 는 쓰지 않는다.

| 채널 | 선택 | 이유 |
|---|---|---|
| 문자 | 솔라피 SMS | 건당 13~18원, 발신번호 1회 등록 후 국내 번호로 발신. 문자·음성이 같은 API 키·잔액·발신번호 |
| 전화 | 솔라피 음성메시지(TTS) | 통당 기본 200원 + 통화량. 회사 번호로 걸리고, 키패드 회신 옵션이 있어 "1번 누르면 ack" 가능 (파라미터는 구현 시 문서 재확인) |
| 이메일 | Workspace SMTP 또는 SES | 0원 ~ 월 $1. 코드 변경 없음 |

월 비용 합계는 **1만 원 안쪽**. 실제 걸림돌은 돈이 아니라 **발신번호 등록 절차**(사업자등록증 · 통신서비스 이용증명원, 심사 며칠).

## 검토했지만 고른 안 이유

| 옵션 | 왜 아닌가 |
|---|---|
| Amazon Connect (서울 리전) | 콜센터 제품. 전화 자체는 `StartOutboundVoiceContact` + TTS 플로우로 가능하고 초 단위 과금(최소 10초)이지만, 인스턴스·콜 플로우·Lambda 를 운영해야 하고 한국 DID 는 서류 제출·승인 대기가 있다. 문자는 End User Messaging 요금 위에 Connect 사용료($0.014/건)가 얹혀 더 비싸다. **예외:** 메가존에 이미 Connect 인스턴스와 한국 DID 가 있어 재활용 가능하면 그때 재검토 |
| AWS End User Messaging(SNS) 문자 직접 | 서류 없이 바로 되고 AWS 청구서에 합산되지만 국제 발신(건당 약 $0.03~0.04, 콘솔 요금표 확인 필요)이라 수신자에게 해외 번호로 뜬다. 서류를 못 밟는 상황의 임시안으로만 |
| Twilio Voice | 해외 번호로 발신되어 온콜 폰에 "국제전화"로 표시. 안 받거나 스팸 차단됨 |
| 카카오 알림톡 | 건당 7~9원으로 가장 싸지만 템플릿 사전 심사가 있어 매번 다른 알람 본문에 맞지 않음 |
| PagerDuty 류 SaaS | 1인당 월 $21+. 온콜 5명이면 월 $105+ 로 자체 구현 대비 10배 이상이고 alert-hub 와 기능이 겹침 |

## 재개할 때 만들 것

1. **어댑터** `src/lib/notify/solapi.ts`: `sendSms(to, text)`, `placeCall(to, text)`. HMAC 인증, 외부 패키지 없이 fetch.
   `SMS_PROVIDER=solapi|twilio`, `VOICE_PROVIDER=solapi` 로 선택. 환경변수: `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_FROM`(등록된 발신번호).
2. **사다리**(팀별 설정, 단계 켜고 끄기 · 대기 분):
   - 0분 Slack DM + 채널 (있음)
   - 5분 무응답 → 문자
   - 10분 무응답 → 전화 TTS "알림 허브. {고객사} {서비스} {심각도}. 확인하려면 1번"
   - 15분 무응답 → 다음 순번에게 처음부터, 팀장에게 문자
   `/api/cron/escalate` 가 한 틱에 한 칸씩 올리도록 확장. 통지 기록은 기존 `NotificationJob` 아웃박스에 `channel` 을 추가해 남긴다.
3. **전화 ack**: 키패드 회신 콜백을 받는 `/api/webhooks/solapi` 로 알람 ack 처리(기존 ack 액션 재사용, actor = 담당자 이름).
4. **진단 행**: 등록 관리 › 인증 화면에 "문자/전화 공급자" 행(잔액 조회 API 로 잔액도 표시).
5. **문서**: README 통지 채널 확인 표의 문자 행 갱신, 실제 고객사 투입 체크리스트에 발신번호 등록 추가.

## 사용자 쪽에서 먼저 해 둘 것

- 솔라피 가입, 발신번호 등록 신청(메가존 명의 1개로 시작. 고객사별 번호는 필요할 때).
- 메가존에 기존 Amazon Connect 인스턴스 · 한국 DID 가 있는지 확인. 있으면 위 예외 조항으로 재검토.

## 근거

- 솔라피 음성메시지 https://solapi.com/voice , 가격 https://solapi.com/pricing , 구간 할인 https://solapi.com/guides/tiered-pricing/
- Amazon Connect 발신 API https://www.repost.aws/knowledge-center/connect-outbound-calls-api , 한국 번호 포팅 https://docs.aws.amazon.com/connect/latest/adminguide/porting-numbers-sk.html , 요금 부록 https://aws.amazon.com/products/connect/customer/pricing/appendix/
- AWS End User Messaging 요금 https://aws.amazon.com/end-user-messaging/pricing/ , SNS 문자 요금 https://aws.amazon.com/sns/sms-pricing/
- Twilio 한국 음성 https://www.twilio.com/en-us/voice/pricing/kr , 한국 문자 https://www.twilio.com/en-us/sms/pricing/kr
- 알림톡 단가 비교 https://www.atozsoft.co.kr/insights/alimtalk-price-comparison-2026
- PagerDuty 요금 https://incident.io/blog/pagerduty-pricing-breakdown-2026
