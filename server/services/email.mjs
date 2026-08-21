import nodemailer from "nodemailer";

const SITE_URL = process.env.SITE_URL || "https://creaitor.cn/kequn/system";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user, pass },
  });
  return transporter;
}

export async function sendEmail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.warn("[email] SMTP not configured, skip:", subject, "->", to);
    return { ok: false, skipped: true };
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ""),
    });
    return { ok: true };
  } catch (err) {
    console.error("[email] failed:", err.message);
    return { ok: false, error: err.message };
  }
}

export function taskPushEmail({ taskTitle, steps, link, brief, verifyPoints, images }) {
  const stepList = (steps || []).map((s) => `<li>${s}</li>`).join("");
  const verifyList = (verifyPoints || []).map((s) => `<li>${s}</li>`).join("");
  const imgs = (images || [])
    .map((u) => `<p><img src="${u}" alt="参考图" style="max-width:100%;border-radius:8px;margin:8px 0"/></p>`)
    .join("");
  return {
    subject: `【分群运营】新执行任务：${taskTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px">
        <h2>您有新的执行任务</h2>
        <p><strong>${taskTitle}</strong></p>
        ${brief ? `<p style="color:#475569">${brief}</p>` : ""}
        <ol>${stepList}</ol>
        ${verifyList ? `<p><b>验收标准</b></p><ul>${verifyList}</ul>` : ""}
        ${imgs ? `<p><b>参考图/海报</b></p>${imgs}` : ""}
        <p><a href="${link}">点击进入任务台完成</a></p>
        <p style="color:#888;font-size:12px">分群数据运营系统</p>
      </div>`,
  };
}

export function hotspotEmail({ storeName, strategies, link }) {
  const items = (strategies || [])
    .map((s) => `<li><b>${s.title || s.topic}</b>：${(s.actions || []).join("；")}</li>`)
    .join("");
  return {
    subject: `【分群运营】${storeName} 今日热点营销策略`,
    html: `
      <div style="font-family:sans-serif;max-width:600px">
        <h2>${storeName} · 热点营销策略</h2>
        <ul>${items}</ul>
        <p><a href="${link}">选择热点并生成海报</a></p>
      </div>`,
  };
}

export function posterDoneEmail({ storeName, imageUrl, link }) {
  return {
    subject: `【分群运营】${storeName} 海报已生成`,
    html: `
      <div style="font-family:sans-serif;max-width:600px">
        <h2>${storeName} · 促销海报</h2>
        ${imageUrl ? `<p><img src="${imageUrl}" style="max-width:100%"/></p>` : ""}
        <p><a href="${link}">查看海报详情</a></p>
      </div>`,
  };
}

export function diagnosisReportEmail({ storeName, report, link }) {
  const periodLabel = { day: "日报", week: "周报", month: "月报" }[report.periodType] || "周报";
  const factorRows = (report.diagnosis.factors || [])
    .map((f) => `<li>${f.name}：${f.display || f.current} · 偏差 ${f.pct >= 0 ? "+" : ""}${Number(f.pct).toFixed(1)}%（${f.levelLabel}）</li>`)
    .join("");
  const solutionRows = (report.solutions || [])
    .map((s) => `<li><b>${s.title}</b>：${(s.steps || []).join("；")}</li>`)
    .join("");
  const strategyRows = (report.strategy || [])
    .map((s) => `<li>${s.label}：${s.reason}</li>`)
    .join("");
  const revenueChange = report.review?.revenue?.changePct;
  return {
    subject: `【分群运营】${storeName} 经营诊断${periodLabel}`,
    html: `
      <div style="font-family:sans-serif;max-width:640px">
        <h2>${storeName} · 经营诊断${periodLabel}</h2>
        <p style="color:#475569">${report.period.start} ~ ${report.period.end}</p>
        <h3>① 诊断</h3>
        <p>${report.diagnosis.summary}</p>
        <ul>${factorRows}</ul>
        <h3>② 方案</h3>
        <ul>${solutionRows}</ul>
        <h3>③ 策略</h3>
        <ul>${strategyRows || "<li>各维度表现平稳，暂无重点策略推荐</li>"}</ul>
        <h3>④ 复盘（对比上一周期）</h3>
        <p>营业额环比 ${revenueChange != null ? (revenueChange >= 0 ? "+" : "") + revenueChange + "%" : "—"}
          ${report.review?.target ? `，本期目标达成率 ${report.review.target.achievedPct ?? "—"}%` : ""}</p>
        <p><a href="${link}">进入运营工作台查看完整报告</a></p>
        <p style="color:#888;font-size:12px">分群数据运营系统 · 定时诊断报告</p>
      </div>`,
  };
}

export function siteLink(path) {
  return `${SITE_URL}${path}`;
}
