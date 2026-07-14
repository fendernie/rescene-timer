// 설정 지속성. storage는 localStorage 호환 {getItem,setItem}.
const KEY = "rescene-timer";

export const DEFAULTS = {
  leadMs: 200,
  manualOffsetMs: 0,
  soundOn: true,
  soundLatencyMs: 0, // 기기 소리 출력지연 수동 보정(소리가 화면보다 늦게 들리면 ↑)
  netDelayMs: 0, // 마지막 측정한 편도 네트워크 지연(리드타임 추천 목표에 반영)
  targetMode: "nextMinute",
  mode: "live", // "live" | "practice"
  errors: [],
};

export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function save(storage, settings) {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 저장 실패(예: 사파리 프라이빗 모드)해도 앱 동작에는 지장 없음
  }
}
