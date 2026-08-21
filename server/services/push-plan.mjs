import { callAI } from "./ai.mjs";
import { diagnose, loadFunnel } from "./funnel.mjs";
import { parseAiObject } from "../lib/ai-json.mjs";
import {
  DECISION_SYSTEM,
  REFINE_SYSTEM,
  DECISION_FOLLOWUP_SYSTEM,
  PLAN_FOLLOWUP_SYSTEM,
} from "../prompts.mjs";

export const PUSH_FACTOR_GROUPS = [
  { key: "pass", title: "提升过店人数", sub: "引流曝光 · 时段人流" },
  { key: "capture", title: "提升过店捕获率", sub: "门口进店 · 海报引流" },
  { key: "conv", title: "提升成交率", sub: "缺货排查 · 动线连带" },
  { key: "aov", title: "提升客单价", sub: "收银连带 · 组合优惠" },
];

export const PUSH_TEMPLATES = [
  {
    id: "traffic_boost",
    factor: "pass",
    name: "周边引流曝光",
    icon: "📣",
    desc: "招牌亮化 + 商圈联动提升过店",
    draftTitle: "提升过店人流 — 招牌与周边引流",
    draftSteps: [
      "检查门头灯牌、橱窗海报夜间可见性",
      "门口增设促销立牌与价格锚点",
      "与周边社区/写字楼联动小活动引流",
      "记录调整前后同小时过店对比",
      "拍照上传门头与立牌效果",
    ],
    suggestPoster: true,
  },
  {
    id: "hourly_display",
    factor: "pass",
    name: "分时段陈列优化",
    icon: "⏰",
    desc: "按主力人群调整门口陈列吸引过店",
    draftTitle: "分时段主力客群陈列切换",
    draftSteps: [
      "确认本时段主力人群（上班族/学生/家庭）",
      "调整门口陈列匹配该人群偏好品类",
      "6–9 点强化饮料+早餐，13–16 点强化散称卤味",
      "更新收银台 impulse 商品",
      "拍照上传调整前后对比",
    ],
    suggestPoster: false,
  },
  {
    id: "funnel_capture",
    factor: "capture",
    name: "进店率改善",
    icon: "🚪",
    desc: "门头可见性 + 门口引流陈列",
    draftTitle: "进店率偏低时段门口引流整改",
    draftSteps: [
      "检查门头灯牌、海报是否完好可见",
      "门口摆放即取即走品（饮料/关东煮/早餐）",
      "雨天增设伞架旁促销立牌",
      "17–19 点增派一人门口引导",
      "拍照上传门口全景与陈列细节",
    ],
    suggestPoster: true,
  },
  {
    id: "hotspot_poster",
    factor: "capture",
    name: "热点海报落地",
    icon: "🔥",
    desc: "热词营销海报张贴 + 话术执行",
    draftTitle: "热点促销海报门店落地执行",
    draftSteps: [
      "将海报张贴于门口、收银台、主通道三处",
      "核对海报主推 SKU 库存并补齐",
      "向全员讲解热点话术与推荐组合",
      "高峰时段抽查店员是否主动推荐",
      "拍照上传三处张贴效果",
    ],
    suggestPoster: true,
  },
  {
    id: "conversion_fix",
    factor: "conv",
    name: "转化提升排查",
    icon: "📋",
    desc: "缺货/动线/排队导致的进店不成交",
    draftTitle: "进店未成交排查与高频 SKU 保供",
    draftSteps: [
      "对照销售 TOP20 清单逐项查缺货",
      "清理收银台前排队动线障碍物",
      "补全饮料+价格带收银台陈列",
      "记录缺货品类并反馈采购",
      "拍照上传货架与收银台现状",
    ],
    suggestPoster: false,
  },
  {
    id: "basket_bundle",
    factor: "conv",
    name: "购物篮捆绑陈列",
    icon: "🛒",
    desc: "Lift 强关联品类相邻陈列 + 第二件优惠",
    draftTitle: "购物篮强关联品类捆绑陈列",
    draftSteps: [
      "盘点组合 SKU 库存，缺货先补",
      "将关联品类相邻陈列于收银台/主通道",
      "张贴组合价签或第二件优惠提示",
      "早高峰前培训店员推荐话术",
      "拍照上传陈列全景与价签特写",
    ],
    suggestPoster: false,
  },
  {
    id: "aov_lift",
    factor: "aov",
    name: "客单价连带",
    icon: "💰",
    desc: "收银台第二件优惠 + 组合推荐",
    draftTitle: "收银台连带推荐提升客单价",
    draftSteps: [
      "收银台摆放饮料+零食组合堆头",
      "设置满额加购或第二件优惠提示",
      "培训收银员一句话推荐话术",
      "晚高峰抽查推荐执行率",
      "拍照上传收银台陈列",
    ],
    suggestPoster: false,
  },
];

