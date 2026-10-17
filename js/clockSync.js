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

// 단조시계(컴퓨터 시각 조정·NTP 보정에 흔들리지 않는 시계)를 epoch ms로.
export function mono() {
  return performance.timeOrigin + performance.now();
}

// 단조시계 기준 오프셋 → 벽시계(Date.now) 기준 오프셋. 노트북 잠자기 동안 단조시계가 멈춰도
// 이 값은 그대로라서, 재동기화 점프 검사(isSaneShift)를 이 값으로 하면 잠자기를 오염으로 오인하지 않는다.
export function wallOffset(monoOffsetMs, dateNowMs, monoNowMs) {
  return monoOffsetMs - (dateNowMs - monoNowMs);
}

// 왕복시간들의 출렁임(편도 기준 표준편차). 첫 요청은 연결 준비 비용이 섞여 제외. 0~50ms로 제한.
export function jitterOf(rttsMs) {
  const xs = rttsMs.slice(1).map((r) => r / 2);
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  return Math.min(50, Math.round(sd));
}
