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
