// P3: 이동 즉시 반응하는 스켈레톤 — 서버 렌더가 끝나기 전에 프레임부터.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2.5">
        <div className="h-8 w-56 bg-stone-100" />
        <div className="h-4 w-80 bg-stone-100" />
      </div>
      <div className="grid grid-cols-2 gap-px border border-stone-200 bg-stone-100 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 bg-white" />
        ))}
      </div>
      <div className="h-24 border border-stone-200 bg-white" />
      <div className="h-96 border border-stone-200 bg-white" />
    </div>
  );
}
