// 데모 데이터 정리 — 실제 고객사를 넣기 전에 한 번.
//
//   node scripts/reset-demo.mjs            # 무엇을 지울지 보여만 준다
//   node scripts/reset-demo.mjs --yes      # 실제로 지운다
//   node scripts/reset-demo.mjs --yes --customer "테스트온보딩(주)"   # 이름 추가 지정
//
// 지우는 것: 시드 데모 고객사(네오위즈, 핀테크랩)와 그 하위 전부(프로젝트·서비스·
// 계정 매핑·담당자·팀·규칙·뮤트는 cascade), 그 계정 ID로 들어온 알람(이벤트·통지
// 이력·통지 작업은 cascade), 시드 내부 인원(@alert-hub.io). 미매핑 데모 알람
// (999999999999)도 함께. 나머지는 손대지 않는다.
//
// 이후 배포에서 시드가 다시 채우지 않도록 Vercel 환경변수 SEED_DEMO=false 를 둔다.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const extra = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--customer" && args[i + 1]) extra.push(args[++i]);

const DEMO_CUSTOMERS = ["네오위즈", "핀테크랩", ...extra];
const DEMO_ACCOUNTS = ["999999999999"];
const DEMO_INTERNAL_EMAIL = "@alert-hub.io";

const customers = await prisma.customer.findMany({
  where: { name: { in: DEMO_CUSTOMERS } },
  include: { projects: { include: { services: { include: { accounts: true } } } } },
});
const accountIds = [
  ...DEMO_ACCOUNTS,
  ...customers.flatMap((c) => c.projects.flatMap((p) => p.services.flatMap((s) => s.accounts.map((a) => a.accountId)))),
];
const alerts = await prisma.alert.count({ where: { accountId: { in: accountIds } } });
const internal = await prisma.contact.findMany({
  where: { customerId: null, email: { endsWith: DEMO_INTERNAL_EMAIL, mode: "insensitive" } },
});

console.log(`고객사 ${customers.length}건: ${customers.map((c) => c.name).join(", ") || "-"}`);
console.log(`계정 ID ${accountIds.length}건 → 알람 ${alerts}건`);
console.log(`내부 데모 인원 ${internal.length}명: ${internal.map((c) => `${c.name}<${c.email}>`).join(", ") || "-"}`);
const keep = await prisma.customer.count({ where: { name: { notIn: DEMO_CUSTOMERS } } });
console.log(`남는 고객사 ${keep}건`);

if (!yes) {
  console.log("\n--yes 를 붙이면 실제로 지웁니다.");
  process.exit(0);
}

await prisma.$transaction([
  prisma.alert.deleteMany({ where: { accountId: { in: accountIds } } }),
  prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } }),
  prisma.contact.deleteMany({ where: { id: { in: internal.map((c) => c.id) } } }),
]);
// 데모 인원만 있던 내부 팀은 비게 된다 — 이름만 남은 껍데기는 지운다.
const emptied = await prisma.team.findMany({ where: { customerId: null, members: { none: {} } } });
if (emptied.length) {
  await prisma.team.deleteMany({ where: { id: { in: emptied.map((t) => t.id) } } });
  console.log(`빈 내부 팀 ${emptied.length}개 삭제: ${emptied.map((t) => t.name).join(", ")}`);
}
console.log("\n정리 완료. 다음 배포에서 다시 채워지지 않도록 SEED_DEMO=false 를 설정하세요.");
