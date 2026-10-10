# ELLIS 연동 주간 보고 (claude.ai 페이지)

엑셀 업로드 없이 ELLIS 예약 데이터로 주간 보고를 만드는 claude.ai 비공개 페이지의 소스입니다.

- `engine.js` — 집계 로직 (체크아웃일 기준 연간 누적, Reserved/Confirmed, 기준일까지 들어온 예약)
- `page.html` — 화면. 게시할 때 `<script>/*ENGINE*/</script>` 자리에 `engine.js` 를 넣어 한 파일로 만듭니다.

실적 데이터와 설정(독점·HB 호텔 목록, 지역)은 페이지의 저장소에만 있고 이 저장소에는 없습니다.
