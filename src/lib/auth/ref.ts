// 사용자에게 보여 주는 참조 코드. 내부 원인은 로그에만 남기고 화면에는 이 코드만
// 나가므로(인증 화면 설계 원칙 04), 지원 문의 때 로그와 맞춰 볼 수 있다.
export function newRef(prefix = "AU"): string {
  const buf = new Uint8Array(3);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${prefix}-${hex.slice(0, 5)}`;
}
