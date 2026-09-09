# AI 인시던트 대응(AIOps) 시장 조사 — 2026-09-09

목적: alert-hub 에 "알람이 오면 AI 가 정리·제안하는" 기능을 붙이기 전에, 시장이 무엇을 팔고 얼마를 받고 어디서
실패하는지 본다. 결론은 맨 아래 **우리 설계에 주는 함의**.

## 1. 한눈에

| 축 | 2024 | 2026 |
|---|---|---|
| 온콜 도구의 AI | 알람 그룹핑·노이즈 감소(AIOps 애드온) | **"가상 대응자" 에이전트**: 조사 → 원인 후보 → 런북/워크플로 추천 → (승인 후) 실행 |
| 과금 | 사용자당 월정액 | 사용자당 정액 + **AI 크레딧/조사 건당** 종량 |
| 옵저버빌리티 벤더 | 이상 탐지(Watchdog 등) | 자사 데이터로 자율 조사(Datadog Bits, Grafana Assistant) |
| 클라우드 | DevOps Guru(ML 이상 탐지) | **AWS DevOps Agent GA(2026-03)**: 분당 $0.50 에이전트 시간 |
| 스타트업 | 없음 | AI SRE 카테고리 형성(Resolve.ai 유니콘, Traversal, Cleric) |
| 국내 MSP | 사람 운영 | 베스핀 "헬프나우 오토MSP"(AI 운영 자동화), MSP 마진 압박의 돌파구로 AI 운영 |

공통 형태: **Slack 스레드에 AI 가 조사 결과를 단다.** 알람 → 스레드에 "무엇이 깨졌고 왜, 관련 변경, 다음 조치" → 사람이 승인.

## 2. 벤더별

### 온콜·인시던트 플랫폼

| 벤더 | AI 기능 (2026) | 가격 | 메모 |
|---|---|---|---|
| **PagerDuty** | SRE Agent = 가상 대응자. 에스컬레이션 정책에 에이전트를 한 단계로 넣음(EA). 과거 장애 분석, 승인된 자동화 실행, 수정 확인. Recommended Workflows(GA): 상황에 맞는 워크플로 순위. MCP/API 로 로그·메트릭·KB 연결 | 인시던트 관리 무료~$49/인, AIOps 애드온 ~$699/월, Runbook Automation $125+/인, 티어별 AI 크레딧 | 가장 우리와 구조가 비슷(스케줄 + 에스컬레이션 + 에이전트) |
| **incident.io** | Investigations: 페이지되는 순간 에이전트 RCA 시작. 대시보드·로그 증거 수집, 변경 상관, 수정 PR 초안, 포스트모템 | $31~45/인/월, AI SRE 포함 티어 | Slack 네이티브. "Slack 안에서 다 한다" 가 셀링 포인트 |
| **Rootly** | 대응·회고·커뮤니케이션 + AI SRE | $20/인/월~, AI SRE 는 "문의" | 협상가 $30~35/인 |
| **Grafana IRM** | Grafana Assistant 에 알람/인시던트 자동 전달 → 조사. Sift(로그 신규 오류, 최근 배포, 과부하 노드) | IRM Pro $20/활성 사용자 + $19 플랫폼 | 옵저버빌리티가 Grafana 인 팀에 한정 |
| **Atlassian JSM Ops** | Incident Command Center(2026-05): Rovo 로 원인 조사·조치 추천. Slack 채널 들어가면 AI 요약 자동 전송 | JSM 요금 | Opsgenie 는 2027-04-05 지원 종료 → 이탈 수요 |

### 옵저버빌리티·클라우드

