// 설정 지속성. storage는 localStorage 호환 {getItem,setItem}.
const KEY = "rescene-timer";

export const DEFAULTS = {
  version: 2,
  leadMs: 200,
  manualOffsetMs: 0,
  soundOn: true,
  soundLatencyMs: 0, // 기기 소리 출력지연 수동 보정(소리가 화면보다 늦게 들리면 ↑)
  netDelayMs: 0, // 마지막 측정한 편도 네트워크 지연(리드타임 목표에 반영)
  netJitterMs: 0, // 네트워크 지연의 출렁임(안전 여유 계산용)
  releaseMode: true, // true면 "뗄 때" 측정 — 웹 버튼은 뗄 때 실행되므로 기본값
  errors: [], // 마지막 자동 보정의 클릭 오차들
  noticeFields: [], // 공지에서 붙여넣은 실제 기입 항목 (리허설 폼에 그대로 사용)
  calib: null, // 마지막 자동 보정 결과 { at, leadMs, aimMs, marginMs, sigmaTotMs, riskPct }
};

export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const stored = JSON.parse(raw);
    return migrate({ ...structuredClone(DEFAULTS), ...stored }, stored.version ?? 1);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

// v1 → v2: "뗄 때 측정"을 기본으로, 옛 기준(정각 도착 목표)의 연습 기록은 폐기. 리드타임은 출발점으로 유지.
function migrate(s, storedVersion) {
  if (storedVersion < 2) {
    s.version = 2;
    s.releaseMode = true;
    s.errors = [];
    delete s.mode;
    delete s.targetMode;
  }
  return s;
}

export function save(storage, settings) {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 저장 실패(예: 사파리 프라이빗 모드)해도 앱 동작에는 지장 없음
  }
}