function getWeekRange(storeId) {
  const funnel = loadFunnel(storeId);
  const end = funnel.hi;
  const d = new Date(end + "T12:00:00");
  d.setDate(d.getDate() - 6);
  return { start: d.toISOString().slice(0, 10), end };
}

export function getPushInsight(storeId) {
  const { start, end } = getWeekRange(storeId);
  const diag = diagnose(storeId, start, end);
  const factors = diag.factors.map((f) => ({
    key: f.key,
    name: f.name,
    pct: +f.pct.toFixed(1),
    level: f.level,
    display: f.display || String(f.current),
    baseDisplay: f.baseDisplay || String(f.baseline),
  }));
  const weak = factors.filter((f) => f.pct < 0).sort((a, b) => a.pct - b.pct);
  const strong = factors.filter((f) => f.pct >= 5).sort((a, b) => b.pct - a.pct);
  const normal = factors.filter((f) => f.pct >= 0 && f.pct < 5);
  return {
    period: { start, end, days: diag.period.days },
    factors,
    weak,
    strong,
    normal,
    summary: diag.summary,
    formula: diag.formula,
    priorityFactor: weak[0]?.key || null,
  };
}

function buildDiagContext(insight) {
  if (!insight) return "";
  const lines = insight.factors.map(
    (f) => `${f.name}：当前 ${f.display}，较基准 ${f.pct >= 0 ? "+" : ""}${f.pct}%`,
  );
  return `分析区间：${insight.period.start} ~ ${insight.period.end}（${insight.period.days}天）
诊断摘要：${insight.summary}
四因子对比：
${lines.join("\n")}
优先改善：${insight.weak.map((f) => f.name).join("、") || "暂无明显短板"}
表现较好：${insight.strong.map((f) => f.name).join("、") || "—"}`;
}

export async function generatePushDecision({
  templateId,
  storeName,
  insight,
  userId,
  storeId,
}) {
  const tpl = PUSH_TEMPLATES.find((t) => t.id === templateId);
  const group = PUSH_FACTOR_GROUPS.find((g) => g.key === tpl?.factor);
  const user = `门店：${storeName || "门店"}
策略样板：${tpl ? tpl.name + " — " + tpl.desc : "未指定"}
策略方向：${group?.title || ""}（${group?.sub || ""}）

${buildDiagContext(insight)}

请基于以上诊断数据，输出针对该样板的「推荐决策」。`;

  const text = await callAI({
    input: [
      { role: "system", content: DECISION_SYSTEM },
      { role: "user", content: user },
    ],
    userId,
    storeId,
    action: "push_decision",
  });

  const parsed = parseAiObject(text);
  if (parsed) return parsed;

  return {
    title: tpl?.draftTitle || "门店经营决策",
    goal: tpl?.desc || "",
    rationale: insight?.summary || "",
    actions: tpl?.draftSteps?.slice(0, 3) || [],
    focusHours: "高峰时段",
    expectedEffect: "改善对应因子表现",
  };
}

