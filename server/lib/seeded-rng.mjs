/** 确定性伪随机数生成器，用于 demo 数据模拟 */

export function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h || 1;
}

export function makeRng(seed) {
  let state = hashSeed(String(seed));
  return function rng() {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

export function pickN(arr, n, rng) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
