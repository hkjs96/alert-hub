// Demo master data so a fresh clone has something to look at:
// two customers, the full containment tree, six contacts, and assignments
// that exercise every resolution rule (customer default, service override,
// account override). Alerts are NOT seeded — fire them through the real
// webhook so ingest, snapshot, and Slack wiring all run (see README).
//
// Refuses to run on a non-empty database: this is a demo seed, not a fixture
// loader, and it must never touch real master data.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const existing = await prisma.customer.count();
if (existing > 0) {
  console.log(
    `고객사 ${existing}건이 이미 있습니다 — 데모 시드는 빈 DB에만 넣습니다.`,
  );
  process.exit(0);
}

// --- 조직 계층 ----------------------------------------------------------------

const neowiz = await prisma.customer.create({
  data: {
    name: "네오위즈",
    projects: {
      create: [
        {
          name: "게임플랫폼",
          services: {
            create: [
              {
                name: "결제서비스",
                accounts: {
                  create: [
                    { accountId: "123456789012", alias: "payment-prod", environment: "prd" },
                    { accountId: "234567890123", alias: "payment-dev", environment: "dev" },
                  ],
                },
              },
              {
                name: "로그인서비스",
                accounts: {
                  create: [{ accountId: "345678901234", alias: "auth-prod", environment: "prd" }],
                },
              },
            ],
          },
        },
        {
          name: "커머스",
          services: {
            create: [
              {
                name: "주문API",
                accounts: {
                  create: [{ accountId: "456789012345", alias: "order-prod", environment: "prd" }],
                },
              },
            ],
          },
        },
      ],
    },
  },
  include: { projects: { include: { services: { include: { accounts: true } } } } },
});

const fintech = await prisma.customer.create({
  data: {
    name: "핀테크랩",
    projects: {
      create: [
        {
          name: "결제코어",
          services: {
            create: [
              {
                name: "정산엔진",
                accounts: {
                  create: [
                    { accountId: "678901234567", alias: "settlement-prod", environment: "prd" },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },
});

// --- 인원 (customerId null = 내부 MSP 엔지니어) --------------------------------

const [김도윤, 이서연, 박준혁, 최민서, 정하은, 강지호] = await Promise.all(
  [
    { name: "김도윤", department: "SRE팀", email: "dyoon@alert-hub.io", slackId: null },
    { name: "이서연", department: "SRE팀", email: "seoyeon@alert-hub.io", slackId: null },
    { name: "박준혁", department: "온콜팀", email: "junhyuk@alert-hub.io", slackId: null },
    { name: "최민서", department: "인프라팀", email: "mschoi@neowiz.example", customerId: neowiz.id },
    { name: "정하은", department: "백엔드팀", email: "hjeong@neowiz.example", customerId: neowiz.id },
    { name: "강지호", department: "결제팀", email: "jhkang@fintechlab.example", customerId: fintech.id },
  ].map((data) => prisma.contact.create({ data })),
);

// --- 배정 — 해석 규칙별로 하나씩 -----------------------------------------------
// · 고객사 기본값:   네오위즈 → 김도윤 → 이서연 (하위 전체가 상속)
// · 서비스 오버라이드: 결제서비스 → 최민서 → 박준혁 (고객사 기본값을 이김)
// · 계정 오버라이드:  payment-dev → 정하은 (서비스 담당까지 이김)
// 로그인서비스/주문API에는 아무것도 붙이지 않아 상속을 눈으로 확인할 수 있다.

const payment = neowiz.projects
  .flatMap((p) => p.services)
  .find((s) => s.name === "결제서비스");
const paymentDev = payment.accounts.find((a) => a.alias === "payment-dev");

await prisma.assignment.createMany({
  data: [
    { contactId: 김도윤.id, customerId: neowiz.id, order: 0 },
    { contactId: 이서연.id, customerId: neowiz.id, order: 1 },
    { contactId: 최민서.id, serviceId: payment.id, order: 0 },
    { contactId: 박준혁.id, serviceId: payment.id, order: 1 },
    { contactId: 정하은.id, accountId: paymentDev.id, order: 0 },
    { contactId: 강지호.id, customerId: fintech.id, order: 0 },
  ],
});

console.log("데모 시드 완료 — 고객사 2 · 인원 6 · 배정 6");
console.log("알람은 웹훅으로 흘려보내세요 (README의 curl 예시).");
await prisma.$disconnect();
