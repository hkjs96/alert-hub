# 다중 고객사 대비 계획 (검토용 초안, 2026-10-20)

홈닉 한 곳으로 연결을 끝까지 확인했다(CloudWatch → SNS → alert-hub → Slack 버튼). 고객사가 여럿 붙으면
깨지거나 손이 많이 가는 곳을 코드와 공식 문서로 확인하고, 순서와 결정 사항을 정리한다. 아직 구현 전.

## 1. 조사 결과 — 지금 코드에서 확인한 것

| # | 지금 상태 | 고객사 여럿일 때 문제 | 근거 |
|---|---|---|---|
| A | SNS 서명만 검증. `TopicArn` 은 보지 않음. 구독 확인(SubscribeURL)은 어떤 주제든 자동 수락 | 아무 AWS 계정이나 자기 주제로 우리 URL 을 구독하고, 알람 본문에 **다른 고객사 계정 ID** 를 적어 보내면 그 고객사 알람으로 분류·페이징됨. 서명은 "SNS 가 보냈다"만 증명하지 "누가 보냈다"는 증명하지 않음 | `src/app/api/webhooks/[provider]/route.ts` 124–160행. AWS 문서: 예상 밖 TopicArn 은 거부하라 |
| B | `INGEST_TOKEN` 하나(전체 공용) | 모든 고객사 SNS URL 에 같은 값 → 한 곳이 새면 전부 교체. 토큰으로 고객사를 구분할 수도 없음 | 같은 파일 77행 |
| C | AWS 계정 1개 = 서비스 1개 (`AwsAccountMap.accountId @unique`) | MSP 고객사는 보통 한 계정(prd)에 웹·API·DB 가 같이 있음 → 지금은 계정 하나가 서비스 하나로만 분류됨. 라우팅 규칙은 **팀**만 바꾸고 **서비스**는 못 바꿈 | `prisma/schema.prisma` AwsAccountMap · RoutingRule |
| D | alert-hub 는 AWS 를 호출할 신원이 없음(받기만 함) | 그래프(GetMetricWidgetImage)·이후 조회 기능을 하려면 고객사 계정마다 읽기 권한이 필요 | 코드에 AWS SDK 없음, Vercel 에 AWS 키 없음 |
| E | 심각도: 경보 이름 접두어 `SEV-n` 만 인식 | 고객사마다 이름 규칙이 다름 → 대부분 "미지정" | `src/lib/normalize.ts` extractSeverity |
| F | 에스컬레이션(10분)·재발화 스로틀·묶음 창: 환경변수 하나 | 고객사 SLA 가 다르면 맞출 수 없음 | `src/lib/escalation.ts`, `refire-throttle.ts`, `notify-queue.ts` |
| G | 고객사 연결: 콘솔에서 SNS 주제·구독을 손으로, 리전마다 반복 | 고객사·리전 수만큼 수작업, 실수 여지 | 운영 절차 |

이미 고객사별로 되어 있어 손댈 필요 없는 것: 화면 범위(온콜=담당 고객사, 고객사 계정=자기 회사),
고객사별 Slack 채널, 포털 쓰기 권한, AI 메모 허용·근거 격리, 해결 기록 검색 범위.

## 2. 조사 결과 — 외부(공식 문서·업계 관행)

