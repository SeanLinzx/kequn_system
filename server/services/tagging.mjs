// 人像标签算法（v1，老规则移植）
// 规则：年龄段 + 性别 + 时段加权；确定性分配（hash(humanId+日期) % 100 < 权重）
// 标签：1 家庭主妇 / 2 退休老人 / 3 中青年 / 4 上班族 / 5 学生
const RULE_VERSION = 1;

// 高峰时段（分钟）：07:00-08:30 / 11:30-13:00 / 17:30-19:00
const PEAK_MINUTES = [
  [7 * 60, 8 * 60 + 30],
  [11 * 60 + 30, 13 * 60],
  [17 * 60 + 30, 19 * 60],
];

const DIRECT_STUDENT = new Set(["kid", "child", "teenager"]);
const DIRECT_RETIRED = new Set(["middleAged", "old"]);
const ADULT = new Set(["young", "prime", "middle"]);

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h || 1;
}

/** "2024-01-16 15:02:19" → 分钟数；解析失败返回 -1 */
function toMinutes(value) {
  const m = String(value || "").match(/(\d{2}):(\d{2})/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * @param {{ageGroup?:string, gender?:string, eventTime?:string, humanId?:string|number}} input
 * @returns {{tagId:number, ruleVersion:number}}
 */
export function computeHumanTag({ ageGroup, gender, eventTime, humanId }) {
  const g = String(ageGroup || "");
  const sex = String(gender || "");
  const minuteOfDay = toMinutes(eventTime);
  const inPeak = minuteOfDay >= 0 && PEAK_MINUTES.some(([s, e]) => minuteOfDay >= s && minuteOfDay < e);

  let candidates = null; // [tagId, weight][]
  if (DIRECT_STUDENT.has(g)) {
    candidates = [[5, 100]];
  } else if (DIRECT_RETIRED.has(g)) {
    candidates = [[2, 100]];
  } else if (ADULT.has(g)) {
    if (sex === "female") {
      candidates = inPeak ? [[4, 80], [1, 20]] : [[1, 80], [4, 20]];
    } else if (sex === "male") {
      candidates = inPeak ? [[4, 80], [3, 20]] : [[3, 80], [4, 20]];
    }
  }
  if (!candidates) {
    // unknown / infant / all / 缺失：5 类均匀
    candidates = [[1, 20], [2, 20], [3, 20], [4, 20], [5, 20]];
  }

  const seedDate = String(eventTime || "").slice(0, 10);
  const h = hashString(String(humanId ?? "") + ":" + seedDate) % 100;
  let acc = 0;
  for (const [tagId, weight] of candidates) {
    acc += weight;
    if (h < acc) return { tagId, ruleVersion: RULE_VERSION };
  }
  return { tagId: candidates[0][0], ruleVersion: RULE_VERSION };
}
