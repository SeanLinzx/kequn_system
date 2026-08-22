import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO5_DATA = join(
  __dirname,
  "..",
  "..",
  "..",
  "客群价值demo",
  "demo5-trade-area-map",
  "data",
);

const STORE_CSV_KEY = {
  "dadao-yintan": "零食店-长沙银杉路店",
};

const STORE_META = {
  "dadao-yintan": {
    district: "社区+学校混合型商圈",
    location: "长沙市望城区银杉路",
    storeType: "量贩零食店",
  },
  "mock-xiangjiang": {
    district: "滨江商住混合型商圈",
    location: "长沙市天心区湘江中路",
    storeType: "量贩零食店（模拟）",
  },
  "mock-meixi": {
    district: "大学城年轻客群商圈",
    location: "长沙市岳麓区梅溪湖路",
    storeType: "量贩零食店（模拟·待评估）",
  },
};

const PERSONAS = ["上班族", "中青年", "家庭主妇", "学生", "退休老人"];

function parseCsv(text) {
  const lines = text.trim().split("\n");
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).filter(Boolean).map((line) => {
    const vals = line.split(",");
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (vals[i] || "").trim();
    });
    return row;
  });
}

function personaStatus(p, st) {
  if (p.penetration < st.penetration * 0.35) {
    return { status: "bad", statusLabel: "低渗透" };
  }
  if (p.penetration >= st.penetration && p.conv < st.conv * 0.6) {
    return { status: "warn", statusLabel: "高渗透低转化" };
  }
  if (p.conv >= st.conv * 1.2) {
    return { status: "good", statusLabel: "转化优秀" };
  }
  return { status: "ok", statusLabel: "表现均衡" };
}

function passerShare(p, totalPassers) {
  return totalPassers > 0 ? p.avgPassers / totalPassers : 0;
}

function loadTradeAreaFromCsv(storeKey) {
  const popPath = join(DEMO5_DATA, "trade_area_population.csv");
  const crowdPath = join(DEMO5_DATA, "hourly_crowd_recent.csv");
  if (!existsSync(popPath) || !existsSync(crowdPath)) return null;

  const popRows = parseCsv(readFileSync(popPath, "utf8")).filter((r) => r.store === storeKey);
  const crowdRows = parseCsv(readFileSync(crowdPath, "utf8")).filter((r) => r.store === storeKey);
  if (!popRows.length || !crowdRows.length) return null;

  const dates = [...new Set(crowdRows.map((r) => r.date))].sort();
  const nDays = Math.max(dates.length, 1);

  const personas = PERSONAS.map((persona) => {
    const pr = crowdRows.filter((r) => r.persona === persona);
    const passers = pr.reduce((s, r) => s + Number(r.passers || 0), 0) / nDays;
    const enters = pr.reduce((s, r) => s + Number(r.enters || 0), 0) / nDays;
    const popRow = popRows.find((r) => r.persona === persona);
    const population = popRow ? Number(popRow.population) : 0;
    const popShare = popRow ? Number(popRow.share) : 0;
    const penetration = population > 0 ? passers / population : 0;
    const conv = passers > 0 ? Math.min(enters / passers, 1) : 0;
    return {
      name: persona,
      population,
      popShare: popShare,
      popSharePct: +(popShare * 100).toFixed(1),
      avgPassers: Math.round(passers),
      avgEnters: Math.round(enters),
      penetration,
      penetrationPct: +(penetration * 100).toFixed(1),
      convPct: +(conv * 100).toFixed(1),
      tags: popRow?.tags || "",
    };
  });

  const totalPop = personas.reduce((s, p) => s + p.population, 0);
  const totalPassers = personas.reduce((s, p) => s + p.avgPassers, 0);
  const totalEnters = personas.reduce((s, p) => s + p.avgEnters, 0);
  const st = {
    totalPop,
    dailyPassers: Math.round(totalPassers),
    dailyEnters: Math.round(totalEnters),
    penetration: totalPop > 0 ? totalPassers / totalPop : 0,
    conv: totalPassers > 0 ? Math.min(totalEnters / totalPassers, 1) : 0,
    nDays,
    dateLo: dates[0] || "",
    dateHi: dates[dates.length - 1] || "",
  };

  for (const p of personas) {
    Object.assign(p, personaStatus(p, st));
    p.passSharePct = +(passerShare(p, totalPassers) * 100).toFixed(1);
  }

  const sortedGap = [...personas].sort(
    (a, b) => passerShare(b, totalPassers) - b.popShare - (passerShare(a, totalPassers) - a.popShare),
  );
  const over = sortedGap[0];
  const under = sortedGap[sortedGap.length - 1];
  const lowPen = [...personas].sort((a, b) => a.penetration - b.penetration)[0];

  const highlights = [];
  if (totalPop) {
    highlights.push(
      `1 公里商圈约 ${totalPop.toLocaleString("zh-CN")} 人，日均过店 ${st.dailyPassers.toLocaleString("zh-CN")} 人，总体渗透率 ${(st.penetration * 100).toFixed(1)}%。`,
    );
  }
  if (over) {
    highlights.push(
      `流量偏多：${over.name} 占商圈 ${over.popSharePct}%，过店占比 ${over.passSharePct}%，是门店主要客流来源。`,
    );
  }
  if (under && under !== over) {
    highlights.push(
      `渗透洼地：${under.name} 商圈内约 ${under.population.toLocaleString("zh-CN")} 人，过店占比仅 ${under.passSharePct}%，动线不经过门店。`,
    );
  }
  if (lowPen?.status === "bad") {
    highlights.push(
      `${lowPen.name} 渗透率仅 ${lowPen.penetrationPct}%，建议社群引流或异业联动把人带到门口。`,
    );
  }

  return {
    stats: {
      totalPop: st.totalPop,
      dailyPassers: st.dailyPassers,
      dailyEnters: st.dailyEnters,
      penetrationPct: +(st.penetration * 100).toFixed(1),
      convPct: +(st.conv * 100).toFixed(1),
      nDays: st.nDays,
      dateLo: st.dateLo,
      dateHi: st.dateHi,
    },
    personas: personas.sort((a, b) => b.penetration - a.penetration),
    highlights: highlights.slice(0, 3),
  };
}

