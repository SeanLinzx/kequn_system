/** 运营方案 · 多店视角看板（基于 /stores/compare 真实门店数据） */
(function () {
  let cache = null;
  let siteMap = null;
  let siteMarkers = {};

  const HEALTH_COLOR = { green: "#18a058", yellow: "#e8a23a", red: "#d93939", gray: "#94a3b8" };

  function el(id) {
    return document.getElementById(id);
  }

  function healthDot(health) {
    return `<span class="compare-health-dot ${health || "gray"}"></span>`;
  }

  function siteAction(r) {
    if (r.worstFactor === "过店人次") return "商圈渗透不足或点位客流偏弱，评估门头可见性与周边引流";
    if (r.penetrationPct != null && r.penetrationPct < 20) return "1km 商圈渗透偏低，建议联动周边社区/学校做地推";
    return "维持现有选址优势，关注竞品新开店动态";
  }

  function captureAction(r) {
    if (r.alertDays >= 10) return `近阶段 ${r.alertDays} 天进店率异常，优先推送热点海报与门头焕新`;
    if (r.capturePct < 8) return "进店率低于连锁均值，建议爆品选品 + 门口试吃引流";
    return "进店率表现稳定，可做 A/B 测试优化橱窗陈列";
  }

  function convAction(r) {
    if (r.convPct < 65) return "成交率偏弱，参考品类作战地图调整高转化 SKU 陈列";
    if (r.worstFactor === "成交率") return "成交率为当前短板，加强导购话术与收银台搭售";
    return "成交率达标，聚焦高毛利品类组合提升";
  }

  function aovAction(r) {
    if (r.aov < 20) return "客单价偏低，用购物篮 Lift 组合做第二件优惠捆绑";
    if (r.grossMarginPct < 27) return "毛利率承压，优先推高高毛利组合套餐";
    return "客单价稳健，可试点满减阶梯提升连带";
  }

  function destroySiteMap() {
    if (siteMap) {
      siteMap.remove();
      siteMap = null;
    }
    siteMarkers = {};
  }

  function renderSiteMap(rows, hostId, riskMap) {
    const mapHost = el(hostId);
    if (!mapHost) return;
    destroySiteMap();
    mapHost.innerHTML = '<div id="solSiteMapCanvas" class="sol-multi-map"></div>';

    if (typeof L === "undefined") {
      mapHost.innerHTML = "<p class='muted'>地图组件未加载</p>";
      return;
    }

    const validRows = rows.filter(function (r) { return r.lat != null && r.lng != null; });
    if (!validRows.length) {
      mapHost.innerHTML = "<p class='muted'>暂无门店坐标数据</p>";
      return;
    }

    const center = validRows.length
      ? [
          validRows.reduce(function (s, r) { return s + r.lat; }, 0) / validRows.length,
          validRows.reduce(function (s, r) { return s + r.lng; }, 0) / validRows.length,
        ]
      : [28.228, 112.938];
    siteMap = L.map("solSiteMapCanvas").setView(center, validRows.length > 1 ? 6 : 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(siteMap);

    const bounds = L.latLngBounds([]);
    validRows.forEach(function (r) {
      const risk = riskMap?.[r.storeId];
      const color = risk
        ? window.SolutionsStore?.riskColor(risk)
        : HEALTH_COLOR[r.health] || HEALTH_COLOR.gray;
      const radius = 10 + Math.min(14, (r.dailyPassers || 0) / 800);
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: radius,
        color: "#fff",
        weight: 2.5,
        fillColor: color,
        fillOpacity: 0.92,
        opacity: 1,
      }).addTo(siteMap);
      marker.bindPopup(
        `<b>${r.name}</b><br/>日均过店 ${r.dailyPassers?.toLocaleString("zh-CN") || "—"}<br/>` +
          `进店率 ${r.capturePct}% · 渗透 ${r.penetrationPct != null ? r.penetrationPct + "%" : "—"}<br/>` +
          (risk ? `闭店风险：${risk}<br/>` : "") +
          `短板：${r.worstFactor || "正常"}`
      );
      siteMarkers[r.storeId] = marker;
      bounds.extend([r.lat, r.lng]);
    });

    if (bounds.isValid()) {
      siteMap.fitBounds(bounds, { padding: [36, 36], maxZoom: validRows.length === 1 ? 14 : 12 });
    }
    [120, 420, 800].forEach(function (ms) {
      setTimeout(function () { siteMap?.invalidateSize(); }, ms);
    });
  }

  async function renderSite(rows) {
    const box = el("solMultiSite");
    if (!box) return;
    box.innerHTML = "<p class='muted'>加载闭店决策数据…</p>";
    try {
      const closureData = await FenqunAPI.api("/stores/closure-compare");
      const closureStores = (closureData.stores || []).filter((s) => !s.error);
      const riskMap = {};
      closureStores.forEach((s) => { riskMap[s.storeId] = s.closureRiskLevel; });
      box.innerHTML = window.SolutionsStore.renderClosureMulti(closureData, rows);
      renderSiteMap(rows, "solSiteMapHost", riskMap);
      bindGotoStore(box);
    } catch (e) {
      box.innerHTML = `<div class="warn-box">${e.message}</div>`;
    }
  }

  function renderCapture(rows) {
    const box = el("solMultiCapture");
    if (!box) return;
    const sorted = [...rows].sort((a, b) => a.capturePct - b.capturePct);
    const priority = sorted.filter((r) => r.alertDays >= 5 || r.capturePct < 8.2);

    box.innerHTML = `
      <div class="sol-multi-kpi-row">
        <div class="sol-multi-kpi warn"><div class="val">${priority.length}</div><div class="lbl">需优先干预门店</div></div>
        <div class="sol-multi-kpi"><div class="val">${sorted[0]?.capturePct || "—"}%</div><div class="lbl">最低进店率</div></div>
        <div class="sol-multi-kpi"><div class="val">${Math.max(...rows.map((r) => r.alertDays || 0))}</div><div class="lbl">最高异常天数</div></div>
      </div>
      <div class="card">
        <h3>进店率优先级队列</h3>
        <div class="compare-table-wrap"><table class="compare-table">
          <thead><tr><th>优先级</th><th>门店</th><th>进店率</th><th>异常天数</th><th>日均过店</th><th>每过店产值</th><th>推荐工具</th><th>建议动作</th><th></th></tr></thead>
          <tbody>${sorted.map(function (r, i) {
            const tool = r.capturePct < 8.2 ? "热点海报 + 爆品选品" : "热点海报";
            const pri = i < priority.length ? `<span class="tag tag-red">P${i + 1}</span>` : `<span class="muted">P${i + 1}</span>`;
            return `<tr>
              <td>${pri}</td>
              <td><strong>${r.name}</strong></td>
              <td>${r.capturePct}%</td>
              <td>${r.alertDays ?? "—"} 天</td>
              <td>${r.dailyPassers?.toLocaleString("zh-CN") || "—"}</td>
              <td>¥${r.revPerPass ?? "—"}</td>
              <td>${tool}</td>
              <td class="compare-action-cell">${captureAction(r)}</td>
              <td><button type="button" class="btn-link btn-sol-goto-store" data-store="${r.storeId}" data-cat="capture" data-sub="poster">去执行</button></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
        <p class="muted" style="margin-top:10px">点击「去执行」切换至单店视角，为该门店生成热点海报或启动爆品选品 Agent</p>
      </div>
      <div class="card">
        <h3>连锁统一热点借势（可选）</h3>
        <p class="muted">以下热点话题适合多店同步投放，建议在 P1 门店先行测试后推广至全连锁</p>
        <div class="sol-hot-suggest">
          <span class="hot-chip">春季露营零食包</span>
          <span class="hot-chip">低卡轻食专区</span>
          <span class="hot-chip">进口网红爆款</span>
          <span class="hot-chip">周末家庭囤货</span>
        </div>
      </div>`;

    bindGotoStore(box);
  }

  async function renderConversion(rows) {
    const box = el("solMultiConversion");
    if (!box) return;
    box.innerHTML = "<p class='muted'>加载转型升级数据…</p>";
    try {
      const transformData = await FenqunAPI.api("/stores/transformation-compare");
      const stores = (transformData.stores || []).filter((s) => !s.error);
      const sorted = [...rows].sort((a, b) => a.convPct - b.convPct);
      const avg = rows.length ? (rows.reduce((s, r) => s + r.convPct, 0) / rows.length).toFixed(1) : "—";

      box.innerHTML =
        window.SolutionsStore.renderTransformMulti(transformData) +
        `<div class="card" style="margin-top:14px">
        <h3>成交率经营对照</h3>
        <div class="sol-multi-kpi-row">
          <div class="sol-multi-kpi"><div class="val">${avg}%</div><div class="lbl">平均成交率</div></div>
          <div class="sol-multi-kpi warn"><div class="val">${sorted[0]?.convPct || "—"}%</div><div class="lbl">最低成交率</div></div>
          <div class="sol-multi-kpi"><div class="val">${stores[0]?.recommendedType?.slice(0, 8) || "—"}…</div><div class="lbl">首推转型业态</div></div>
        </div>
        <div class="sol-conv-bars">${sorted.map(function (r) {
          const w = Math.min(100, r.convPct);
          return `<div class="sol-conv-bar-row">
            <span class="name">${r.name}</span>
            <span class="track"><span class="fill" style="width:${w}%"></span></span>
            <span class="val">${r.convPct}%</span>
            <button type="button" class="btn-link btn-sol-goto-store" data-store="${r.storeId}" data-cat="conversion">单店选品</button>
          </div>`;
        }).join("")}</div>
      </div>`;
      bindGotoStore(box);
    } catch (e) {
      box.innerHTML = `<div class="warn-box">${e.message}</div>`;
    }
  }

  function renderAov(rows) {
    const box = el("solMultiAov");
    if (!box) return;
    const sorted = [...rows].sort((a, b) => a.aov - b.aov);
    const avgAov = rows.length ? (rows.reduce((s, r) => s + r.aov, 0) / rows.length).toFixed(1) : "—";

    box.innerHTML = `
      <div class="sol-multi-kpi-row">
        <div class="sol-multi-kpi"><div class="val">¥${avgAov}</div><div class="lbl">平均客单价</div></div>
        <div class="sol-multi-kpi warn"><div class="val">¥${sorted[0]?.aov || "—"}</div><div class="lbl">最低客单价</div></div>
        <div class="sol-multi-kpi"><div class="val">${sorted[sorted.length - 1]?.grossMarginPct || "—"}%</div><div class="lbl">最高毛利率</div></div>
      </div>
      <div class="card">
        <h3>客单价与毛利对比</h3>
        <div class="compare-table-wrap"><table class="compare-table">
          <thead><tr><th>门店</th><th>客单价</th><th>毛利率</th><th>成本占比</th><th>营业额</th><th>提升空间</th><th>建议动作</th><th></th></tr></thead>
          <tbody>${sorted.map(function (r) {
            const gap = r.aov < Number(avgAov) ? `低于均值 ¥${(Number(avgAov) - r.aov).toFixed(1)}` : "高于均值";
            return `<tr>
              <td><strong>${r.name}</strong></td>
              <td>¥${r.aov}</td>
              <td>${r.grossMarginPct}%</td>
              <td>${r.costRatioPct}%</td>
              <td>¥${r.salesWan}万</td>
              <td>${gap}</td>
              <td class="compare-action-cell">${aovAction(r)}</td>
              <td><button type="button" class="btn-link btn-sol-goto-store" data-store="${r.storeId}" data-cat="aov">购物篮分析</button></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>`;

    bindGotoStore(box);
  }

  function bindGotoStore(root) {
    root.querySelectorAll(".btn-sol-goto-store").forEach(function (btn) {
      btn.onclick = function () {
        const storeId = btn.dataset.store;
        const cat = btn.dataset.cat;
        const sub = btn.dataset.sub;
        const storeSel = document.getElementById("globalStore");
        if (storeSel && storeId) {
          storeSel.value = storeId;
          storeSel.dispatchEvent(new Event("change"));
        }
        window.SolutionsHub?.setMode?.("single");
        if (cat) window.SolutionsHub?.showCategory?.(cat);
        if (sub) window.SolutionsHub?.setCaptureSub?.(sub);
      };
    });
  }

  async function load(cat) {
    const renderers = { site: renderSite, capture: renderCapture, conversion: renderConversion, aov: renderAov };
    const render = renderers[cat];
    if (!render) return;

    const hostIds = { site: "solMultiSite", capture: "solMultiCapture", conversion: "solMultiConversion", aov: "solMultiAov" };
    const host = el(hostIds[cat]);
    if (host) host.innerHTML = "<p class='muted'>加载多店对比数据…</p>";

    try {
      if (!cache) cache = await FenqunAPI.api("/stores/compare");
      const rows = (cache.stores || []).filter((r) => !r.error);
      if (!rows.length) {
        if (host) host.innerHTML = "<div class='warn-box'>当前账号暂无可见门店</div>";
        return;
      }
      await render(rows);
    } catch (e) {
      if (host) host.innerHTML = `<div class="warn-box">${e.message}</div>`;
    }
  }

  function invalidate() {
    cache = null;
  }

  function onStoreChange() {
    invalidate();
  }

  window.SolutionsMulti = { load, invalidate, onStoreChange, destroySiteMap };
})();
