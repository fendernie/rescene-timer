// 자동 보정 로직 (순수). 오차 단위 ms, +는 늦음. "클릭 오차"는 내 시계 기준, "도착"은 + 네트워크 지연.
//
// 핵심 원칙: 00초 전에 도착하면 최후순위(치명적), 조금 늦는 건 경미하다.
// 그래서 정각을 노리지 않고 "정각 + 안전 여유"에 도착하도록 리드타임을 맞춘다.

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 중앙값에서 100ms 넘게 벗어난 값(딴짓·실수)은 버리고 요약한다.
// 5회 표본은 흔들림을 작게 보는 경향이 있어 편차 하한을 10ms로 둔다.
export function robustSummary(errors, dropBeyondMs = 100) {
  if (!errors.length) return { n: 0, dropped: 0, median: 0, sigma: 0 };
  const m0 = median(errors);
  const kept = errors.filter((e) => Math.abs(e - m0) <= dropBeyondMs);
  const med = median(kept);
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  const sd = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / kept.length);
  return { n: kept.length, dropped: errors.length - kept.length, median: med, sigma: Math.max(10, sd) };
}

// 도착 시각 전체 흔들림: 손 + 중앙값 추정오차 + 시계 동기화 오차(균등분포 가정) + 네트워크 출렁임
export function totalSigma({ sigmaMs, n, clockUncMs = 0, netJitterMs = 0 }) {
  return Math.sqrt(sigmaMs ** 2 + sigmaMs ** 2 / Math.max(1, n) + (clockUncMs / Math.sqrt(3)) ** 2 + netJitterMs ** 2);
}

// 안전 여유 = 전체 흔들림의 2.5배 (정각 전 도착 확률 약 0.6%). 30~200ms로 제한.
export function safetyMargin(opts) {
  return Math.max(30, Math.min(200, Math.round(2.5 * totalSigma(opts))));
}

// 표준정규 누적분포 (Abramowitz-Stegun 근사, 오차 < 1e-7)
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// 정각 전에 도착할 확률
export function earlyRisk({ arrivalMeanMs, sigmaTotMs }) {
  return phi(-arrivalMeanMs / sigmaTotMs);
}

export function clampLead(ms) {
  return Math.max(-300, Math.min(600, Math.round(ms / 5) * 5));
}

// 보정 블록(5회) 결과로 새 리드타임을 계산한다.
// 신호를 Δ만큼 늦추면 박자를 따라 누르는 사람의 클릭도 Δ만큼 늦어진다 → lead -= (목표 - 중앙값).
export function planAdjust({ errors, leadMs, netDelayMs, clockUncMs = 0, netJitterMs = 0 }) {
  const r = robustSummary(errors);
  if (r.n < 4) return { ok: false, n: r.n };
  const sigmaTotMs = totalSigma({ sigmaMs: r.sigma, n: r.n, clockUncMs, netJitterMs });
  const marginMs = safetyMargin({ sigmaMs: r.sigma, n: r.n, clockUncMs, netJitterMs });
  const aimMs = marginMs - netDelayMs; // 클릭 목표 = 여유 - 지연 (지연만큼 미리, 여유만큼 늦게)
  return {
    ok: true, n: r.n, median: r.median, sigmaMs: r.sigma, sigmaTotMs, marginMs, aimMs,
    leadMs: clampLead(leadMs + r.median - aimMs),
  };
}

// 확인 블록(3회): 중앙값이 목표 ±15ms 안이면 통과
export function checkVerify({ errors, aimMs, toleranceMs = 15 }) {
  const r = robustSummary(errors);
  if (r.n < 2) return { ok: false, n: r.n, median: r.median };
  return { ok: Math.abs(r.median - aimMs) <= toleranceMs, n: r.n, median: r.median };
}

// 빠른 연습용 목표 시각들: 3-2-1 틱이 다 들리도록 첫 목표는 4.5초 뒤(0.1초 단위 올림), 이후 gap 간격
export function practiceTargets(startMs, n, gapMs = 8000) {
  const first = Math.ceil((startMs + 4500) / 100) * 100;
  return Array.from({ length: n }, (_, i) => first + i * gapMs);
}