| 벤더 | AI 기능 | 가격 | 메모 |
|---|---|---|---|
| **Datadog Bits AI SRE** | 24/7 에이전트가 알람을 자율 조사, 원인·조치 경로 제시. 메트릭·트레이스·로그·변경·RUM·DB·코드까지 사용 | AI 크레딧: 조사당 평균 6.5 크레딧 ≈ **$6.5/조사**(초기엔 조사 20건 $500) | Datadog 데이터가 있어야 함. 조사 1건 = 우리 알람 200건 요약 비용 |
| **AWS DevOps Agent (GA 2026-03-31)** | 옵저버빌리티·저장소·파이프라인·런북에 연결, 앱 관계 학습, 24시간 조사, Slack 에 RCA 게시. Bedrock AgentCore 기반 | **$0.0083/에이전트-초 ≈ $0.50/분 ≈ $30/시간** | GA 리전 6개(us-east-1, us-west-2, eu-central-1, eu-west-1, ap-southeast-2, ap-northeast-1). **서울(ap-northeast-2) 없음** |
| **CloudWatch investigations (Amazon Q)** | CloudWatch 알람에서 조사 시작, 로그·메트릭 분석, 수정 제안 | 프리뷰 무료, GA 가격 미정 | 고객사 계정 안에서 돌아야 함 |

### AI SRE 스타트업 (참고)

| 벤더 | 포지션 |
|---|---|
| Resolve.ai | 자율 우선. 인시던트 80% 를 사람 없이 종결 목표. 2025-12 $1B 밸류 |
| Traversal | 정확도 우선, ROI 공개(MTTR 평균 85% 감소 주장). AmEx 도입 |
| Cleric | 안전 우선, 읽기 전용 |
| HolmesGPT (OSS, CNCF 샌드박스) | Robusta+Microsoft 유지. 알람 + 텔레메트리 + **마크다운 런북**을 LLM 에 넣어 원인·다음 조치. Slack 으로 답. 멀티테넌트는 런북 메타데이터로 "이 고객엔 어떤 도구를 쓸 수 있나" 표시 |

### 국내

- 베스핀글로벌 "헬프나우 오토MSP": AWS 대상 AI 운영 자동화. 데이터독·클라우드플레어 등과 협업해 이상 탐지·자동 대응. 2026 목표는 "AI 가 운영을 보조 → 주도".
- 업계 기사 공통: MSP 마진 하락 → **AI 운영이 차별화 요소**. 알람 피로 해소(무의미 알람 필터·우선순위)가 첫 사례로 꼽힘.
- 메가존 공개 자료엔 미국 매출 성장 얘기만. 내부 AIOps 상품은 공개 검색에 안 잡힘 → 우리 프로젝트가 그 자리.

## 3. 정확도 — 시장이 배운 것

- **거짓 원인이 가장 큰 리스크.** 벤치마크(Causely 2026)에서 HolmesGPT(Claude Sonnet)·Codex 가 인과 데이터 없이 조사하면 **67% 거짓 양성**. 74분 전 잔여 신호를 원인으로 엮는 식. 인과 데이터를 주면 HolmesGPT 는 0%, Codex 33% 로 떨어짐.
- 실무 권고: 재현율보다 **정밀도 80% 이상**을 목표. 새벽에 틀린 제안은 신뢰를 한 번에 깎는다.
- 도입 패턴: **advisory(제안만) 모드로 시작** → 특정 저위험 알람 유형에서 일관되게 맞을 때만 자율 확대(Resolve 가이드).
- 독립 RCA 정확도 벤치마크는 아직 없음. 파일럿은 "지난 분기 최악의 장애 3건 재생"으로 채점.
- 환각 사례: 존재하지 않는 런북 단계·에러 코드를 자신 있게 지어냄 → 런북은 **우리가 저장한 원문만** 인용하게 해야 함.

## 4. 우리 설계에 주는 함의