export async function refinePushPlan({
  templateId,
  title,
  steps,
  brief,
  storeName,
  extraContext,
  imageUrls,
  decision,
  insight,
  userId,
  storeId,
}) {
  const tpl = PUSH_TEMPLATES.find((t) => t.id === templateId);
  const decisionBlock = decision
    ? `已确认推荐决策：
标题：${decision.title || ""}
目标：${decision.goal || ""}
理由：${decision.rationale || ""}
动作：${(decision.actions || []).join("；")}
重点时段：${decision.focusHours || ""}
预期：${decision.expectedEffect || ""}`
    : "";

  const user = `门店：${storeName || "门店"}
策略样板：${tpl ? tpl.name + " — " + tpl.desc : "自定义"}
${insight ? buildDiagContext(insight) + "\n" : ""}
${decisionBlock}
草稿标题：${title || ""}
草稿说明：${brief || ""}
草稿步骤：
${(steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n")}
${extraContext ? "补充背景：\n" + extraContext : ""}
${imageUrls?.length ? "附带海报/参考图，步骤中需包含张贴与效果拍照。" : ""}
请将推荐决策转化为执行者可逐条完成的任务方案。`;

  const text = await callAI({
    input: [
      { role: "system", content: REFINE_SYSTEM },
      { role: "user", content: user },
    ],
    userId,
    storeId,
    action: "refine_push_plan",
  });

  const parsed = parseAiObject(text);
  if (parsed) return parsed;

  return {
    title: title || decision?.title || tpl?.draftTitle || "门店执行任务",
    brief: brief || decision?.goal || tpl?.desc || "",
    deadline: "本周内",
    steps: steps?.length ? steps : decision?.actions || tpl?.draftSteps || [],
    verifyPoints: ["拍照上传执行结果", "店长验收签字"],
  };
}

export async function followupPushDecision({
  message,
  decision,
  insight,
  templateId,
  storeName,
  history,
  userId,
  storeId,
}) {
  const tpl = PUSH_TEMPLATES.find((t) => t.id === templateId);
  const context = `门店：${storeName || "门店"}
策略样板：${tpl ? tpl.name + " — " + tpl.desc : "—"}
${insight ? buildDiagContext(insight) : ""}

当前决策草稿：
标题：${decision?.title || ""}
目标：${decision?.goal || ""}
理由：${decision?.rationale || ""}
动作：${(decision?.actions || []).join("；")}
重点时段：${decision?.focusHours || ""}
预期：${decision?.expectedEffect || ""}`;

  const msgs = [{ role: "system", content: DECISION_FOLLOWUP_SYSTEM }];
  (history || []).forEach((h) => {
    if (h.role === "user" || h.role === "assistant") msgs.push({ role: h.role, content: h.content });
  });
  msgs.push({ role: "user", content: `${context}\n\n运营者追问：${message}` });

  const text = await callAI({ input: msgs, userId, storeId, action: "push_decision_followup" });
  const parsed = parseAiObject(text);
  if (parsed) {
    return {
      reply: parsed.reply || "已根据您的要求调整决策",
      decision: parsed.decision || decision,
    };
  }
  return { reply: text.slice(0, 300), decision };
}

export async function followupPushPlan({
  message,
  plan,
  decision,
  insight,
  templateId,
  storeName,
  history,
  userId,
  storeId,
}) {
  const tpl = PUSH_TEMPLATES.find((t) => t.id === templateId);
  const decisionBlock = decision
    ? `推荐决策：${decision.title || ""} — ${decision.goal || ""}`
    : "";
  const planBlock = `当前方案草稿：
标题：${plan?.title || ""}
说明：${plan?.brief || ""}
时限：${plan?.deadline || ""}
步骤：
${(plan?.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n")}
验收点：${(plan?.verifyPoints || []).join("；")}`;

  const context = `门店：${storeName || "门店"}
策略样板：${tpl ? tpl.name : "—"}
${insight ? buildDiagContext(insight) + "\n" : ""}
${decisionBlock}
${planBlock}`;

  const msgs = [{ role: "system", content: PLAN_FOLLOWUP_SYSTEM }];
  (history || []).forEach((h) => {
    if (h.role === "user" || h.role === "assistant") msgs.push({ role: h.role, content: h.content });
  });
  msgs.push({ role: "user", content: `${context}\n\n运营者追问：${message}` });

  const text = await callAI({ input: msgs, userId, storeId, action: "push_plan_followup" });
  const parsed = parseAiObject(text);
  if (parsed) {
    return {
      reply: parsed.reply || "已根据您的要求调整方案",
      plan: parsed.plan || plan,
    };
  }
  return { reply: text.slice(0, 300), plan };
}
