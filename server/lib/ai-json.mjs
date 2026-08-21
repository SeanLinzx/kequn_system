/**
 * 从 AI 文本响应中解析 JSON 对象或数组。
 * AI 有时会在 JSON 外包裹 markdown 或说明文字，用正则提取后再 parse。
 */

function extractMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[0] : null;
}

export function parseAiArray(text) {
  const raw = extractMatch(text, /\[[\s\S]*\]/);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseAiObject(text) {
  const raw = extractMatch(text, /\{[\s\S]*\}/);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
