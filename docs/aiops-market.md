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

## 7. 사례 — 다른 곳은 "과거 처리"를 어떻게 남기고 꺼내 쓰나 (2026-09-09 추가)

| 어디 | 기록은 어떻게 남나 (사람 타이핑 0 인가) | 꺼내 쓰기 | 배울 점 |
|---|---|---|---|
| **PagerDuty Past Incidents** | 같은 서비스의 과거 인시던트를 메타데이터 유사도(ML)로 자동 매칭. 사람이 적는 건 없음 | 현재 인시던트 옆에 "비슷한 과거 N건 · 누가 대응 · 언제 · 당시 조치". SRE Agent 는 과거 인시던트와 사용자 행동을 기억해 다음 대응에 씀 | **같은 서비스 + 메타데이터 유사**가 업계 표준 검색 키. 우리 3단 키와 같다 |
| **incident.io** | Slack 타임라인이 곧 기록. 채널 대화·조사 결과·이미지까지 자동 캡처 → 포스트모템 초안을 AI 가 섹션별로 씀. 사람은 다듬기만 | Co-Pilot 이 Slack 안에서 유사 과거 인시던트·관련 문서 제시. Investigations 는 원인 PR 을 근거 링크와 함께 | **대화가 기록이다.** 사람은 평소처럼 스레드에서 떠들고, 요약은 기계가 |
| **Cleric (self-learning AI SRE)** | 세 가지 신호를 자동 수집: ① 제안 후 시스템이 실제로 나아졌나(post-change monitoring) ② 사람이 제안대로 코드/설정을 바꿨나 ③ 대화 톤("이거 아니야, 다른 거")의 암묵적 피드백. 엔지니어의 지시는 그대로 메모리로 | 다음 조사에서 "어떤 진단 경로가 답으로 이어졌나"를 재사용. 신뢰도 점수 표시, 피드백으로 S/N 개선 | **피드백은 버튼이 아니라 결과다.** "재발했나 / 따라 했나"가 가장 정직한 채점 |
| **Resolve AI** | 시스템·배포·설정 변경을 지식 그래프로 자동 갱신. 런북과 과거 인시던트 학습을 "지식 에이전트"가 흡수 | 그래프를 따라가며 원인·상관 탐색 | 우리 규모(고객사 5곳)엔 과함. 그래프 대신 조직 트리 + 알람 이력이면 충분 |
| **Meta (2024)** | 과거 조사(investigation) 수천 건을 학습 데이터로. 휴리스틱 검색으로 후보 변경을 좁힌 뒤 fine-tuned Llama 2 가 순위 | 조사 생성 시점에 상위 5개 후보 코드 변경 제시, **42%** 적중(백테스트). 사람이 확인 | **백테스트**: 과거 조사에 "그때 알 수 있던 정보만" 주고 답을 맞히는지 잰다. 우리도 append-only 이벤트가 있어 가능 |
| **Microsoft RCACopilot (2024)** | 사전 정의된 핸들러가 진단 데이터를 자동 수집(4년 운영). 유사 과거 인시던트 검색 포함 | LLM 이 원인 **카테고리**를 예측, 1년치 운영 인시던트에서 **76.6%** 정확도. fine-tuning 없음 | 자유 문장보다 **카테고리 예측**이 정확도가 높고 채점이 쉽다. "재시작 · 설정/용량 · 자동 회복 · 기타" 같은 분류가 그것 |
| **Microsoft ICSE'23** | 인시던트 4만 건으로 GPT-3.x 를 zero-shot/fine-tune 비교 | 원인·완화 조치 추천. fine-tune 이 zero-shot 보다 낫지만 자유 문장 생성은 여전히 부정확 | 2026 관점: fine-tune 보다 **검색 + 구조화된 근거 + 강한 모델**이 현실적 |
| **Uber Genie (2024~)** | 내부 문서·위키·과거 Slack 스레드를 RAG 로. 답변은 SME 검수 + 피드백 | 온콜 Slack 채널에서 질문에 답. 7만 건 답변, 1.3만 엔지니어-시간 절감. 정확도 문제로 Enhanced Agentic RAG 전환 → 오답 60% 감소 | **Slack 스레드가 지식 원천**이 된 실제 사례. 첫 RAG 는 부정확했고, 검색·검증 단계를 더해 고쳤다 |

