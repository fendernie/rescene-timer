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

// 연습 평균 오차로 리드타임 조정값을 제안한다. 표본 부족/이미 목표 근처면 null.
// aimMs: 목표 오차. 기본 0이지만, 네트워크 지연이 있으면 -지연(예: -50)을 넘겨
// "지연만큼 미리 눌러 서버 도착이 00초 직후가 되게" 유도한다.
export function recommendLead(leadMs, meanMs, n, aimMs = 0) {
  if (n < 5 || Math.abs(meanMs - aimMs) <= 10) return null;
  const raw = leadMs + meanMs - aimMs; // 평균 오차가 목표를 향해 이동하도록 리드타임을 옮긴다
  const rounded = Math.round(raw / 5) * 5; // 슬라이더 step에 맞춤
  // 음수 허용: 박자를 예측해 신호보다 먼저 누르는 사람은 신호를 늦게 울려야 00초에 맞는다
  return Math.max(-300, Math.min(600, rounded));
}

// 목표에서 ±1.5초를 벗어난 클릭은 "진짜 시도"가 아니므로 통계에서 제외한다.
// (카운트다운 한참 전 몸풀기 클릭이 평균을 무너뜨리는 것 방지)
export function isRealAttempt(errMs, windowMs = 1500) {
  return Math.abs(errMs) <= windowMs;
}