function mockTradeArea(storeId) {
  const meta = STORE_META[storeId] || { district: "演示商圈", location: "模拟地址", storeType: "零食店" };
  const scale = storeId === "mock-meixi" ? 0.85 : storeId === "mock-xiangjiang" ? 0.92 : 1;
  const base = loadTradeAreaFromCsv(STORE_CSV_KEY["dadao-yintan"]);
  if (!base) return { available: false, reason: "商圈数据未配置" };

  const stats = {
    ...base.stats,
    totalPop: Math.round(base.stats.totalPop * scale),
    dailyPassers: Math.round(base.stats.dailyPassers * scale),
    dailyEnters: Math.round(base.stats.dailyEnters * scale),
  };
  const personas = base.personas.map((p) => ({
    ...p,
    population: Math.round(p.population * scale),
    avgPassers: Math.round(p.avgPassers * scale),
    avgEnters: Math.round(p.avgEnters * scale),
  }));

  return {
    available: true,
    isMock: true,
    ...meta,
    stats,
    personas,
    highlights: [
      `模拟店基于银杉路零食店商圈结构缩放（${(scale * 100).toFixed(0)}%），供连锁零食店转型/闭店决策演示。`,
      base.highlights[1] || "",
      "切换至长沙望城银杉路零食店可查看完整商圈地图与渗透分析。",
    ].filter(Boolean),
    reportUrl: null,
  };
}

export function getTradeArea(storeId) {
  const meta = STORE_META[storeId];
  if (!meta) return { available: false, reason: "未知门店" };

  const csvKey = STORE_CSV_KEY[storeId];
  if (csvKey) {
    const data = loadTradeAreaFromCsv(csvKey);
    if (!data) return { available: false, reason: "商圈 CSV 未找到" };
    return {
      available: true,
      isMock: false,
      ...meta,
      ...data,
      // 旧系统报告库（/fenqun/example1、/fenqun/demo5）不在本项目部署中，置空避免死链
      reportUrl: null,
      mapReportUrl: null,
    };
  }

  return mockTradeArea(storeId);
}
