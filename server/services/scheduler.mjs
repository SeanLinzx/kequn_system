import { tables, sendMessage } from "../db.mjs";
import { searchHotWords } from "./hot-topics.mjs";
import { generateHotspotStrategy } from "./ai.mjs";
import { sendEmail, hotspotEmail, diagnosisReportEmail, siteLink } from "./email.mjs";
import { buildDiagnosisReport } from "./report-builder.mjs";

const FREQ_INTERVAL_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/** 按订阅频率检查是否到期并发送诊断报告邮件（demo：手动触发或未来接入 cron 均可复用） */
export async function runDueDiagnosisReports() {
  const subs = tables.report_subscriptions.filter((s) => s.active);
  for (const sub of subs) {
    const interval = FREQ_INTERVAL_MS[sub.frequency] || FREQ_INTERVAL_MS.weekly;
    const lastSentAt = sub.last_sent_at ? new Date(sub.last_sent_at).getTime() : 0;
    if (Date.now() - lastSentAt < interval) continue;
    try {
      await sendDiagnosisReportNow(sub.store_id, sub.frequency === "daily" ? "day" : sub.frequency === "monthly" ? "month" : "week", sub.emails);
      tables.report_subscriptions.update(sub.id, { last_sent_at: new Date().toISOString() });
    } catch (err) {
      console.error("[scheduler] diagnosis report push failed:", sub.store_id, err.message);
    }
  }
}

export async function sendDiagnosisReportNow(storeId, periodType, emailsCsv) {
  const store = tables.stores.findOne((s) => s.id === storeId);
  const report = await buildDiagnosisReport(storeId, periodType, {});
  const link = siteLink("/ops.html#diagnosis");
  const mail = diagnosisReportEmail({ storeName: store?.name || storeId, report, link });
  const emails = (emailsCsv || "").split(",").map((s) => s.trim()).filter(Boolean);
  const results = [];
  for (const to of emails) {
    results.push(await sendEmail({ to, ...mail }));
  }
  return { report, results };
}

export async function runHotspotPush() {
  let hotWords;
  let hotResult;
  try {
    hotResult = await searchHotWords({ limit: 12 });
    hotWords = hotResult.words;
    if (hotWords.length < 5) hotWords = hotResult.words;
  } catch {
    hotWords = (await import("./weibo.mjs")).FALLBACK_HOT;
  }

  const opsUsers = tables.users.filter((u) => u.role === "ops_manager" || u.role === "super_admin");

  for (const user of opsUsers) {
    const stores =
      user.role === "super_admin"
        ? tables.stores.all()
        : tables.user_stores
            .filter((us) => us.user_id === user.id)
            .map((us) => tables.stores.findOne((s) => s.id === us.store_id))
            .filter(Boolean);

    for (const store of stores) {
      try {
        const strategy = await generateHotspotStrategy({
          storeName: store.name,
          hotWords,
          period: "今日",
          userId: user.id,
          storeId: store.id,
        });
        tables.hotspot_pushes.insert({
          store_id: store.id,
          user_id: user.id,
          period: "今日",
          content_json: JSON.stringify({ hotWords, strategy }),
        });

        const link = siteLink("/ops.html#poster");
        sendMessage({
          userId: user.id,
          title: `${store.name} · 今日热点营销策略`,
          body: (strategy.strategies || [])
            .map((s) => s.title || s.topic)
            .filter(Boolean)
            .join("；"),
          link,
        });

        const mail = hotspotEmail({ storeName: store.name, strategies: strategy.strategies, link });
        await sendEmail({ to: user.email, ...mail });
      } catch (err) {
        console.error("[cron] hotspot push failed:", store.id, err.message);
      }
    }
  }
  console.log("[cron] hotspot push completed at", new Date().toISOString());
}

export function startScheduler() {
  // 定时推送已停用；如需恢复，取消注释并在 index.mjs 中调用 startScheduler()
  // cron.schedule("0 9 * * *", () => runHotspotPush().catch((e) => console.error("[cron]", e)), {
  //   timezone: "Asia/Shanghai",
  // });
  // cron.schedule("0 * * * *", () => runDueDiagnosisReports().catch((e) => console.error("[cron]", e)), {
  //   timezone: "Asia/Shanghai",
  // });
  console.log("[scheduler] 定时推送已停用（可在报告中心手动“立即发送一次”，或在此启用 cron）");
}
