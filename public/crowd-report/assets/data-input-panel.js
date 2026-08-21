/** 分群数据 demo — 页面底部「报告所需输入数据」面板 */
(function () {
  var CROWD_NOTICE =
    "请通过联系分群数据工作人员部署采集设备。部署完成后，系统将自动采集门店口客流、人群画像与分时段过店数据，并同步至本报告。";

  var CONFIGS = {
    demo1: {
      report: "连锁门店客群报告",
      inputs: [
        {
          id: "crowd",
          name: "客群数据",
          tag: "分群采集",
          desc: "分时段、分人群过店/进店明细，用于画像分布与错峰排班。",
          type: "crowd",
          fields: [
            { name: "store", label: "门店", example: "零食店-长沙银杉路店" },
            { name: "store_type", label: "业态", example: "零食店" },
            { name: "date", label: "日期", example: "2026-03-27" },
            { name: "hour", label: "小时", example: "18" },
            { name: "persona", label: "人群标签", example: "学生" },
            { name: "passers", label: "过店人数", example: "25" },
            { name: "enters", label: "进店人数", example: "3" },
          ],
        },
        {
          id: "traffic",
          name: "客流汇总数据",
          tag: "分群采集",
          desc: "按小时汇总的过店/进店总量，用于 KPI 与趋势图。",
          type: "mock",
          fields: [
            { name: "store", label: "门店", example: "零食店-长沙银杉路店" },
            { name: "store_type", label: "业态", example: "零食店" },
            { name: "date", label: "日期", example: "2026-03-27" },
            { name: "hour", label: "小时", example: "18" },
            { name: "passers", label: "过店人数", example: "51" },
            { name: "enters", label: "进店人数", example: "8" },
          ],
          mockRows: [
            { store: "零食店-长沙银杉路店", store_type: "零食店", date: "2026-03-27", hour: "18", passers: "51", enters: "8" },
            { store: "药店-桐君阁仁秀店", store_type: "药店", date: "2026-03-27", hour: "10", passers: "34", enters: "12" },
            { store: "药店-桐君阁启航店", store_type: "药店", date: "2026-03-27", hour: "17", passers: "42", enters: "9" },
          ],
        },
      ],
    },
    demo2: {
      report: "分时段品类动销执行方案",
      inputs: [
        {
          id: "crowd",
          name: "客群预测数据",
          tag: "分群采集",
          desc: "未来/指定日分时段人群画像与购买意愿，驱动 SKU 匹配评分。",
          type: "crowd",
          fields: [
            { name: "forecast_date", label: "预测日期", example: "2026-05-12" },
            { name: "time_slot", label: "时段", example: "16:00-18:00" },
            { name: "profile_category", label: "人群标签", example: "学生" },
            { name: "estimated_passers", label: "预估过店", example: "118" },
            { name: "purchase_intent_score", label: "购买意愿", example: "72" },
            { name: "price_sensitivity", label: "价格敏感度", example: "中" },
            { name: "top_needs", label: "核心需求", example: "放学解馋" },
          ],
        },
        {
          id: "catalog",
          name: "门店商品目录",
          tag: "ERP 对接",
          desc: "在售 SKU 清单（品类、口味、价格、毛利等），用于动销排期。",
          type: "mock",
          fields: [
            { name: "sku_id", label: "SKU 编号", example: "SKU001" },
            { name: "product_name", label: "商品名", example: "海盐薯片" },
            { name: "category", label: "大类", example: "膨化零食" },
            { name: "flavor", label: "口味", example: "海盐" },
            { name: "price_yuan", label: "售价(元)", example: "6.90" },
            { name: "gross_margin_pct", label: "毛利率%", example: "42" },
            { name: "target_scene", label: "适用场景", example: "通勤解馋" },
          ],
          mockRows: [
            { sku_id: "SKU001", product_name: "海盐薯片", category: "膨化零食", flavor: "海盐", price_yuan: "6.90", gross_margin_pct: "42", target_scene: "通勤解馋" },
            { sku_id: "SKU012", product_name: "生椰拿铁", category: "饮料", flavor: "椰香", price_yuan: "9.90", gross_margin_pct: "38", target_scene: "上班族早八" },
            { sku_id: "P001", product_name: "维生素C泡腾片", category: "保健品", flavor: "柠檬", price_yuan: "28.0", gross_margin_pct: "35", target_scene: "换季常备" },
          ],
        },
      ],
    },
    demo3: {
      report: "爆品推荐与补货方案",
      inputs: [
        {
          id: "crowd",
          name: "客群数据",
          tag: "分群采集",
          desc: "近期分时段人群构成，用于匹配网热商品目标人群。",
          type: "crowd",
          fields: [
            { name: "store", label: "门店", example: "零食店-长沙银杉路店" },
            { name: "date", label: "日期", example: "2026-03-27" },
            { name: "hour", label: "小时", example: "17" },
            { name: "persona", label: "人群", example: "学生" },
            { name: "passers", label: "过店", example: "86" },
            { name: "enters", label: "进店", example: "14" },
          ],
        },
        {
          id: "merchant",
          name: "商家档案",
          tag: "手工录入",
          desc: "门店定位、面积、客单价等，辅助选品策略。",
          type: "mock",
          fields: [
            { name: "store", label: "门店", example: "零食店-长沙银杉路店" },
            { name: "business_type", label: "业态", example: "零食店" },
            { name: "positioning", label: "定位", example: "社区型量贩零食集合店" },
            { name: "store_area_sqm", label: "面积(㎡)", example: "120" },
            { name: "avg_ticket_yuan", label: "客单价(元)", example: "23.5" },
          ],
          mockRows: [
            { store: "零食店-长沙银杉路店", business_type: "零食店", positioning: "社区型量贩零食集合店", store_area_sqm: "120", avg_ticket_yuan: "23.5" },
            { store: "药店-桐君阁仁秀店", business_type: "药店", positioning: "社区健康服务型药房", store_area_sqm: "85", avg_ticket_yuan: "68.0" },
          ],
        },
        {
          id: "hot",
          name: "网热商品库",
          tag: "平台对接",
          desc: "抖音/小红书/闪购等平台热榜 SKU，含热度与趋势。",
          type: "mock",
          fields: [
            { name: "product_name", label: "商品名", example: "魔芋爽劲辣款" },
            { name: "platform", label: "来源平台", example: "抖音" },
            { name: "heat_index", label: "热度指数", example: "96" },
            { name: "trend", label: "趋势", example: "上升" },
            { name: "target_personas", label: "目标人群", example: "学生;中青年" },
          ],
          mockRows: [
            { product_name: "魔芋爽劲辣款", platform: "抖音", heat_index: "96", trend: "上升", target_personas: "学生;中青年" },
            { product_name: "生椰拿铁即饮款", platform: "小红书", heat_index: "93", trend: "平稳", target_personas: "上班族;中青年" },
          ],
        },
        {
          id: "sku",
          name: "门店 SKU 清单",
          tag: "ERP 导出",
          desc: "当前在售 SKU（可上传 CSV），用于对比缺口与补货建议。",
          type: "mock",
          fields: [
            { name: "sku_name", label: "商品名", example: "奥利奥夹心饼干" },
            { name: "category", label: "品类", example: "饼干" },
            { name: "stock_qty", label: "库存", example: "48" },
            { name: "weekly_sales", label: "周销量", example: "22" },
          ],
          mockRows: [
            { sku_name: "奥利奥夹心饼干", category: "饼干", stock_qty: "48", weekly_sales: "22" },
            { sku_name: "元气森林气泡水", category: "饮料", stock_qty: "36", weekly_sales: "31" },
          ],
        },
      ],
    },
    demo4: {
      report: "异业联动策略",
      inputs: [
        {
          id: "crowd",
          name: "客群数据",
          tag: "分群采集",
          desc: "本店及周边时段人群画像，用于推理可联动的异业业态。",
          type: "crowd",
          fields: [
            { name: "store", label: "门店", example: "零食店-长沙银杉路店" },
            { name: "hour", label: "小时", example: "19" },
            { name: "persona", label: "人群", example: "中青年" },
            { name: "passers", label: "过店", example: "62" },
          ],
        },
        {
          id: "profile",
          name: "业态门店档案",
          tag: "手工维护",
          desc: "候选联营业态的核心客群、高峰时段与经营特点。",
          type: "mock",
          fields: [
            { name: "business_name", label: "业态/门店", example: "微醺社交酒馆" },
            { name: "business_type", label: "类型", example: "社交酒馆" },
            { name: "core_personas", label: "核心客群", example: "中青年;上班族" },
            { name: "peak_hours", label: "高峰时段", example: "19-24" },
            { name: "avg_stay_minutes", label: "平均停留(分)", example: "95" },
          ],
          mockRows: [
            { business_name: "微醺社交酒馆", business_type: "社交酒馆", core_personas: "中青年;上班族", peak_hours: "19-24", avg_stay_minutes: "95" },
            { business_name: "社区亲子绘本馆", business_type: "亲子教育", core_personas: "家庭主妇;学生", peak_hours: "15-20", avg_stay_minutes: "45" },
          ],
        },
      ],
    },
    demo5: {
      report: "商圈地图与调整策略",
      inputs: [
        {
          id: "crowd",
          name: "客群数据",
          tag: "分群采集",
          desc: "门店口实时/近期分时段客流，用于商圈热力与高峰识别。",
          type: "crowd",
          fields: [
            { name: "store", label: "门店", example: "零食店-长沙银杉路店" },
            { name: "date", label: "日期", example: "2026-03-27" },
            { name: "hour", label: "小时", example: "18" },
            { name: "persona", label: "人群", example: "学生" },
            { name: "passers", label: "过店", example: "86" },
          ],
        },
        {
          id: "population",
          name: "商圈人群构成",
          tag: "GIS 测算",
          desc: "门店辐射范围内各人群规模与占比（可来自地图测算或第三方）。",
          type: "mock",
          fields: [
            { name: "store", label: "门店", example: "零食店-长沙银杉路店" },
            { name: "persona", label: "人群", example: "学生" },
            { name: "population", label: "人口规模", example: "11000" },
            { name: "share", label: "占比", example: "0.262" },
            { name: "tags", label: "特征标签", example: "放学高峰集中" },
          ],
          mockRows: [
            { store: "零食店-长沙银杉路店", persona: "学生", population: "11000", share: "0.262", tags: "放学高峰集中" },
            { store: "零食店-长沙银杉路店", persona: "家庭主妇", population: "9500", share: "0.226", tags: "囤货型采购" },
          ],
        },
      ],
    },
    demo6: {
      report: "优质终端地图与投放方案",
      inputs: [
        {
          id: "crowd",
          name: "客群数据",
          tag: "分群采集",
          desc: "各终端门店口人群画像占比，用于评估投放匹配度。",
          type: "crowd",
          fields: [
            { name: "store_id", label: "终端 ID", example: "S01" },
            { name: "daily_passers", label: "日过店", example: "5200" },
            { name: "student_pct", label: "学生占比%", example: "18" },
            { name: "office_worker_pct", label: "上班族占比%", example: "30" },
          ],
        },
        {
          id: "stores",
          name: "终端门店经营数据",
          tag: "渠道系统",
          desc: "长沙区域候选终端的位置、转化、销售与货架表现。",
          type: "mock",
          fields: [
            { name: "store_name", label: "门店名", example: "零食很忙五一广场店" },
            { name: "district", label: "区县", example: "芙蓉区" },
            { name: "daily_passers", label: "日过店", example: "5200" },
            { name: "conversion_rate", label: "转化率", example: "0.31" },
            { name: "monthly_sales_yuan", label: "月销(元)", example: "286000" },
            { name: "sku_active_rate", label: "SKU 动销率", example: "0.88" },
          ],
          mockRows: [
            { store_name: "零食很忙五一广场店", district: "芙蓉区", daily_passers: "5200", conversion_rate: "0.31", monthly_sales_yuan: "286000", sku_active_rate: "0.88" },
            { store_name: "怡佳仁零食铺大学城店", district: "岳麓区", daily_passers: "4800", conversion_rate: "0.33", monthly_sales_yuan: "96000", sku_active_rate: "0.58" },
          ],
        },
      ],
    },
    demo7: {
      report: "品类作战地图",
      inputs: [
        {
          id: "crowd",
          name: "客群数据",
          tag: "分群采集",
          desc: "各门店分时段人群构成，用于品类作战时段与人群匹配。",
          type: "crowd",
          fields: [
            { name: "store_id", label: "门店 ID", example: "B02" },
            { name: "hour", label: "小时", example: "17" },
            { name: "persona", label: "人群", example: "学生" },
            { name: "passers", label: "过店", example: "128" },
          ],
        },
        {
          id: "stores",
          name: "作战门店档案",
          tag: "渠道系统",
          desc: "候选门店位置、业态与人群结构基线。",
          type: "mock",
          fields: [
            { name: "store_name", label: "门店", example: "零食舱大学城天马店" },
            { name: "store_type", label: "业态", example: "零食店" },
            { name: "student_pct", label: "学生%", example: "54" },
            { name: "daily_passers", label: "日过店", example: "4200" },
          ],
          mockRows: [
            { store_name: "零食舱大学城天马店", store_type: "零食店", student_pct: "54", daily_passers: "4200" },
            { store_name: "快乐惠便利店华远中心店", store_type: "便利店", student_pct: "6", daily_passers: "4600" },
          ],
        },
        {
          id: "products",
          name: "候选作战 SKU",
          tag: "品牌方提供",
          desc: "待推广品类清单及目标人群、场景关键词。",
          type: "mock",
          fields: [
            { name: "product_name", label: "商品", example: "电解质水柠檬味" },
            { name: "category", label: "品类", example: "功能饮料" },
            { name: "target_personas", label: "目标人群", example: "学生;上班族" },
            { name: "scene", label: "场景", example: "运动补水;夏季刚需" },
          ],
          mockRows: [
            { product_name: "电解质水柠檬味", category: "功能饮料", target_personas: "学生;上班族", scene: "运动补水;夏季刚需" },
            { product_name: "低糖坚果棒", category: "健康零食", target_personas: "上班族;中青年", scene: "办公室;代餐" },
          ],
        },
      ],
    },
    demo8: {
      report: "产品矩阵拓展方案",
      inputs: [
        {
          id: "crowd",
          name: "客群数据",
          tag: "分群采集",
          desc: "门店及周边人群画像，用于新品目标人群匹配（拓展方案基础）。",
          type: "crowd",
          fields: [
            { name: "persona", label: "人群", example: "上班族" },
            { name: "share", label: "占比", example: "0.28" },
            { name: "scene", label: "消费场景", example: "办公室零食" },
          ],
        },
        {
          id: "hotdb",
          name: "爆款客群数据库",
          tag: "分群数据",
          desc: "已验证爆款与各人群匹配指数，供 AI 推理新品方向。",
          type: "mock",
          fields: [
            { name: "product_name", label: "参考爆款", example: "黑芝麻丸" },
            { name: "category", label: "品类", example: "滋补零食" },
            { name: "heat_index", label: "热度", example: "95" },
            { name: "office_worker", label: "上班族匹配", example: "90" },
            { name: "scene_keywords", label: "场景词", example: "办公室零食;熬夜补救" },
          ],
          mockRows: [
            { product_name: "黑芝麻丸", category: "滋补零食", heat_index: "95", office_worker: "90", scene_keywords: "办公室零食;熬夜补救" },
            { product_name: "枸杞原浆", category: "滋补饮品", heat_index: "92", office_worker: "88", scene_keywords: "保温杯养生;办公室" },
          ],
        },
        {
          id: "factory",
          name: "厂家资源与案例",
          tag: "手工录入",
          desc: "厂家可供应品类、产能与合作案例，供矩阵拓展约束。",
          type: "mock",
          fields: [
            { name: "factory_name", label: "厂家", example: "某滋补食品厂" },
            { name: "core_category", label: "核心品类", example: "丸剂;原浆" },
            { name: "moq", label: "起订量", example: "5000 盒" },
            { name: "lead_time_days", label: "交期(天)", example: "14" },
          ],
          mockRows: [
            { factory_name: "某滋补食品厂", core_category: "丸剂;原浆", moq: "5000 盒", lead_time_days: "14" },
            { factory_name: "某休闲零食厂", core_category: "膨化;坚果", moq: "10000 袋", lead_time_days: "21" },
          ],
        },
        {
          id: "form",
          name: "方案配置输入",
          tag: "页面填写",
          desc: "基础品类、厂家资源等表单字段，作为 AI 生成的业务约束。",
          type: "manual",
          fields: [
            { name: "base_category", label: "基础品类", example: "滋补零食" },
            { name: "factory_resources", label: "厂家资源", example: "丸剂产线; OEM 贴牌" },
            { name: "target_stores", label: "目标门店类型", example: "社区药店;写字楼便利店" },
          ],
        },
      ],
    },
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderFieldsTable(fields) {
    var rows = fields
      .map(function (f) {
        return (
          "<tr><td><code>" +
          esc(f.name) +
          "</code></td><td>" +
          esc(f.label) +
          '</td><td class="muted">' +
          esc(f.example) +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="data-input-fields"><div class="data-input-subtitle">字段预览</div>' +
      '<div class="table-scroll"><table class="data-table data-input-field-table">' +
      "<thead><tr><th>字段名</th><th>含义</th><th>示例值</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div></div>"
    );
  }

  function renderMockTable(fields, mockRows) {
    if (!mockRows || !mockRows.length) return "";
    var keys = fields.map(function (f) {
      return f.name;
    });
    var head = keys
      .map(function (k) {
        var f = fields.find(function (x) {
          return x.name === k;
        });
        return "<th>" + esc(f ? f.label : k) + "</th>";
      })
      .join("");
    var body = mockRows
      .map(function (row) {
        return (
          "<tr>" +
          keys
            .map(function (k) {
              return "<td>" + esc(row[k] || "—") + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
    return (
      '<div class="data-input-mock"><div class="data-input-subtitle">Mock 数据样例</div>' +
      '<div class="table-scroll"><table class="data-table">' +
      "<thead><tr>" +
      head +
      "</tr></thead><tbody>" +
      body +
      "</tbody></table></div></div>"
    );
  }

  function renderDetail(item) {
    var html = renderFieldsTable(item.fields);
    if (item.type === "crowd") {
      html +=
        '<div class="data-input-crowd-notice">' +
        '<span class="data-input-crowd-icon">📡</span>' +
        "<div><strong>客群数据采集说明</strong><p>" +
        esc(CROWD_NOTICE) +
        "</p></div></div>";
    } else if (item.type === "manual") {
      html +=
        '<div class="data-input-manual-tip muted">以上字段由用户在页面表单中填写，无需上传文件；填写后点击生成按钮即可参与 AI 推理。</div>';
    } else {
      html += renderMockTable(item.fields, item.mockRows);
    }
    return html;
  }

  function mount(demoKey, container) {
    var cfg = CONFIGS[demoKey];
    if (!cfg || !container) return;

    var activeId = null;

    container.className = "data-input-panel-wrap";
    container.innerHTML =
      '<section class="card card-data data-input-panel">' +
      '<div class="section-data-divider" style="margin-top:0">' +
      '<span class="section-data-divider-line"></span>' +
      '<span class="section-data-divider-text">数据接入说明</span>' +
      '<span class="section-data-divider-line"></span></div>' +
      "<h2>本报告所需输入数据</h2>" +
      '<p class="muted data-input-intro">当前报告「' +
      esc(cfg.report) +
      "」依赖以下数据。点击各数据项可查看<strong>字段预览</strong>与<strong>Mock 样例</strong>；客群原始数据需部署分群采集设备后自动接入。</p>" +
      '<div class="data-input-chips" role="tablist"></div>' +
      '<div class="data-input-detail" hidden></div>' +
      "</section>";

    var chipsEl = container.querySelector(".data-input-chips");
    var detailEl = container.querySelector(".data-input-detail");

    function selectItem(id) {
      if (activeId === id) {
        activeId = null;
        detailEl.hidden = true;
        detailEl.innerHTML = "";
        chipsEl.querySelectorAll(".data-input-chip").forEach(function (c) {
          c.classList.remove("is-active");
        });
        return;
      }
      activeId = id;
      var item = cfg.inputs.find(function (x) {
        return x.id === id;
      });
      if (!item) return;
      chipsEl.querySelectorAll(".data-input-chip").forEach(function (c) {
        c.classList.toggle("is-active", c.dataset.id === id);
      });
      detailEl.hidden = false;
      detailEl.innerHTML =
        '<div class="data-input-detail-head">' +
        "<h3>" +
        esc(item.name) +
        '</h3><span class="data-input-tag">' +
        esc(item.tag) +
        "</span></div>" +
        '<p class="muted">' +
        esc(item.desc) +
        "</p>" +
        renderDetail(item);
    }

    cfg.inputs.forEach(function (item) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "data-input-chip" + (item.type === "crowd" ? " is-crowd" : "");
      chip.dataset.id = item.id;
      chip.setAttribute("role", "tab");
      chip.innerHTML =
        '<span class="data-input-chip-name">' +
        esc(item.name) +
        '</span><span class="data-input-chip-tag">' +
        esc(item.tag) +
        "</span>" +
        '<span class="data-input-chip-desc">' +
        esc(item.desc) +
        "</span>";
      chip.addEventListener("click", function () {
        selectItem(item.id);
      });
      chipsEl.appendChild(chip);
    });
  }

  window.FQ_DATA_INPUT = { mount: mount, CONFIGS: CONFIGS };
})();
