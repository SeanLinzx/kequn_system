(function () {
  window.REPORT_CATALOG = {
    store: [
      {
        cat: "crowd",
        icon: "👥",
        title: "仅客群数据",
        sub: "过店/进店 + 天气",
        items: [
          { name: "客流预测·排班", path: "crowd-only.html", desc: "客流预测 + 分时段排班建议", templateId: "hourly_display" },
          { name: "进店率异常", path: "alert.html", desc: "自动检出捕获率异常天清单", templateId: "funnel_capture" },
          { name: "人流预测", path: "flow-forecast.html", desc: "天气+历史训练的过店/进店预测", templateId: "hourly_display" },
        ],
      },
      {
        cat: "pos",
        icon: "🧾",
        title: "仅收银数据",
        sub: "ERP 销售明细",
        items: [
          { name: "购物篮组合", path: "basket.html", desc: "品类/单品 Lift 捆绑销售", templateId: "basket_bundle" },
          { name: "客单价·购物篮", path: "basket-aov.html", desc: "客单价提升与购物篮分析", templateId: "aov_lift" },
        ],
      },
      {
        cat: "mix",
        icon: "🔗",
        title: "客群 + 收银",
        sub: "客流 × 销售关联",
        items: [
          { name: "营业额拆解·钱漏", path: "funnel.html", desc: "四因子拆解 + 交互钱漏诊断 + AI", templateId: "conversion_fix" },
          { name: "人群×标签×品类", path: "crowd-sales.html", desc: "差异化铺货 + 时段作战地图", templateId: "hourly_display" },
        ],
      },
      {
        cat: "full",
        icon: "🔥",
        title: "客群 + 收银 + 热词",
        sub: "网络热词 × SKU",
        items: [
          { name: "爆品选品", path: "trends.html", desc: "网络热词 × 店内 SKU 匹配", templateId: "traffic_boost" },
          { name: "爆品促销活动", path: "promo-posters.html", desc: "热词×人群×AI 动态海报", templateId: "hotspot_poster" },
        ],
      },
      {
        cat: "lab",
        icon: "🔬",
        title: "洞察实验室",
        sub: "深度交互分析",
        items: [
          { name: "实验室首页", path: "insight-lab/index.html", desc: "四因子公式与洞察意义", templateId: "conversion_fix" },
          { name: "钱漏诊断", path: "insight-lab/money-leak.html", desc: "可交互钱漏剪刀差看板", templateId: "conversion_fix" },
          { name: "SKU×人群购物篮", path: "insight-lab/sku-persona-basket.html", desc: "SKU标签×人群关联", templateId: "basket_bundle" },
          { name: "天气/工作日客单价", path: "insight-lab/weather-weekday-aov.html", desc: "统计检验 + 策略", templateId: "aov_lift" },
          { name: "优质终端地图", path: "insight-lab/premium-map.html", desc: "差异化铺货 + 品类作战", templateId: "hourly_display" },
        ],
      },
    ],
    // 旧系统「客群价值 Demo 目录」（/fenqun/demo*/、/fenqun/example1/）为 www 站独立报告库，
    // 本项目不包含这些静态报告页，已移除死链。报告能力以「决策报告库 · 按数据来源」与 crowd-report 为准。
    valueDemoSections: [],
  };
})();
