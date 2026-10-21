/** 이미지 자리에 그대로 보이는 오류 안내(SVG) — <img> 가 깨진 아이콘 대신 이유를 보여 준다. */
export function errorSvg(message: string, title = "연결 실패"): string {
  const esc = message.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const lines = esc.match(/.{1,60}/g) ?? [esc];
  const tspans = lines.map((l, i) => `<tspan x="16" dy="${i ? 18 : 0}">${l}</tspan>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${60 + lines.length * 18}"><rect width="100%" height="100%" fill="#fdf6ec"/><text x="16" y="28" font-family="sans-serif" font-size="13" font-weight="700" fill="#b54708">${title}</text><text x="16" y="50" font-family="sans-serif" font-size="12" fill="#4a4842">${tspans}</text></svg>`;
}
