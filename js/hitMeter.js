// 클릭 오차와 연습 통계 (순수). 오차 단위 ms, +는 늦음.

export function hitError(clickMs, targetMs) {
  return clickMs - targetMs;
}

export function stats(errors) {
  const n = errors.length;
  if (!n) return { n: 0, mean: 0, stdev: 0, best: null, recent: [] };
  const mean = errors.reduce((a, b) => a + b, 0) / n;
  const variance = errors.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const best = errors.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  const recent = errors.slice(-10);
  return { n, mean, stdev, best, recent };
}