- **SNS**: 서명 검증 후 `TopicArn` 을 허용 목록과 대조해 스푸핑을 막는 것이 AWS 권고. `TopicArn` 은 SNS 가 서명하는 필드라 믿을 수 있고, 알람 본문의 `AlarmArn`/`AWSAccountId` 는 보낸 쪽이 적는 내용이라 그 자체로는 믿을 수 없다.
- **교차 계정 역할(그래프용)**: SaaS·모니터링 벤더 표준은 고객 계정의 IAM 역할 + **고객사별 ExternalId**(혼동된 대리인 방지). CloudFormation "Launch Stack" 링크로 고객이 역할을 만들게 하는 방식이 일반적. 조사된 벤더의 상당수가 ExternalId 를 잘못 구현했다는 보고가 있어 **백엔드에서 실제로 검증**해야 함.
- **alert-hub 쪽 신원**: Vercel 은 OIDC 로 AWS 역할을 빌릴 수 있음(`AssumeRoleWithWebIdentity`, `@vercel/functions` 의 `awsCredentialsProvider`). 저장되는 장기 키가 없다. 로컬 개발은 프로필로 대체.
- **그래프 API**: GetMetricWidgetImage — 호출당 지표 최대 100개, 20 TPS. 요금은 지표 1,000개당 약 $0.02(2차 출처, 서울 리전 공식 가격 확인 필요). 무료 티어 대상 아님. 호출한 계정(=고객사)에 청구.
- **SNS 대신 EventBridge**: 알람 상태 변화를 EventBridge 규칙으로 받아 중앙 계정에 모으는 방법도 있음(규칙은 알람과 같은 리전). 고객사가 이미 EventBridge 를 쓰면 대안이지만, 지금 SNS 경로가 동작하므로 1차 범위에서는 SNS 유지.

## 3. 설계안

### 3-1. 수집 보안 (A·B) — 두 번째 고객사 전에 필수
- **고객사별 수집 엔드포인트 토큰**: `Customer.ingestToken`(무작위, 화면에서 재발급). URL `…/api/webhooks/cloudwatch?t=<고객사 토큰>`. 전역 `INGEST_TOKEN` 은 전환 기간 호환용으로만 남겼다가 제거.
- **주제 허용 목록**: 등록된 고객사 AWS 계정에서 온 `TopicArn` 만 수락(구독 확인 포함). 첫 구독 확인 때 주제 ARN 을 기록하고 화면에 "연결된 주제"로 보여 줌.
- **교차 검증**: 토큰이 가리키는 고객사 ≠ 알람 계정의 고객사 → 거부하고 진단 화면에 "의심 수신" 기록.
- 홈닉 전환: 홈닉 계정을 등록 계정으로 인정하므로 지금 URL 은 계속 동작 → 홈닉 전용 URL 로 구독만 교체.

### 3-2. 계정 안에서 서비스 나누기 (C)
- `AwsAccountMap` 의 계정은 **기본 서비스**로 두고, **분류 규칙**(경보 이름 접두어 / 네임스페이스 / 리소스 패턴 → 서비스)을 고객사 안에 추가. 규칙이 없으면 지금처럼 계정의 기본 서비스.
- 기존 라우팅 규칙(→ 팀)은 그대로. 순서: 분류 규칙으로 서비스 결정 → 라우팅 규칙으로 팀 결정.
- 선택지: CloudWatch 알람 **태그**(예 `service=api`)로 분류 — 정확하지만 태그 조회에 AWS 권한(3-3) 필요. 1차는 이름/리소스 패턴, 태그는 3-3 이후.

### 3-3. AWS 읽기 권한 (D) — 그래프부터
- alert-hub 신원: **Vercel OIDC → 메가존 중앙 계정의 역할 1개** (장기 키 없음).
- 고객사 계정: 그 역할만 빌릴 수 있는 읽기 역할 `alert-hub-reader` (`cloudwatch:GetMetricWidgetImage`, 이후 `DescribeAlarms`·`ListTagsForResource` 정도). 신뢰 조건에 **고객사별 ExternalId**.
- 화면: AWS 계정 매핑에 "읽기 역할 ARN" 칸 + "연결 확인" 버튼(실제로 그래프 1장 받아 보여 줌).
- Slack: 그래프 PNG 를 스레드에 첨부(`files:write` 스코프 추가 필요). 실패해도 통지는 이미 나간 뒤(지금의 AI 메모처럼 비동기 잡).

