// 카운트다운/신호 타이밍 (순수 함수). 시각은 모두 epoch ms.
const MINUTE = 60_000;

export function nextMinuteBoundary(nowMs) {
  return Math.floor(nowMs / MINUTE) * MINUTE + MINUTE;
}

export function msUntil(nowMs, targetMs) {
  return targetMs - nowMs;
}

export function signalPhase(nowMs, targetMs, leadMs) {
  const msLeft = msUntil(nowMs, targetMs);
  const eff = nowMs + leadMs; // 리드타임만큼 신호를 앞당김
  const effLeft = targetMs - eff;
  let phase;
  if (effLeft <= 0) phase = "go";
  else if (effLeft < 1000) phase = "tick1";
  else if (effLeft < 2000) phase = "tick2";
  else if (effLeft < 3000) phase = "tick3";
  else phase = "idle";
  return { phase, msLeft };
}

// 소리 예약용: 정각(target)과 리드타임 기준으로 틱3·2·1과 정각음의 정확한 시각 목록.
export function cueTimes(targetMs, leadMs) {
  const goAt = targetMs - leadMs;
  return [
    { at: goAt - 3000, kind: "tick" },
    { at: goAt - 2000, kind: "tick" },
    { at: goAt - 1000, kind: "tick" },
    { at: goAt, kind: "go" },
  ];
}

// 백그라운드 소리 모드용: 정각 1분 전부터의 소리 패턴 (30초 예고 → 10초 뚜뚜 → 5..1 상승음 → 정각음)
export function bgCueTimes(targetMs, leadMs) {
  const g = targetMs - leadMs;
  return [
    { at: g - 30000, freq: 330, ms: 400, kind: "warn30" },
    { at: g - 10000, freq: 523, ms: 120, kind: "warn10" },
    { at: g - 9800, freq: 523, ms: 120, kind: "warn10" },
    { at: g - 5000, freq: 660, ms: 80, kind: "count" },
    { at: g - 4000, freq: 700, ms: 80, kind: "count" },
    { at: g - 3000, freq: 750, ms: 80, kind: "count" },
    { at: g - 2000, freq: 800, ms: 80, kind: "count" },
    { at: g - 1000, freq: 880, ms: 80, kind: "count" },
    { at: g, freq: 1200, ms: 500, kind: "go" },
  ];
}
