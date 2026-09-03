// Vercel 환경변수 일괄 등록 — 대시보드 폼 대신 CLI로.
//
//   1) npx vercel login && npx vercel link        (프로젝트당 한 번)
//   2) cp .env.vercel.example .env.vercel 후 값 채우기 (.env.vercel은 git 무시)
//   3) npm run env:push                            → production 에 등록
//      npm run env:push -- --deploy                → 등록 뒤 바로 재배포
//      npm run env:push -- --env preview           → 다른 환경
//
// 같은 이름이 이미 있으면 지우고 다시 넣는다(값 갱신). 빈 값은 건너뛴다.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const deploy = args.includes("--deploy");
const envIdx = args.indexOf("--env");
const target = envIdx >= 0 ? args[envIdx + 1] : "production";
const file = ".env.vercel";

if (!existsSync(file)) {
  console.error(`${file} 이 없습니다. cp .env.vercel.example ${file} 후 값을 채우세요.`);
  process.exit(1);
}

const entries = [];
for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq <= 0) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    console.warn(`건너뜀 (이름 형식 아님): ${key}`);
    continue;
  }
  if (!value) {
    console.warn(`건너뜀 (값 비어 있음): ${key}`);
    continue;
  }
  entries.push([key, value]);
}

if (!entries.length) {
  console.error("등록할 항목이 없습니다 — .env.vercel 의 값이 모두 비어 있습니다.");
  process.exit(1);
}

const vercel = (cmdArgs, input) =>
  spawnSync("npx", ["vercel", ...cmdArgs], { input, encoding: "utf8", shell: process.platform === "win32" });

const who = vercel(["whoami"]);
if (who.status !== 0) {
  console.error("Vercel CLI 로그인이 필요합니다: npx vercel login");
  process.exit(1);
}
if (!existsSync(".vercel/project.json")) {
  console.error("프로젝트가 연결돼 있지 않습니다: npx vercel link");
  process.exit(1);
}

console.log(`${target} 환경에 ${entries.length}개 등록 (계정: ${who.stdout.trim()})`);
let ok = 0;
for (const [key, value] of entries) {
  vercel(["env", "rm", key, target, "--yes"]); // 없으면 실패해도 무시
  const r = vercel(["env", "add", key, target], value + "\n");
  if (r.status === 0) {
    ok++;
    console.log(`  ✓ ${key}`);
  } else {
    console.error(`  ✗ ${key}\n${(r.stderr || r.stdout).trim()}`);
  }
}

console.log(`\n${ok}/${entries.length} 등록 완료. 현재 목록:`);
const ls = vercel(["env", "ls", target]);
process.stdout.write(ls.stdout || ls.stderr);

if (ok && deploy) {
  console.log("\n재배포 중…");
  const d = spawnSync("npx", ["vercel", "--prod", "--yes"], { stdio: "inherit", shell: process.platform === "win32" });
  process.exit(d.status ?? 1);
} else if (ok) {
  console.log("\n환경변수는 다음 배포부터 적용됩니다: npx vercel --prod  (또는 --deploy 옵션)");
}
