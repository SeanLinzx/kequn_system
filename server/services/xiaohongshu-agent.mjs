import { loadFunnel } from "./funnel.mjs";
import { makeRng, pickN } from "../lib/seeded-rng.mjs";

// demo 级别的「爆品选品工作台」模拟 Agent：不接入真实小红书爬虫，
// 用确定性伪随机从选品候选池中挑选，模拟"定位门店 → 检索关键词 → 抓取笔记 → 提取爆品"的过程。

const KEYWORD_POOL = ["零食探店", "办公室零食", "小众饮料", "减脂零食", "地方特产零食", "宿舍囤货", "追剧零食", "露营零食"];

const PRODUCT_POOL = [
  { name: "0糖气泡水（多口味）", category: "饮料饮品", reason: "小红书#减糖生活 话题笔记密集，年轻女性收藏率高", action: "收银台旁冰柜黄金位陈列，搭配运动/办公人群动线" },
  { name: "手撕面包（低卡系列）", category: "烘焙鲜食", reason: "健身人群种草笔记多，常与蛋白棒搭配出现", action: "与蛋白棒/无糖饮料组合陈列，标注热量信息" },
  { name: "地方特产辣卤味", category: "卤味鲜食", reason: "同城探店笔记热度上升，猎奇尝鲜心智强", action: "门口显眼位设置试吃+地方特产专区" },
  { name: "联名IP包装膨化食品", category: "网红零食/膨化辣条", reason: "IP联名开箱笔记互动量高，复购与分享意愿强", action: "收银台前端货架陈列，配合社交分享海报" },
  { name: "小罐装坚果礼盒", category: "其他/散装称重", reason: "办公室零食话题下常被推荐为「体面伴手礼」", action: "货架顶层陈列，主推办公室囤货客群" },
  { name: "云南小粒咖啡即饮", category: "饮料饮品", reason: "精品咖啡平替话题热度持续，性价比是核心卖点", action: "冰柜黄金层陈列，搭配轻食早餐组合" },
  { name: "手工麻薯/大福", category: "烘焙鲜食", reason: "下午茶探店笔记高频出现，颜值+口感话题度高", action: "收银台旁小份装陈列，主打下午茶时段" },
  { name: "低糖谷物能量棒", category: "网红零食/膨化辣条", reason: "健身/通勤场景笔记多，便携代餐心智强", action: "结账动线陈列，搭配咖啡/气泡水组合装" },
  { name: "螺蛳粉风味薯片", category: "网红零食/膨化辣条", reason: "重口味猎奇联名话题持续发酵，学生党分享多", action: "货架中层陈列，配合「重口味挑战」促销话术" },
  { name: "冻干水果脆", category: "其他/散装称重", reason: "健康零食话题持续走热，家庭囤货场景增多", action: "散装称重区主推，搭配儿童/家庭客群动线" },
];

export function getXiaohongshuPicks(storeId) {
  const funnel = loadFunnel(storeId);
  const rng = makeRng(storeId + "-xhs");
  const keywords = pickN(KEYWORD_POOL, 4, rng);
  const notesScanned = 800 + Math.floor(rng() * 1400);
  const picks = pickN(PRODUCT_POOL, 6, rng).map((p) => {
    const heatIndex = Math.round(62 + rng() * 35);
    const noteCount = Math.round(120 + rng() * 900);
    const likeCount = Math.round(noteCount * (8 + rng() * 20));
    const captureLift = +(0.8 + rng() * 2.4).toFixed(1);
    return {
      ...p,
      heatIndex,
      noteCount,
      likeCount,
      expectedCaptureLiftPct: captureLift,
    };
  }).sort((a, b) => b.heatIndex - a.heatIndex);

  return {
    storeId,
    storeName: funnel.meta?.name,
    location: funnel.meta?.location || "未知位置",
    keywords,
    notesScanned,
    picks,
    generatedAt: new Date().toISOString(),
  };
}