### 우리에게 맞는 학습 구성 (제안)

규모가 작다(고객사 5곳, 월 알람 수백 건). 벡터 DB · 지식 그래프 · fine-tuning 은 필요 없고, 있으면 오히려 채점을 흐린다.
**"기록은 기계가, 판단은 사람이, 채점은 결과가"** 세 층으로 간다.

1. **사실 층 (자동, 오늘 가능)** — 해결된 알람마다 구조화된 사실을 남긴다: 소요 시간, 누가 ack/resolve, 에스컬레이션 단계, 자동 회복 여부, 뮤트 여부, 24시간 내 재발 여부, 한 번 클릭 분류(재시작 · 설정/용량 · 자동 회복 · 기타). 나중에 CloudTrail 변경 이력(읽기 전용 역할)이 붙으면 "실제로 무엇을 했나"가 여기 들어간다.
2. **대화 층 (자동, AI 메모와 함께)** — Resolve 시점에 Slack 스레드를 LLM 이 두 줄로 요약해 저장(원문 링크 포함). incident.io · Uber 방식. 사람은 평소처럼 대화만.
3. **승인 층 (사람)** — 런북 텍스트. 같은 분류·같은 해법이 반복되면 AI 가 런북 절 초안을 내고 사람이 승인해야 들어간다.

**꺼내 쓰기**: 같은 고객사 안에서 서비스+메트릭+리소스 → 서비스+메트릭 → 서비스 순으로 최근 5건. 구조화 매치로 충분하고, 제목·사유 유사도(임베딩)는 재료가 쌓인 뒤 필요할 때만.

**채점 (Cleric 방식, 버튼 없이도)**: ① 제안한 분류와 실제 분류가 같았나 ② 제안 후 소요 시간이 그 유형의 평균보다 짧았나 ③ 24시간 내 재발했나(재발 = 그 조치는 오답). 👍/👎 버튼은 보조. 신뢰도는 모델 점수 대신 **건수**로 보여 준다("지난 4건 중 3건 재시작으로 해결"). 근거 건수가 2건 미만이면 제안 자체를 숨긴다.

**백테스트 (Meta 방식)**: 이벤트가 append-only 라 "그때 알 수 있던 정보만"으로 과거 알람에 제안을 내보고 실제 분류와 비교할 수 있다. 자율 확대 전 이 수치가 먼저다.

**격리**: 고객사 밖 기록은 근거로 쓰지 않는다. 같은 유형이 다른 고객사에 있으면 "다른 고객사에서 같은 유형 N건"이라는 힌트만, 내용은 없이.

### 근거
- PagerDuty Past Incidents https://support.pagerduty.com/main/docs/past-incidents · Generative AI https://www.pagerduty.com/platform/generative-ai/
- incident.io AI postmortem https://docs.incident.io/post-incident/postmortem-ai
- Cleric self-learning https://cleric.ai/blog/the-self-improving-ai-sre · 발표 https://www.businesswire.com/news/home/20251209625361/en/Cleric-Launches-the-First-Self-Learning-AI-SRE
- Resolve AI 지식 그래프 https://resolve.ai/blog/knowledge-graph-agentic-ai-incident-response
- Meta 2024 https://engineering.fb.com/2024/06/24/data-infrastructure/leveraging-ai-for-efficient-incident-response/
- Microsoft RCACopilot (EuroSys'24) https://dl.acm.org/doi/10.1145/3627703.3629553 · ICSE'23 https://arxiv.org/abs/2301.03797
- Uber Genie https://www.uber.com/gb/en/blog/genie-ubers-gen-ai-on-call-copilot/ · Enhanced Agentic RAG https://www.uber.com/gb/en/blog/enhanced-agentic-rag/