1. **우리 자리는 "멀티테넌트 MSP 의 얇은 층"이다.** Datadog·AWS 에이전트는 고객사 계정/데이터 안에 앉아야 하고 서울 리전조차 없다. 고객사 5곳을 한 화면에서 보는 MSP 는 벤더별 AI 를 5개 켤 수 없다. alert-hub 가 가진 것(담당 스냅샷, 이벤트 타임라인, 라우팅 규칙, 같은 서비스의 과거 알람과 처리 이력)을 LLM 에 주면 벤더가 못 주는 답이 나온다: "이 고객사 이 서비스에서 지난달 같은 알람 3건, 전부 커넥션 풀 재시작으로 25분 내 해결".
2. **advisory 부터.** 스레드에 "요약 + 유사 과거 알람 + 런북 해당 절 + 제안 조치" 를 단다. 실행 버튼은 없다. 시장 전체가 이 순서로 갔다.
3. **환각 방어를 구조로.** LLM 에 주는 건 (a) 알람 원문 (b) 우리 DB 의 과거 알람·이벤트 (c) 서비스에 등록된 런북 텍스트. 답에는 근거 링크(알람 id, 런북 절)를 붙이고, 근거 없는 문장은 "근거 없음" 표시. 인과 데이터 없이 로그를 뒤지게 하지 않는다 — 우리는 로그가 없으니 애초에 그 실패 모드가 없다.
4. **런북은 링크가 아니라 텍스트로 저장.** 링크만 있으면 LLM 이 읽을 수 없다. 서비스·라우팅 규칙에 마크다운 런북(또는 URL + 캐시된 본문)을 둔다. HolmesGPT 의 런북 메타데이터 방식(고객사별 가능한 도구 표시)을 참고.
5. **비용은 문제가 아니다.** 알람당 요약 1회, 입력 약 4k 토큰(알람 + 과거 5건 + 런북 절) · 출력 500 토큰 기준 Claude Opus 5($5/$25 per 1M) 로 **알람당 약 $0.03**, 월 300건 = **$10 미만**. 런북·시스템 프롬프트를 프롬프트 캐시에 올리면 더 내려간다. Datadog 조사 1건($6.5) 비용으로 우리는 200건을 요약한다.
6. **피드백 루프를 처음부터.** 스레드 답변에 "도움됨 / 틀림" 버튼을 두고 저장. 정밀도를 측정하지 않으면 자율 확대 판단을 못 한다(시장이 배운 것 3번).
7. **자동 조치(3단계)는 고객사 계약 문제.** 실행 권한(SSM/Lambda)은 고객사 AWS 계정 안이고, 되돌릴 수 있는 조치만 허용 목록으로. AWS DevOps Agent 가 서울 리전에 오면 "실행"은 그쪽에 맡기고 우리는 판단·라우팅·기록에 집중하는 선택지도 있다.

## 5. 설계 원칙 — 정답이 아니라 학습 루프

과거 자료로 원인을 분석해 조치에 쓰는 것에 온전한 정답은 없다. 그래서 중심은 **해결할 때마다 배운 것을 남기고
다음에 꺼내 쓰는 루프**다. 근사값이 시간이 갈수록 좋아지는 구조.

1. **기록** — Resolve 할 때 "뭘 했더니 풀렸나" 한 줄(Slack 스레드 답장 또는 상세 폼). 강제 아님. 없으면 AI 가 "지난번 처리 기록 없음"이라고 솔직히 말한다.
2. **꺼내 쓰기** — 유사 알람(같은 서비스·메트릭·리소스 패턴)의 AI 메모에 그 기록들이 근거로 들어간다. 런북에 없던 해법이 여기서 처음 등장한다.
3. **승격** — 같은 해법이 반복되면 AI 가 "런북에 이 절을 추가할까요?" 초안을 만들고 **사람이 승인해야** 런북 텍스트에 들어간다. 런북 = 승인된 것, 해결 기록 = 날것. 섞지 않는다.
4. **채점** — 👍/👎 + "제안대로 했다/다르게 했다". 다르게 했으면 그것이 새 해결 기록. 알람 유형별 정밀도가 나와야 그 유형만 자율을 넓힐 수 있다.

우리 재료는 로그가 아니라 **사람의 해결 기록**이다. MSP 는 같은 고객사·서비스에서 같은 알람을 반복해 받으므로 빨리 쌓인다.
기록은 **고객사별 격리**: A 사에서 배운 해법을 B 사 알람의 근거로 쓰지 않는다(유형이 같아도 참고 표시만).

