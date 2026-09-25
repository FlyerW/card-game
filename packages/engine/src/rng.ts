/**
 * mulberry32：狀態只有一個 32 位元整數，可以原封不動存進遊戲狀態，
 * 所以同樣的種子加上同樣的動作序列，一定能重播出同樣的一局。
 * 回傳 [0, 1) 的亂數與下一個狀態。
 */
export function nextRandom(state: number): [value: number, nextState: number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}
