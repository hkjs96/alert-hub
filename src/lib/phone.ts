// 전화번호 정규화 — 한국 번호를 E.164(+82…)로. 이미 +로 시작하면 숫자만 정리.
// 010-1234-5678, 01012345678, 82-10-…, +82 10 … 전부 +821012345678.

export function normalizePhone(raw: string | null | undefined, defaultCountry = "82"): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  const hasPlus = t.startsWith("+");
  let digits = t.replace(/\D/g, "");
  if (!digits) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith(defaultCountry) && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("0")) digits = digits.slice(1);
  return `+${defaultCountry}${digits}`;
}

export function isE164(v: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(v);
}
