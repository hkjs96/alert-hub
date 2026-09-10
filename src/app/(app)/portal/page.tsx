import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { authMode, getCurrentUser } from "@/server/auth";
import { getVisibleScope } from "@/server/scope";
import { canSeeCustomer } from "@/lib/scope";
import { getOwnershipByAccountIds } from "@/server/org";
import { describeTarget } from "@/lib/notify/targets";
import { channelState } from "@/lib/auth/verify";

export const dynamic = "force-dynamic";

const overline = "font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400";
const card = "border border-stone-200 bg-white";

function fmt(d: Date) {
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/**
 * 우리 회사 (읽기 전용) — 고객사 담당자가 자기 회사에 등록된 것을 본다: 조직 트리,
 * 서비스별 담당 순서, 담당자 명단, Slack 채널, 런북, 진행 중 점검 창. 수정은 없다.
 * 관리자는 ?customer= 로 어느 고객사든 같은 화면을 미리 볼 수 있다.
 */
export default async function PortalPage({ searchParams }: { searchParams: { customer?: string } }) {
  const me = await getCurrentUser();
  const scope = await getVisibleScope(me);
  let customerId = me?.customerId ?? searchParams.customer ?? null;
  if (!customerId && authMode() === "open") {
    customerId = (await prisma.customer.findFirst({ orderBy: { name: "asc" } }))?.id ?? null;
  }
  if (!customerId) redirect("/");
  if (!canSeeCustomer(scope, customerId)) redirect("/denied?screen=%EC%9A%B0%EB%A6%AC%20%ED%9A%8C%EC%82%AC&scope=1");

  const now = new Date();
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      projects: {
        orderBy: { name: "asc" },
        include: {
          services: {
            orderBy: { name: "asc" },
            include: { accounts: { orderBy: { accountId: "asc" } } },
          },
        },
      },
      contacts: { where: { active: true }, orderBy: { name: "asc" } },
      teams: { orderBy: { name: "asc" }, include: { members: { orderBy: { order: "asc" }, include: { contact: true } } } },
      notifyChannels: { orderBy: { createdAt: "asc" } },
      routingRules: { where: { enabled: true }, orderBy: { priority: "asc" }, include: { team: { select: { name: true } }, service: { select: { name: true } } } },
    },
  });
  if (!customer) redirect("/");

  const accounts = customer.projects.flatMap((p) => p.services.flatMap((s) => s.accounts));
  const ownership = await getOwnershipByAccountIds(accounts.map((a) => a.accountId));
  const projectIds = customer.projects.map((p) => p.id);
  const serviceIds = customer.projects.flatMap((p) => p.services.map((s) => s.id));
  const [silences, channelsByScope] = await Promise.all([
    prisma.silence.findMany({
      where: {
        revokedAt: null,
        endsAt: { gt: now },
        OR: [{ customerId }, { projectId: { in: projectIds } }, { serviceId: { in: serviceIds } }, { alert: { customerId } }],
      },
      orderBy: { startsAt: "asc" },
      include: { project: { select: { name: true } }, service: { select: { name: true } }, alert: { select: { title: true } } },
    }),
    prisma.notifyChannel.findMany({
      where: { OR: [{ customerId }, { projectId: { in: projectIds } }, { serviceId: { in: serviceIds } }] },
      orderBy: { createdAt: "asc" },
      include: { project: { select: { name: true } }, service: { select: { name: true } } },
    }),
  ]);
  const serviceRunbooks = customer.projects.flatMap((p) => p.services.filter((s) => s.runbookUrl || s.runbook).map((s) => ({ project: p.name, ...s })));

  return (
    <div className="space-y-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className={overline}>우리 회사</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.025em] text-stone-900">{customer.name}</h1>
          <p className="mt-1.5 text-sm text-stone-500">
            alert-hub 에 등록된 우리 회사 정보입니다. 읽기 전용이며, 변경이 필요하면 담당 MSP 엔지니어에게 요청하세요.
          </p>
        </div>
        {me?.role === "ADMIN" ? (
          <Link href={`/admin/org?level=customer&id=${customer.id}`} className="text-xs text-indigo-600 underline">
            관리자 패널에서 편집 →
          </Link>
        ) : null}
      </div>

      <section className={card}>
        <div className="border-b border-stone-200 px-6 py-3">
          <h2 className={overline}>프로젝트 · 서비스 · AWS 계정 · 담당 순서</h2>
        </div>
        {customer.projects.length === 0 ? (
          <p className="px-6 py-5 text-sm text-stone-400">등록된 프로젝트가 없습니다.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {customer.projects.map((p) => (
              <div key={p.id} className="px-6 py-4">
                <div className="text-sm font-semibold text-stone-900">{p.name}</div>
                {p.services.length === 0 ? (
                  <p className="mt-1 text-xs text-stone-400">서비스 없음</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {p.services.map((s) => (
                      <li key={s.id} className="border border-stone-100 bg-stone-50 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium text-stone-900">{s.name}</span>
                          {s.runbookUrl ? (
                            <a href={s.runbookUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 underline">📖 런북</a>
                          ) : null}
                        </div>
                        {s.accounts.length === 0 ? (
                          <p className="mt-1 text-xs text-stone-400">매핑된 AWS 계정 없음 — 이 서비스의 알람은 아직 들어오지 않습니다</p>
                        ) : (
                          <ul className="mt-1.5 space-y-1">
                            {s.accounts.map((a) => {
                              const own = ownership.get(a.accountId);
                              return (
                                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                  <span className="font-mono text-stone-700">{a.accountId}</span>
                                  {a.alias ? <span className="text-stone-500">{a.alias}</span> : null}
                                  {a.environment ? <span className="font-mono uppercase text-stone-400">{a.environment}</span> : null}
                                  <span className="text-stone-300">→</span>
                                  {own && own.contacts.length ? (
                                    <span className="text-stone-700">
                                      {own.contacts.map((c, i) => (
                                        <span key={c.id}>
                                          {i > 0 ? " → " : ""}
                                          <span className={i === 0 ? "font-medium text-stone-900" : ""}>{c.name}</span>
                                          {c.team ? <span className="text-stone-400"> ({c.team}{c.shift ? ` · ${c.shift}` : ""})</span> : null}
                                        </span>
                                      ))}
                                    </span>
                                  ) : (
                                    <span className="text-[#b42318]">담당 미지정</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-[18px] md:grid-cols-2">
        <section className={card}>
          <div className="border-b border-stone-200 px-6 py-3">
            <h2 className={overline}>담당자 ({customer.contacts.length}명)</h2>
          </div>
          {customer.contacts.length === 0 ? (
            <p className="px-6 py-5 text-sm text-stone-400">등록된 담당자가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {customer.contacts.map((c) => {
                const ch: string[] = [];
                if (c.slackId) ch.push(`Slack ${channelState(c.slackId, c.slackVerifiedAt) === "verified" ? "✓" : "?"}`);
                if (c.email) ch.push(`메일 ${channelState(c.email, c.emailVerifiedAt) === "verified" ? "✓" : "?"}`);
                if (c.phone) ch.push(`문자 ${channelState(c.phone, c.phoneVerifiedAt) === "verified" ? "✓" : "?"}`);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-6 py-2.5 text-sm">
                    <span className="font-medium text-stone-900">{c.name}</span>
                    {c.department ? <span className="text-xs text-stone-500">{c.department}</span> : null}
                    {c.email ? <span className="font-mono text-xs text-stone-500">{c.email}</span> : null}
                    <span className="ml-auto font-mono text-[11px] text-stone-400">{ch.join(" · ") || "연락 수단 없음"}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {customer.teams.length ? (
            <div className="border-t border-stone-100 px-6 py-3 text-xs text-stone-500">
              팀: {customer.teams.map((t) => `${t.name}(${t.members.map((m) => m.contact.name).join(" → ") || "빈 팀"})`).join(" · ")}
            </div>
          ) : null}
        </section>

        <section className={card}>
          <div className="border-b border-stone-200 px-6 py-3">
            <h2 className={overline}>Slack 통지 채널</h2>
          </div>
          {channelsByScope.length === 0 ? (
            <p className="px-6 py-5 text-sm text-stone-400">우리 회사 전용 채널이 없습니다 — MSP 전사 기본 채널로 통지됩니다.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {channelsByScope.map((ch) => (
                <li key={ch.id} className={`flex flex-wrap items-center gap-x-3 px-6 py-2.5 text-sm ${ch.enabled ? "" : "opacity-50"}`}>
                  <span className="font-medium text-stone-900">{ch.label}</span>
                  <span className="font-mono text-xs text-stone-500">{describeTarget({ kind: ch.kind, target: ch.target })}</span>
                  <span className="ml-auto text-xs text-stone-400">
                    {ch.service ? `서비스 ${ch.service.name}` : ch.project ? `프로젝트 ${ch.project.name}` : "고객사 전체"}
                    {ch.lastOkAt ? ` · 마지막 성공 ${fmt(ch.lastOkAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {customer.routingRules.length ? (
            <div className="border-t border-stone-100 px-6 py-3 text-xs text-stone-500">
              라우팅 규칙: {customer.routingRules.map((r) => `${r.name} → ${r.team.name}${r.service ? ` (${r.service.name})` : ""}`).join(" · ")}
            </div>
          ) : null}
        </section>
      </div>

      <div className="grid gap-[18px] md:grid-cols-2">
        <section className={card}>
          <div className="border-b border-stone-200 px-6 py-3">
            <h2 className={overline}>점검 창 · 뮤트 (진행 중 · 예정)</h2>
          </div>
          {silences.length === 0 ? (
            <p className="px-6 py-5 text-sm text-stone-400">진행 중이거나 예정된 점검 창이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {silences.map((s) => (
                <li key={s.id} className="px-6 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-mono text-[11px] ${s.startsAt <= now ? "text-[#b42318]" : "text-stone-400"}`}>
                      {s.startsAt <= now ? "진행 중" : "예정"}
                    </span>
                    <span className="font-medium text-stone-900">
                      {s.service ? `서비스 ${s.service.name}` : s.project ? `프로젝트 ${s.project.name}` : s.alert ? `알람 ${s.alert.title}` : "고객사 전체"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500">
                    {fmt(s.startsAt)} → {fmt(s.endsAt)} · {s.reason}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <div className="border-b border-stone-200 px-6 py-3">
            <h2 className={overline}>런북</h2>
          </div>
          {serviceRunbooks.length === 0 ? (
            <p className="px-6 py-5 text-sm text-stone-400">등록된 런북이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {serviceRunbooks.map((s) => (
                <li key={s.id} className="px-6 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-stone-900">{s.project} › {s.name}</span>
                    {s.runbookUrl ? (
                      <a href={s.runbookUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 underline">열기 ↗</a>
                    ) : null}
                  </div>
                  {s.runbook ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-stone-500">본문 보기</summary>
                      <pre className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-stone-700">{s.runbook}</pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
