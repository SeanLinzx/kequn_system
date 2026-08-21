import { request as httpsRequest } from "node:https";

const WEIBO_BLOCK_RE =
  /(习近平|政治局|国务院|外交部|军委|台独|港独|疆独|藏独|六四|天安门|自杀|身亡|遇难|伤亡|爆炸袭击|强奸|猥亵|色情)/;

function normalizeWord(word) {
  return String(word || "")
    .replace(/^#+|#+$/g, "")
    .trim();
}

function formatHeat(num) {
  const n = Number(num) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  return String(n);
}

function fetchWeiboRaw() {
  return new Promise((resolve, reject) => {
    httpsRequest(
      {
        hostname: "weibo.com",
        port: 443,
        path: "/ajax/side/hotSearch",
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          Referer: "https://weibo.com/",
          Accept: "application/json",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("微博数据解析失败"));
          }
        });
      },
    )
      .on("error", reject)
      .end();
  });
}

export async function fetchWeiboHot(limit = 15) {
  const payload = await fetchWeiboRaw();
  const realtime = payload?.data?.realtime;
  if (!Array.isArray(realtime)) return [];
  const words = [];
  for (let i = 0; i < realtime.length && words.length < limit; i++) {
    const item = realtime[i];
    const word = normalizeWord(item.word || item.note || item.word_scheme);
    if (!word || WEIBO_BLOCK_RE.test(word)) continue;
    words.push({
      kw: word,
      tag: "微博" + (item.label_name || "热搜"),
      rank: item.realpos || item.rank + 1 || words.length + 1,
      heat: item.num || 0,
      note: `微博热搜第${item.realpos || item.rank + 1}位` + (item.num ? ` · 热度 ${formatHeat(item.num)}` : ""),
    });
  }
  return words;
}

// fallback when weibo fails
export const FALLBACK_HOT = [
  { kw: "巨好吃", tag: "情绪零食", note: "口语化安利" },
  { kw: "低GI", tag: "健康轻食", note: "低GI赛道" },
  { kw: "解馋", tag: "情绪零食", note: "晚间解馋" },
  { kw: "续命", tag: "即饮补货", note: "通勤场景" },
  { kw: "辣味", tag: "年轻偏好", note: "辣条麻辣" },
];
