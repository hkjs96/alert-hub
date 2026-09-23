import Anthropic from "@anthropic-ai/sdk";
import { INSIGHT_SCHEMA, INSIGHT_SYSTEM } from "@/lib/insight";

// Anthropic API 호출 한 곳. 서버 모듈은 이 함수만 알고, 테스트는 이 모듈을 통째로 mock 한다.
// 모델은 Claude Opus 5 고정(문서 6절). 시스템 프롬프트 + 런북은 캐시 블록으로 —
// 같은 서비스 알람이 잇달아 오면 그 부분은 다시 과금되지 않는다.

export const INSIGHT_MODEL = "claude-opus-5";

export function insightApiKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k ? k : null;
}

export interface InsightCallResult {
  /** 파싱 전 JSON 텍스트. 거부·빈 응답이면 null 과 함께 reason. */
  json: unknown | null;
  reason?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * 한 번 묻고 구조화 JSON 을 받는다. 안전 분류기가 거부하면(stop_reason refusal)
 * 서버가 기본 대체 모델로 다시 시도하도록 열어 둔다(fallbacks "default").
 */
export async function callInsightModel(input: { runbook: string | null; user: string }): Promise<InsightCallResult> {
  const apiKey = insightApiKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 미설정");
  // 25초 × (1+재시도 1) < 라우트 maxDuration 60초. 넘으면 행은 백오프로 다음 틱에.
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 25_000 });

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: INSIGHT_SYSTEM, cache_control: { type: "ephemeral" } },
  ];
  if (input.runbook) {
    system.push({ type: "text", text: `## 런북 원문 [R]\n${input.runbook}`, cache_control: { type: "ephemeral" } });
  }

  const res = await client.beta.messages.create({
    model: INSIGHT_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: input.user }],
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: INSIGHT_SCHEMA as unknown as Record<string, unknown> },
    },
  });

  const usage = {
    model: res.model,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
  };
  if (res.stop_reason === "refusal") {
    return { json: null, reason: `모델이 응답을 거부 (${res.stop_details?.category ?? "unknown"})`, ...usage };
  }
  const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
  if (!text.trim()) return { json: null, reason: `빈 응답 (stop_reason ${res.stop_reason})`, ...usage };
  try {
    return { json: JSON.parse(text), ...usage };
  } catch {
    return { json: null, reason: "응답이 JSON 이 아님", ...usage };
  }
}
