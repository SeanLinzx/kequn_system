/** 连锁零食店：闭店决策（过店）+ 转型升级与选品（成交） */
(function () {
  const RISK_COLOR = { red: "#d93939", yellow: "#e8a23a", green: "#18a058" };
  const TYPE_COLOR = { panHealth: "#2b6bf3", professional: "#7c3aed", hold: "#64748b" };

  function el(id) {
    return document.getElementById(id);
  }

  function tagClass(tone) {
    if (tone === "red") return "tag tag-red";
    if (tone === "yellow") return "tag tag-yellow";
    return "tag tag-green";
  }

  function catTag(tag) {
    if (tag === "强烈推荐") return "tag tag-green";
    if (tag === "建议试点") return "tag tag-yellow";
    return "tag tag-gray";
  }

  function riskBadge(level) {
    const map = { red: "高风险", yellow: "关注", green: "健康" };
    return `<span class="sol-store-risk-badge ${level}">${map[level] || level}</span>`;
  }

  function indexBar(label, val, color) {
    return `<div class="sol-store-index-row">
      <span class="lbl">${label}</span>
      <span class="track"><span class="fill" style="width:${val}%;background:${color}"></span></span>
      <span class="val">${val}</span>
    </div>`;
  }

  function renderClosureSingle(data) {
    const host = el("solSiteClosureSingle");
    if (!host) return;
    host.innerHTML = `
      <div class="card sol-store-hero-card closure">
        <div class="sol-store-hero-hd">
          <div>
            <h3>闭店与门店处置评估</h3>
            <p class="muted">基于过店流量、经营健康度与调改历史，判断是否需要搬迁/合并/转型/关停</p>
          </div>
          ${riskBadge(data.closureRiskLevel)}
        </div>
        <div class="sol-store-kpi-strip">
          <div class="sol-store-kpi"><div class="val" style="color:${RISK_COLOR[data.closureRiskLevel]}">${data.closureRiskScore}</div><div class="lbl">处置风险分</div></div>
          <div class="sol-store-kpi"><div class="val">${data.consecutiveLossMonths} 月</div><div class="lbl">连续未达标</div></div>
          <div class="sol-store-kpi"><div class="val">${data.renovationRounds} 轮</div><div class="lbl">已调改轮次</div></div>
          <div class="sol-store-kpi"><div class="val">${data.monthTargetAchievedPct != null ? data.monthTargetAchievedPct + "%" : "—"}</div><div class="lbl">月目标达成</div></div>
        </div>
        <div class="sol-store-action-banner ${data.suggestedActionTone}">
          <strong>建议动作：</strong>${data.suggestedAction}
          <span class="muted"> · ${data.region} · 周边同业 ${data.nearbyCompetitorDensity}</span>
        </div>
        <ul class="sol-store-reason-list">${(data.reasoning || []).map((r) => `<li>${r}</li>`).join("")}</ul>
        <p class="sol-store-policy-note">${data.policyNote || ""}</p>
      </div>`;
  }

  function renderTransformSingle(data) {
    const host = el("solConversionTransformSingle");
    if (!host) return;
    const typeColor = TYPE_COLOR[data.recommendedTypeKey] || TYPE_COLOR.hold;
    host.innerHTML = `
      <div class="card sol-store-hero-card transform">
        <div class="sol-store-hero-hd">
          <div>
            <h3>转型升级与选品建议</h3>
            <p class="muted">参考连锁零食店「70% 量贩多品类 + 30% 社区便民」策略，结合商圈客群与经营指标给出转型优先级与铺货清单</p>
          </div>
          <span class="sol-store-type-pill" style="background:${typeColor}">${data.recommendedType}</span>
        </div>
        <div class="sol-store-kpi-strip">
          <div class="sol-store-kpi"><div class="val">${data.areaSqm}㎡</div><div class="lbl">门店面积</div></div>
          <div class="sol-store-kpi"><div class="val">${data.memberRepurchasePct}%</div><div class="lbl">会员复购占比</div></div>
          <div class="sol-store-kpi"><div class="val">${data.storeTierLabel?.slice(0, 6) || "—"}…</div><div class="lbl">门店分级</div></div>
          <div class="sol-store-kpi"><div class="val">${data.region}</div><div class="lbl">所属区域</div></div>
        </div>
        <p class="sol-store-type-desc">${data.recommendedTypeDesc}</p>
        <div class="sol-store-index-grid">
          ${indexBar("家庭/社区客群指数", data.chronicIndex, "#7c3aed")}
          ${indexBar("年轻/潮流客群指数", data.panHealthIndex, "#2b6bf3")}
        </div>
        <ul class="sol-store-reason-list">${(data.reasoning || []).map((r) => `<li>${r}</li>`).join("")}</ul>
      </div>
      <div class="card">
        <h3>优先铺货品矩阵</h3>
        <div class="compare-table-wrap"><table class="compare-table">
          <thead><tr><th>品类</th><th>建议</th><th>预估毛利率</th><th>客单提升</th><th>说明</th></tr></thead>
          <tbody>${(data.categoryPlan || []).map(function (c) {
            return `<tr>
              <td><strong>${c.name}</strong></td>
              <td><span class="${catTag(c.tag)}">${c.tag}</span></td>
              <td>${c.marginPct > 0 ? c.marginPct + "%" : "—"}</td>
              <td>${c.aovLiftPct > 0 ? "+" + c.aovLiftPct + "%" : "—"}</td>
              <td class="compare-action-cell">${c.note}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>`;
  }

  function renderClosureMulti(data, compareRows) {
    const stores = (data.stores || []).filter((s) => !s.error);
    const closeFirst = stores.filter((s) => s.closureRiskLevel === "red");
    const watch = stores.filter((s) => s.closureRiskLevel === "yellow");

    return `
      <div class="card sol-store-context-banner">
        <strong>连锁零食店门店处置原则</strong>
        <p class="muted">${data.policyNote || ""}</p>
      </div>
      <div class="sol-multi-kpi-row">
        <div class="sol-multi-kpi warn"><div class="val">${closeFirst.length}</div><div class="lbl">优先闭店/搬迁评估</div></div>
        <div class="sol-multi-kpi"><div class="val">${watch.length}</div><div class="lbl">需关注门店</div></div>
        <div class="sol-multi-kpi"><div class="val">${stores.length - closeFirst.length - watch.length}</div><div class="lbl">经营健康门店</div></div>
      </div>
      <div class="card">
        <h3>闭店优先级队列（按处置风险分排序）</h3>
        <div class="compare-table-wrap"><table class="compare-table">
          <thead><tr><th>优先级</th><th>门店</th><th>大区</th><th>风险分</th><th>连续亏损月</th><th>调改轮次</th><th>月达成率</th><th>短板因子</th><th>建议动作</th><th></th></tr></thead>
          <tbody>${stores.map(function (s, i) {
            const pri = s.closureRiskLevel === "red" ? `<span class="tag tag-red">P${i + 1}</span>` : `<span class="muted">P${i + 1}</span>`;
            return `<tr>
              <td>${pri}</td>
              <td><strong>${s.name}</strong></td>
              <td>${s.region || "—"}</td>
              <td>${riskBadge(s.closureRiskLevel)} ${s.closureRiskScore}</td>
              <td>${s.consecutiveLossMonths} 月</td>
              <td>${s.renovationRounds} 轮</td>
              <td>${s.monthTargetAchievedPct != null ? s.monthTargetAchievedPct + "%" : "—"}</td>
              <td>${s.worstFactor || "—"}</td>
              <td><span class="${tagClass(s.suggestedActionTone)}">${s.suggestedAction}</span></td>
              <td><button type="button" class="btn-link btn-sol-goto-store" data-store="${s.storeId}" data-cat="site">单店详情</button></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>
      ${renderSitePassSection(compareRows, stores)}`;
  }

  function renderSitePassSection(compareRows, closureStores) {
    if (!compareRows?.length) return "";
    const riskMap = {};
    (closureStores || []).forEach((s) => { riskMap[s.storeId] = s.closureRiskLevel; });
    const sorted = [...compareRows].sort((a, b) => (a.dailyPassers || 0) - (b.dailyPassers || 0));
    return `
      <div class="compare-map-grid">
        <div class="card"><h3>门店选址分布</h3><div id="solSiteMapHost" class="compare-map-box"></div>
          <p class="muted compare-map-note">颜色=闭店风险（红/黄/绿）· 大小=日均过店</p></div>
        <div class="card"><h3>过店与渗透排行</h3>
          <div class="sol-multi-rank-list">${sorted.map(function (r, i) {
            const risk = riskMap[r.storeId] || r.health;
            return `<div class="sol-multi-rank-item">
              <span class="rank">${i + 1}</span>
              <div class="body"><strong>${r.name}</strong><span class="muted">${r.districtType || r.district}</span>
                <div class="metrics">过店 ${r.dailyPassers?.toLocaleString("zh-CN")}/日 · 渗透 ${r.penetrationPct != null ? r.penetrationPct + "%" : "—"} · 进店 ${r.capturePct}%</div>
              </div><span class="sol-store-risk-badge ${risk}"></span></div>`;
          }).join("")}</div>
        </div>
      </div>`;
  }

  function renderTransformMulti(data) {
    const stores = (data.stores || []).filter((s) => !s.error);
    const panHealth = stores.filter((s) => s.recommendedTypeKey === "panHealth");
    const professional = stores.filter((s) => s.recommendedTypeKey === "professional");

    return `
      <div class="card sol-store-context-banner">
        <strong>连锁零食店转型升级策略（演示）</strong>
        <p class="muted">70% 门店转向量贩多品类（散称休闲 / 进口网红 / 低卡健康 / 试吃体验），30% 门店强化社区便民（家庭常备 / 高复购标品）。以下排序综合商圈客群、面积与经营指标。</p>
      </div>
      <div class="sol-multi-kpi-row">
        <div class="sol-multi-kpi"><div class="val">${panHealth.length}</div><div class="lbl">建议转量贩多品类</div></div>
        <div class="sol-multi-kpi"><div class="val">${professional.length}</div><div class="lbl">建议转社区便民</div></div>
        <div class="sol-multi-kpi warn"><div class="val">${stores[0]?.name?.slice(0, 10) || "—"}…</div><div class="lbl">转型优先级最高</div></div>
      </div>
      <div class="card">
        <h3>门店转型优先级队列</h3>
        <div class="compare-table-wrap"><table class="compare-table">
          <thead><tr><th>优先级</th><th>门店</th><th>建议业态</th><th>转型分</th><th>家庭指数</th><th>潮流指数</th><th>面积</th><th>门店分级</th><th>首推品类</th><th></th></tr></thead>
          <tbody>${stores.map(function (s, i) {
            const topCat = (s.categoryPlan || [])[0];
            const typeColor = TYPE_COLOR[s.recommendedTypeKey] || TYPE_COLOR.hold;
            return `<tr>
              <td>${i < 2 ? `<span class="tag tag-green">P${i + 1}</span>` : `<span class="muted">P${i + 1}</span>`}</td>
              <td><strong>${s.name}</strong></td>
              <td><span class="sol-store-type-pill sm" style="background:${typeColor}">${s.recommendedType}</span></td>
              <td>${s.priorityScore ?? "—"}</td>
              <td>${s.chronicIndex}</td>
              <td>${s.panHealthIndex}</td>
              <td>${s.areaSqm}㎡</td>
              <td class="compare-action-cell">${s.storeTierLabel || "—"}</td>
              <td>${topCat ? topCat.name : "—"}</td>
              <td><button type="button" class="btn-link btn-sol-goto-store" data-store="${s.storeId}" data-cat="conversion">单店选品</button></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>连锁统一铺货建议（P1 门店先行）</h3>
        <div class="sol-store-category-chips">
          <span class="hot-chip">散称休闲零食区</span>
          <span class="hot-chip">进口 / 网红爆款</span>
          <span class="hot-chip">低卡健康零食</span>
          <span class="hot-chip">节令礼盒组合</span>
          <span class="hot-chip">门口试吃体验区</span>
        </div>
        <p class="muted" style="margin-top:10px">长沙湘江路商圈模拟店面积 228㎡，建议作为量贩多品类转型样板；望城银杉路社区店优先试点散称休闲 + 收银台搭售组合。</p>
      </div>`;
  }

  async function loadSingle(storeId) {
    const closureHost = el("solSiteClosureSingle");
    const transformHost = el("solConversionTransformSingle");
    if (closureHost) closureHost.innerHTML = "<p class='muted'>加载闭店评估…</p>";
    if (transformHost) transformHost.innerHTML = "<p class='muted'>加载转型选品建议…</p>";
    if (!storeId) return;
    try {
      const [closure, transform] = await Promise.all([
        FenqunAPI.api("/stores/" + storeId + "/closure-assessment"),
        FenqunAPI.api("/stores/" + storeId + "/transformation-advice"),
      ]);
      renderClosureSingle(closure);
      renderTransformSingle(transform);
    } catch (e) {
      const msg = `<div class="warn-box">${e.message}</div>`;
      if (closureHost) closureHost.innerHTML = msg;
      if (transformHost) transformHost.innerHTML = msg;
    }
  }

  window.SolutionsStore = {
    loadSingle,
    renderClosureMulti,
    renderTransformMulti,
    renderSitePassSection,
    riskColor: function (level) { return RISK_COLOR[level] || RISK_COLOR.green; },
  };
})();
