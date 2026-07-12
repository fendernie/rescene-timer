// 설정 지속성. storage는 localStorage 호환 {getItem,setItem}.
const KEY = "rescene-timer";

export const DEFAULTS = {
  leadMs: 200,
  manualOffsetMs: 0,
  soundOn: true,
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
  storage.setItem(KEY, JSON.stringify(settings));
}
