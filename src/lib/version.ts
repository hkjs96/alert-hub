import pkg from "../../package.json";

/** package.json 의 버전 — 로그인 푸터 등 표시용. */
export const APP_VERSION: string = (pkg as { version?: string }).version ?? "0.0.0";
