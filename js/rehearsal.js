// 리허설(모의 신청 폼) 로직: 실전처럼 정각에 폼이 열리고, 가끔 예상 밖 항목이 섞인다.
export const BASE_FIELDS = ["팬클럽 이름", "생년월일(6자리)", "전화번호"];
export const SURPRISE_POOL = ["버블 구독 멤버 이름", "최애 멤버", "이메일", "팬클럽 가입 기수"];

// r: [0,1) 난수. 40%는 기본 폼, 60%는 서프라이즈 항목 1개 추가 — "끝까지 스크롤" 습관 훈련용.
export function buildFields(r) {
  if (r < 0.4) return [...BASE_FIELDS];
  const idx = Math.min(Math.floor(((r - 0.4) / 0.6) * SURPRISE_POOL.length), SURPRISE_POOL.length - 1);
  return [...BASE_FIELDS, SURPRISE_POOL[idx]];
}

// 폼 열림→제출까지 걸린 시간(초, 소수 1자리)
export function elapsedSec(openMs, submitMs) {
  return Math.round((submitMs - openMs) / 100) / 10;
}
