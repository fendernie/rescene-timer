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

export async function syncOnce(fetchFn) {
  const { serverMs, sentAt, recvAt } = await fetchFn();
  return { t0: sentAt, t1: recvAt, serverMs };
}

export async function syncOffset(fetchFn, rounds = 5) {
  const samples = [];
  for (let i = 0; i < rounds; i += 1) {
    try {
      samples.push(await syncOnce(fetchFn));
    } catch {
      // 개별 실패는 무시하고 다음 라운드 시도
    }
  }
  if (!samples.length) return { offsetMs: 0, rttMs: Infinity, ok: false };
  return { ...computeOffset(samples), ok: true };
}

// 왕복시간 샘플들로 편도 지연을 추정한다(최소 RTT의 절반). 샘플 없으면 null.
export function estimateOneWay(rttsMs) {
  if (!rttsMs.length) return null;
  return Math.round(Math.min(...rttsMs) / 2);
}

// 재동기화 결과 검증: 이미 동기화된 시계가 1초 넘게 점프하는 값은 오염된 측정으로 보고 버린다.
export function isSaneShift(prevOffsetMs, nextOffsetMs, isFirstSync) {
  if (isFirstSync) return true;
  return Math.abs(nextOffsetMs - prevOffsetMs) <= 1000;
}
