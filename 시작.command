#!/bin/zsh
# 리센느 00초 가이드 실행: 이 파일을 더블클릭하면 서버가 켜지고 브라우저가 열립니다.
cd "$(dirname "$0")"
(python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 &)
sleep 1
open "http://127.0.0.1:8765"
