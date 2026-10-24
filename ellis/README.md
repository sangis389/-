# ELLIS 연동 주간 보고 (claude.ai 페이지)

페이지: https://claude.ai/artifact/XnKfy686CRuzMd8JmdY99V
엑셀 업로드 없이 ELLIS 예약 데이터로 베트남·태국 주간 보고를 만드는 claude.ai 비공개 페이지의 소스입니다.

- `engine.js` — 집계 로직
- `page.html` — 화면. 게시할 때 `<script>/*ENGINE*/</script>` 자리에 `engine.js` 를 넣어 한 파일로 만듭니다.
- `build_report.js` — 내려받은 예약 행(JSON)으로 보고서 1개를 만드는 스크립트

실적 데이터와 설정(독점·HB 호텔 목록, 지역)은 페이지의 저장소(`reports/<CC>_<기준일>`, `config/settings`)에만 있고 이 저장소에는 없습니다.

## 집계 기준
- 그해 **체크아웃** 예약, 상태 Reserved/Confirmed, 기준일 23:59:59까지 들어온 예약 누적
  (기준일 이후 취소된 예약은 기준일 시점엔 살아 있었으므로 포함). 엑셀(9/24)과 RN 일치 확인.
- 전주 = 기준일 −7일 시점, MoM = 당월 체크아웃 OTB vs 전월 체크아웃 실적
- 금액: 현지통화. 현지통화로 결제된 예약이 없으면(태국) ELLIS fxRate로 KRW 집계
- 지역: ELLIS 도시명 그대로 RN 상위 12개 + ETC (`config/settings` 의 `autoTop`)

## 매주 진행 (Claude 세션에서 "이번 주 보고서 만들어줘")
1. 기준일 D = 보고일 전날(서울 기준).
2. ELLIS `get_hotel_bookings` 로 VN·TH 각각 `dateBasis=CHECK_OUT_DATE`, 올해 1/1~12/31 전체를 받는다.
   (전월이 작년 12월이면 그 달도 포함.) 매주 **전체를 다시** 받아야 한다 — 지난 예약의 취소를 잡을 방법이 이것뿐.
   - 동시 호출 금지(bulkhead_full). 한 번에 1건씩.
   - offset 4,000 이후 깊은 페이지는 시간 초과가 잦다 → 반달·10일 구간으로 나눠 받는다.
   - 시간 초과가 계속되면 limit 를 100 안팎으로 줄인다.
   - 받은 행은 bookingItemCode 로 중복 제거 후 JSON 배열 한 파일로 저장. 구간별 totalCount 합과 행 수가 같은지 확인.
   - 규모(2026-10 기준): VN 약 8.8만 건(약 40분), TH 약 2.6천 건(약 18분).
3. `config/settings` 를 읽어 `node build_report.js <rows.json> <VN|TH> <D> <settings.json> <out.json>`.
4. `reports/<CC>_<D>` 로 저장(ArtifactData set). 기존 보고서는 지우지 않는다(주차 추이에 사용).

## 시장·뉴스 (매주 보고서와 함께)
- 페이지 저장소 `news/<CC>_<기준일>`: `{country, date, weekFrom, weekTo, updatedBy, items:[{cat, title, summary, impact, region, date, inWeek, source, url}]}`
- cat: 항공 · 공항·인프라 · 정책·통계 · 날씨·재해 · 행사·이벤트 · OTA·프로모션 · 기타
- 기준일 직전 7일(weekFrom~weekTo)에 나온 뉴스 위주, 주차 밖 중요 항목은 inWeek:false.
- **출처: 공신력 있는 언론·공식 기관만.** (VnExpress, Tuoi Tre, VietnamPlus/VNA, Viet Nam News, Bangkok Post, The Nation, Thai PBS, TAT News, Reuters, Nikkei, CNA, TTG Asia, Skift 등)
  블로그, 쿠폰·딜 모음, AeroRoutes 같은 항공편 블로그, 지역 소식지는 쓰지 않는다.
- **범위: 베트남·태국 인바운드(국내 여행 포함)만.** 다른 나라 소비자 대상 아웃바운드 세일(예: 싱가포르발 OTA 10.10 세일)은 제외.
- 확인 대상: 항공 증편·감편/신규 취항, 롱탄공항 등 인프라, 비자·관광 정책과 입국 통계, 날씨·재해, 도시 행사, Agoda·Trip.com·Booking.com·Traveloka 캠페인.

## 대표 보고 리캡 (보고서 저장 후 대화창에 작성)
`node recap.js <vn_rows> <th_rows> <D> <vn_report> <th_report> <지난주 vn_report> <지난주 th_report>` 로 숫자를 뽑는다.
- 베트남: 1) **당월 체크아웃 RN**(전주 = 7일 전 시점의 같은 달 RN) 2) 누적 마진 M VND, 전주 대비 % 3) 마진율 = 마진 ÷ 원가(누적)
  - 연간 누적 RN은 주요 진행 사항에 '누적 N박 (전주 대비 +x)'로 넣는다.
- 태국: 1) 당월 체크아웃 RN(전주 = 7일 전 시점) 2) 누적 마진(KRW) 3) 마진율 = 마진 ÷ 원가
- 주요 진행 사항 첫 줄: **전주 대비 예약 발생 호텔** = engine의 newHotels(전주 기준일까지 올해 체크아웃 예약 0건 → 이번 주 예약 발생).
  SCM 활동으로 표현: "예약 0 호텔 분석·재협상 → N개 호텔 예약 발생 (호텔명 박수 …)". '신규 호텔/신규 계약'으로 쓰지 않는다(ELLIS엔 계약일 없음).
- 그 외 주간 픽업 상위 호텔 등 데이터 항목을 채우고, 익스클루시브 딜·출장 등은 [ ]로 비워 둔다.
