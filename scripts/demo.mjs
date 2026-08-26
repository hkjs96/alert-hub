// 원커맨드 데모: .env 준비 → 스키마 push(DB 기동 대기) → 시드 → dev 서버 →
// 샘플 알람 주입까지 한 번에. 목적은 "클론 직후 3분 안에 화면을 보는 것".
//
//   docker compose up -d db     (또는 아무 로컬 Postgres)
//   npm install
//   npm run demo                → http://localhost:3000
//
// 반복 실행해도 안전하다: .env는 있으면 건드리지 않고, 시드는 빈 DB에만
// 들어가며, 샘플 알람은 fingerprint dedup에 흡수된다.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const PORT = process.env.PORT ?? "3000";
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, opts = {}) =>
  spawnSync(cmd, { shell: true, stdio: "inherit", ...opts });

// --- 1. .env ----------------------------------------------------------------
if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  let env = readFileSync(".env", "utf8");
  const url = `postgresql://postgres:postgres@localhost:5432/alert_hub?schema=public`;
  env = env
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${url}"`)
    .replace(/^DIRECT_URL=.*$/m, `DIRECT_URL="${url}"`)
    .replace(/^APP_URL=.*$/m, `APP_URL="${BASE}"`);
  writeFileSync(".env", env);
  console.log("[demo] .env 생성 — docker-compose 기본 Postgres 기준");
} else {
  console.log("[demo] 기존 .env 사용");
}

// --- 2. 스키마 (DB 기동 대기 겸용) ------------------------------------------
let pushed = false;
for (let i = 0; i < 10; i++) {
  const r = run("npx prisma db push", i === 0 ? {} : { stdio: "pipe" });
  if (r.status === 0) {
    pushed = true;
    break;
  }
  console.log(`[demo] Postgres 대기 중… (${i + 1}/10)`);
  await sleep(2000);
}
if (!pushed) {
  console.error(
    "[demo] Postgres에 연결하지 못했습니다. `docker compose up -d db`를 먼저 실행했는지, .env의 DATABASE_URL이 맞는지 확인하세요.",
  );
  process.exit(1);
}

// --- 3. 시드 (빈 DB에만 들어감) ---------------------------------------------
run("npm run db:seed");

// --- 4. dev 서버 ------------------------------------------------------------
const dev = spawn(`npx next dev -p ${PORT}`, {
  shell: true,
  stdio: "inherit",
});
process.on("SIGINT", () => dev.kill("SIGINT"));
process.on("SIGTERM", () => dev.kill("SIGTERM"));

let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try {
    const res = await fetch(BASE, { redirect: "manual" });
    if (res.status < 500) {
      ready = true;
      break;
    }
  } catch {
    /* 아직 안 떴음 */
  }
}
if (!ready) {
  console.error("[demo] dev 서버가 60초 안에 뜨지 않았습니다.");
  dev.kill();
  process.exit(1);
}

// --- 5. 샘플 알람 ------------------------------------------------------------
// 시드의 매핑(123456789012=결제 payment-prod, 456789012345=주문 order-prod)을
// 이용해 담당 해석·스냅샷까지 보이게 한다. 999…는 미매핑 배너용.
const cw = (body) =>
  fetch(`${BASE}/api/webhooks/cloudwatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const alarm = (name, account, extra = {}) => ({
  AlarmName: name,
  AlarmArn: `arn:aws:cloudwatch:ap-northeast-2:${account}:alarm:${name}`,
  AWSAccountId: account,
  Region: "ap-northeast-2",
  NewStateValue: "ALARM",
  NewStateReason: "demo alert",
  Trigger: { MetricName: "CPUUtilization", Namespace: "AWS/EC2", Threshold: 90 },
  ...extra,
});

try {
  await cw(
    alarm("SEV-1 prod-db CPUUtilization high", "123456789012", {
      NewStateReason: "Threshold Crossed: 92.4 > 90",
      Trigger: {
        MetricName: "CPUUtilization",
        Namespace: "AWS/RDS",
        Threshold: 90,
        Dimensions: [{ name: "DBInstanceIdentifier", value: "prod-db" }],
      },
    }),
  );
  await cw(alarm("SEV-2 order-api 5xx spike", "456789012345"));
  await cw(alarm("SEV-3 unknown-svc memory", "999999999999"));
  await cw(alarm("SEV-4 auth latency", "345678901234"));
  await cw({
    ...alarm("SEV-4 auth latency", "345678901234"),
    NewStateValue: "OK",
    NewStateReason: "back to normal",
  });
  console.log("\n[demo] 샘플 알람 5건 주입 완료");
} catch (e) {
  console.error("[demo] 샘플 알람 주입 실패:", e.message);
}

console.log(`
[demo] 준비 끝 — 둘러보기:
  대시보드          ${BASE}/
  등록관리          ${BASE}/admin/customers
  알람 처리 순서    ${BASE}/admin/escalation
  멤버 관리         ${BASE}/admin/contacts

  알람 제목을 눌러 상세에서 Acknowledge / Resolve를 눌러보세요.
  (종료: Ctrl+C)
`);
