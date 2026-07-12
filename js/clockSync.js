// 시각 오프셋 계산: 서버/시각소스 응답 샘플로 기기 시계 보정값을 추정한다.
// sample = { t0: 요청보낸 로컬시각(ms), t1: 응답받은 로컬시각(ms), serverMs: 응답의 서버시각(ms) }

export function rttOf(sample) {
  return sample.t1 - sample.t0;
}

export function bestSample(samples) {
  return samples.reduce((a, b) => (rttOf(b) < rttOf(a) ? b : a));
}

export function offsetFromSample(sample) {
  const midpoint = (sample.t0 + sample.t1) / 2;
  return sample.serverMs - midpoint;
}

export function computeOffset(samples) {
  if (!samples.length) return { offsetMs: 0, rttMs: Infinity };
  const best = bestSample(samples);
  return { offsetMs: offsetFromSample(best), rttMs: rttOf(best) };
}

export function nowWith(offsetMs, clock = Date.now) {
  return clock() + offsetMs;
}