### 3-4. 고객사 연결 원클릭 (G)
- 고객사 화면에서 **CloudFormation Launch Stack 링크** 생성. 한 번 실행으로: SNS 주제 + 고객사 토큰이 든 HTTPS 구독 + `alert-hub-reader` 역할(ExternalId 박힘).
- 여러 리전이면 StackSet 안내. 기존 경보에 주제 연결은 고객사가 선택(자동으로 기존 경보를 바꾸지 않음 — 24/7 영향 방지).

### 3-5. 고객사별 규칙 (E·F)
- 심각도 매핑: 고객사별 "이름에 X 가 있으면 SEV-n" 목록. 없으면 지금 규칙.
- 에스컬레이션 대기·재발화 스로틀: 고객사(선택적으로 서비스) 단위 재정의, 없으면 전역 기본.

## 4. 순서 제안

| 단계 | 내용 | 선행 조건 | 크기 |
|---|---|---|---|
| 1 | 3-1 수집 보안 + 홈닉 전용 URL 전환 | 없음 | 중 |
| 2 | 3-2 계정 안 서비스 분류(이름·리소스 패턴) | 홈닉 서비스 구성 정보 | 중 |
| 3 | 3-3 AWS 읽기 권한 + 그래프 | 메가존 중앙 AWS 계정, 홈닉 역할 생성 동의 | 중~대 |
| 4 | 3-4 원클릭 CloudFormation | 3-1·3-3 | 중 |
| 5 | 3-5 고객사별 심각도·에스컬레이션 | 두 번째 고객사의 규칙 | 소 |

## 5. 결정이 필요한 것

1. **두 번째 고객사 시점**: 언제쯤, 어느 고객사인지(규칙 설계에 실제 경보 이름 예시가 필요).
2. **홈닉 계정 구성**: `771283576189` 안에 서비스가 몇 개이고, 경보 이름에 서비스 구분이 들어가는지.
3. **메가존 중앙 AWS 계정**: alert-hub 전용으로 쓸 계정이 있는지(OIDC 신뢰를 걸 곳). 없으면 임시로 IAM 사용자 키.
4. **고객사 계정에 역할을 만드는 것**에 대한 고객사 동의 방식(계약·보안 검토). 그래프 비용이 고객사 청구서에 소액으로 찍힘.
5. **기존 경보 연결 방식**: 새 주제를 기존 경보에 "추가"하는 작업을 누가(메가존/고객사) 하는지.

## 6. 남은 확인 (구현 전에)

- CloudWatch GetMetricWidgetImage 서울 리전 공식 단가.
- SNS 를 다른 계정 주제로 보내는 구성(알람 계정 ≠ 주제 계정)을 홈닉이 쓰는지 — 쓰면 허용 목록을 "계정"이 아니라 "주제 ARN" 단위로.
- Vercel OIDC 를 Hobby 플랜에서 쓸 수 있는지, 함수 번들에 AWS SDK(CloudWatch·STS 클라이언트) 추가 시 크기.

## 근거
- AWS SNS 서명 검증: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html · https://repost.aws/knowledge-center/sns-verify-message-authenticity
- 교차 계정 역할·ExternalId: https://securitylabs.datadoghq.com/articles/securely-integrating-with-customers-aws-accounts/ · https://www.firemon.com/blog/advanced-techniques-for-defending-aws-externalid-and-cross-account-assumerole-access · https://aws.amazon.com/blogs/apn/tag/external-ids
- Vercel OIDC → AWS: https://vercel.com/docs/oidc/aws · https://vercel.com/docs/oidc/reference
- GetMetricWidgetImage 한도·단가(2차): https://docs.blinkops.com/docs/integrations/aws/actions/cloudwatch-get-metric-widget-image.md · https://github.com/nishinoshake/aws-rough/issues/37 · https://cur.vantage.sh/aws/amazoncloudwatch/cw:gmwi-metrics
- EventBridge 대안: https://repost.aws/knowledge-center/eventbridge-custom-cloudwatch-alarm-notifications · https://www.servicenow.com/docs/r/fr-FR/it-operations-management/event-management/aws-events-transform-script.html
