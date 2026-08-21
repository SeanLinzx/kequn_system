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
    valueDemoSections: [
      {
        title: "面向连锁门店经营",
        sub: "单店与连锁视角：把客群数据变成日常经营动作",
        items: [
          { num: "01", name: "门店客群报告", path: "/fenqun/demo1-crowd-report/index.html", desc: "昨日/近7日客群统计 + AI 排班策略", tags: ["真实数据", "AI报告"], templateId: "hourly_display" },
          { num: "02", name: "分时段品类动销", path: "/fenqun/demo2-hourly-promo/index.html", desc: "SKU×客群匹配的分时段动销方案", tags: ["AI执行方案"], templateId: "hourly_display" },
          { num: "03", name: "爆品推荐策略", path: "/fenqun/demo3-hot-products/index.html", desc: "互联网爆款 + 门店人群 AI 选品", tags: ["补货建议"], templateId: "traffic_boost" },
          { num: "04", name: "异业联动策略", path: "/fenqun/demo4-cross-industry/index.html", desc: "业态推理链 + 店中店联动", tags: ["AI策略"], templateId: "traffic_boost" },
          { num: "05", name: "商圈地图渗透率", path: "/fenqun/demo5-trade-area-map/index.html", desc: "商圈人群 vs 门店过店进店", tags: ["地图"], templateId: "traffic_boost" },
        ],
      },
      {
        title: "面向工业品牌 / 厂家",
        sub: "渠道投放与产品研发视角：用客群数据指挥铺货与创新",
        items: [
          { num: "06", name: "优质终端地图", path: "/fenqun/demo6-premium-stores-map/index.html", desc: "长沙四象限终端投放地图", tags: ["四象限"], templateId: "hourly_display" },
          { num: "07", name: "品类作战地图", path: "/fenqun/demo7-category-battle-map/index.html", desc: "商品×门店×时段差异化策略", tags: ["作战地图"], templateId: "hourly_display" },
          { num: "08", name: "产品矩阵拓展", path: "/fenqun/demo8-product-matrix/index.html", desc: "爆款关联库 + AI 产品矩阵", tags: ["厂家视角"], templateId: "aov_lift" },
        ],
      },
      {
        title: "真实门店深度分析案例",
        sub: "销售明细 × 分时段客流 · 完整决策报告套件",
        items: [
          { num: "★", name: "标杆门店深度案例", path: "/fenqun/example1/index.html", desc: "长沙标杆门店 20+ 决策报告总览", tags: ["标杆案例"], templateId: "hourly_display" },
        ],
      },
    ],
  };
})();
