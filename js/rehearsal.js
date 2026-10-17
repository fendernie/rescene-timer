// 리허설(모의 신청 폼) 로직: 실전처럼 정각에 폼이 열리고, 가끔 예상 밖 항목이 섞인다.
export const BASE_FIELDS = ["팬클럽 이름", "생년월일(6자리)", "전화번호"];
export const SURPRISE_POOL = ["버블 구독 멤버 이름", "최애 멤버", "이메일", "팬클럽 가입 기수"];

// r: [0,1) 난수. 40%는 기본 폼, 60%는 서프라이즈 항목 1개 추가 — "끝까지 스크롤" 습관 훈련용.
// custom: 사용자가 붙여넣은 실제 공지 항목. 있으면 그대로 쓴다(실전 폼 재현이 최우선).
export function buildFields(r, custom = []) {
  if (custom.length) return [...custom];
  if (r < 0.4) return [...BASE_FIELDS];
  const idx = Math.min(Math.floor(((r - 0.4) / 0.6) * SURPRISE_POOL.length), SURPRISE_POOL.length - 1);
  return [...BASE_FIELDS, SURPRISE_POOL[idx]];
}

// 폼 열림→제출까지 걸린 시간(초, 소수 1자리)
export function elapsedSec(openMs, submitMs) {
  return Math.round((submitMs - openMs) / 100) / 10;
}

// 공지에서 붙여넣은 텍스트 → 항목 목록. 한 줄에 하나, 앞의 번호·글머리표는 떼어낸다.
export function parseFields(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*·])\s*/, "").trim())
    .filter(Boolean);
}
