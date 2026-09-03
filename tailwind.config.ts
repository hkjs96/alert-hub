import type { Config } from "tailwindcss";

/**
 * v2 "웜 페이퍼 콘솔" (docs/design/tokens.md, alert-hub v2.dc.html 기준).
 *
 * stone·indigo 스케일을 v2 팔레트로 리맵한다 — 클래스 이름은 그대로 두고
 * 값만 바꿔서, 전 화면이 한 번에 같은 잉크/종이 톤을 입는다. 라운딩은
 * 전면 제거(직각)하되 full만 남긴다 — 상태 점·아바타 같은 원형 마크용.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    borderRadius: {
      none: "0",
      sm: "0",
      DEFAULT: "0",
      md: "0",
      lg: "0",
      xl: "0",
      "2xl": "0",
      "3xl": "0",
      full: "9999px",
    },
    extend: {
      colors: {
        stone: {
          50: "#faf8f4", // soft bg (hover, muted rows)
          100: "#f4f1ea", // hairline, chip bg
          200: "#ded9cf", // RULE — 모든 카드/컨트롤 보더
          300: "#d3cec3", // input border deco, placeholders
          400: "#9a978f", // FAINT — 보조 텍스트, 오버라인
          500: "#6b6862", // MUT — 본문 보조
          600: "#4a4842", // INK2
          700: "#33312c",
          800: "#262521",
          900: "#1b1a17", // INK
          950: "#131210",
        },
        indigo: {
          50: "#eef3fc",
          100: "#dbe6f9",
          200: "#b6cdf3",
          300: "#89abe9",
          400: "#4f7ddd",
          500: "#1a58d8",
          600: "#1451d6", // ACCENT
          700: "#0f3fa8",
          800: "#0c3286",
          900: "#0a2a6e",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-pretendard)",
          "Pretendard",
          "ui-sans-serif",
          "system-ui",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          "sans-serif",
        ],
        mono: ["var(--font-space-mono)", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
