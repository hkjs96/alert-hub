// P3: 알람 상세 이동용 스켈레톤.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-[18px]">
      <div className="h-4 w-40 bg-stone-100" />
      <div className="h-32 border border-stone-200 bg-white" />
      <div className="h-48 border border-stone-200 bg-white" />
      <div className="h-64 border border-stone-200 bg-white" />
    </div>
  );
}
