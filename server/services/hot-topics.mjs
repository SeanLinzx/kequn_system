import { fetchWeiboHot, FALLBACK_HOT } from "./weibo.mjs";
import { callAI } from "./ai.mjs";
import { parseAiArray } from "../lib/ai-json.mjs";
import { HOT_TOPICS_ENRICH_SYSTEM, HOT_TOPICS_SEARCH_SYSTEM } from "../prompts.mjs";

const STATIC_TRENDS = [
  { kw: "巨好吃", tag: "情绪零食", source: "行业", marketingLabel: "巨好吃", note: "口语化安利" },
  { kw: "低GI", tag: "健康轻食", source: "行业", marketingLabel: "低GI轻食", note: "健康赛道" },
  { kw: "解馋", tag: "情绪零食", source: "行业", marketingLabel: "解馋必备", note: "晚间解馋" },
  { kw: "续命", tag: "即饮补货", source: "行业", marketingLabel: "通勤续命", note: "饮料场景" },
  { kw: "辣味", tag: "年轻偏好", source: "行业", marketingLabel: "辣味上新", note: "辣条麻辣" },
  { kw: "散称", tag: "深逛自选", source: "行业", marketingLabel: "散称自选", note: "家庭采购" },
];

function parseJsonArray(text) {
  return parseAiArray(text) || [];
}

function mergeHotTopics(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const w of list || []) {
      const key = String(w.kw || w.marketingLabel || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}

function normalizeWord(item) {
  return {
    kw: item.kw || item.marketingLabel || "",
    tag: item.tag || item.source || "综合",
    marketingLabel: item.marketingLabel || item.kw || "",
    note: item.note || "",
    source: item.source || item.tag || "综合",
    heat: item.heat || 0,
    rank: item.rank,
  };
}

async function enrichHotTopics(date, weiboWords, userId, storeId) {
  const weiboBrief = (weiboWords || [])
    .slice(0, 8)
    .map((w) => `${w.kw}[${w.source || "微博"}]`)
    .join("、");

  const system = HOT_TOPICS_ENRICH_SYSTEM;

  const user = `今天是 ${date}。已有微博热搜：${weiboBrief || "无"}。请补充其他来源话题 8-12 条。`;

  const raw = await callAI({
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    tools: [{ type: "web_search" }],
    userId,
    storeId,
    action: "enrich_hot_topics",
  });

  return parseJsonArray(raw).map((item) => normalizeWord(item));
}

export async function searchHotWords({ userId, storeId, limit = 20 } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  let weiboWords = [];

  try {
    weiboWords = (await fetchWeiboHot(12)).map((w) => normalizeWord({ ...w, source: "微博" }));
  } catch (e) {
    console.warn("[hot-topics] weibo failed:", e.message);
  }

  let enriched = [];
  try {
    enriched = await enrichHotTopics(date, weiboWords, userId, storeId);
  } catch (e) {
    console.warn("[hot-topics] enrich failed:", e.message);
  }

  let merged = mergeHotTopics(weiboWords, enriched);
  if (merged.length >= 5) {
    return {
      words: merged.slice(0, limit),
      source: enriched.length ? "mixed" : "weibo",
      message: `已汇总 ${merged.length} 个话题（微博 ${weiboWords.length} · 美团/时代/行业等 ${enriched.length}）`,
      counts: { weibo: weiboWords.length, enriched: enriched.length, total: merged.length },
    };
  }

  try {
    const system = HOT_TOPICS_SEARCH_SYSTEM;
    const raw = await callAI({
      input: [
        { role: "system", content: system },
        { role: "user", content: `今天是 ${date}。请输出适合门店海报借势的话题列表。` },
      ],
      tools: [{ type: "web_search" }],
      userId,
      storeId,
      action: "search_hot_web",
    });
    const arr = parseJsonArray(raw).map(normalizeWord);
    merged = mergeHotTopics(weiboWords, arr);
    if (merged.length >= 5) {
      return {
        words: merged.slice(0, limit),
        source: "web",
        message: `已通过联网检索汇总 ${merged.length} 个热点话题`,
        counts: { weibo: weiboWords.length, enriched: arr.length, total: merged.length },
      };
    }
  } catch (e) {
    console.warn("[hot-topics] web search failed:", e.message);
  }

  merged = mergeHotTopics(
    weiboWords,
    STATIC_TRENDS.map(normalizeWord),
    FALLBACK_HOT.map((w) => normalizeWord({ ...w, source: "内置" })),
  );

  return {
    words: merged.slice(0, limit),
    source: "fallback",
    message: `已使用可用话题 ${merged.length} 个（部分来源可能不可用）`,
    counts: { weibo: weiboWords.length, enriched: 0, total: merged.length },
  };
}
