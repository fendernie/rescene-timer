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

// 연습 평균 오차로 리드타임 조정값을 제안한다. 표본 부족/이미 정확하면 null.
export function recommendLead(leadMs, meanMs, n) {
  if (n < 5 || Math.abs(meanMs) <= 10) return null;
  const raw = leadMs + meanMs; // 빠름(-)이면 리드타임을 줄이고, 늦음(+)이면 늘린다
  const rounded = Math.round(raw / 5) * 5; // 슬라이더 step에 맞춤
  return Math.max(0, Math.min(600, rounded));
}