## 6. 2단계 설계 초안 (다음 대화에서 확정)

- 데이터: `Service.runbook`(markdown), `RoutingRule.runbook`(선택, 규칙별 절), `Alert.resolutionNote`(해결 한 줄 · 누가), `AlertInsight { alertId, summary, similar: alertId[], runbookRef, suggestion, model, tokens, feedback?, followed? }`, `RunbookProposal { serviceId, draft, basedOn: alertId[], approvedBy? }`
- 트리거: FIRING 팬아웃 직후 비동기 잡(아웃박스에 `insight` 채널 추가). 실패해도 통지는 이미 나감.
- 입력: 알람 정규화 본문 + 같은 서비스 최근 알람 5건(상태·처리 시간·마지막 이벤트 사유·ackedBy) + 런북 텍스트(라우팅 규칙 → 서비스 순).
- 출력(구조화): `{ summary, likely_cause?, evidence: [{kind:"alert"|"runbook", ref}], next_steps: [..], confidence }`. 근거 없는 next_step 은 버림.
- 표시: Slack 스레드 1줄 + 알람 상세 "AI 메모" 카드 + 👍/👎.
- 모델: Claude Opus 5 기본, 프롬프트 캐시(시스템 + 런북). 응답 3~10초라 스레드에 비동기로 붙는다.
- 게이트: `AI_INSIGHTS=on` 환경변수, 고객사별 끄기(고객사가 데이터 외부 전송을 거부할 수 있음 — 계약 확인 항목).

## 근거

- PagerDuty Spring 2026 릴리스 https://www.pagerduty.com/newsroom/pagerduty-operations-cloud-spring-2026-release/ · SRE Agent https://www.pagerduty.com/platform/ai-agents/sre/ · 가격 https://checkthat.ai/brands/pagerduty/pricing
- incident.io Investigations / 가격 https://incident.io/blog/5-best-ai-powered-incident-management-platforms-2026.md · Rootly 가격 https://rootly.com/pricing
- Datadog Bits Investigation https://www.datadoghq.com/product/ai/bits-investigation/ · 크레딧 가격 https://www.nobs.tech/blog/datadog-bits-ai-pricing-ai-credits-governance
- AWS DevOps Agent GA https://aws.amazon.com/blogs/mt/announcing-general-availability-of-aws-devops-agent/ · 가격·리전 https://akshayghalme.com/blogs/aws-devops-agent-complete-guide-2026/ · CloudWatch AI Operations https://aws.amazon.com/cloudwatch/features/aiops/
- Grafana IRM AI investigations https://grafana.com/whats-new/2025-11-07-ai-powered-investigations-available-for-irm/
- Atlassian Rovo / Incident Command Center https://www.atlassian.com/collections/service/ai · Opsgenie EOL https://alertops.com/blogs/opsgenie-end-of-life/
- AI SRE 스타트업 비교 https://wetheflywheel.com/en/comparisons/cleric-vs-resolve-ai-vs-traversal/ · Resolve.ai $125M https://techcrunch.com/2026/02/04/ai-sre-resolve-ai-confirms-125m-raise-unicorn-valuation/
- HolmesGPT (CNCF) https://www.cncf.io/blog/2026/04/21/auto-diagnosing-kubernetes-alerts-with-holmesgpt-and-cncf-tools/
- 정확도·환각 https://incident.io/blog/ai-root-cause-analysis-accuracy-testing-guide · Causely 벤치마크 https://arxiv.org/pdf/2605.18327
- 국내 MSP https://www.comworld.co.kr/news/articleView.html?idxno=51898 · http://www.newstheai.com/news/articleView.html?idxno=10670
- Claude API 가격(Opus 5 $5/$25 per 1M) — 이 세션의 claude-api 스킬 표(2026-06-24 캐시)
