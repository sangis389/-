/* ---- 집계 엔진: ELLIS 예약 행 → 주간 보고 ----
 * 기준 (엑셀 대조로 확인): 체크아웃일 기준 연간 누적, 예약 상태 Reserved/Confirmed,
 * 기준일(D) 23:59:59까지 들어온 예약. D 이후 취소된 예약은 D 시점에는 살아 있었으므로 포함.
 */
var SCM = (function () {
  'use strict';
  var ACTIVE = { Reserved: 1, Confirmed: 1 };
  var CCY = { VN: 'VND', TH: 'THB' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function addDays(s, n) { var d = parseYmd(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  function addYears(s, n) { var d = parseYmd(s); d.setUTCFullYear(d.getUTCFullYear() + n); return ymd(d); }
  function monthStart(s) { return s.slice(0, 7) + '-01'; }
  function prevMonthStart(s) { var d = parseYmd(monthStart(s)); d.setUTCMonth(d.getUTCMonth() - 1); return ymd(d); }

  // fromDate..toDate 를 ELLIS 제한(toDate ≤ fromDate+30일) 안의 구간으로 쪼갠다
  function windows(from, to) {
    var out = [], cur = from;
    while (cur <= to) {
      var end = addDays(cur, 30);
      if (end > to) end = to;
      out.push([cur, end]);
      cur = addDays(end, 1);
    }
    return out;
  }

  function normCity(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
      .toLowerCase().replace(/\bcity\b|\bprovince\b|\bisland\b/g, '').replace(/[^a-z]/g, '');
  }

  // 지역 매핑: 지정 목록 + 별칭. 목록이 비어 있으면 RN 상위 N개 도시, 나머지 ETC
  function regionMapper(cfg, cityRn) {
    var list = (cfg && cfg.regions) || [];
    var aliases = (cfg && cfg.aliases) || {};
    var byNorm = {};
    list.forEach(function (r) { byNorm[normCity(r)] = r; });
    Object.keys(aliases).forEach(function (k) { byNorm[normCity(k)] = aliases[k]; });
    if (!list.length && cityRn) {
      var top = Object.keys(cityRn).sort(function (a, b) { return cityRn[b] - cityRn[a]; }).slice(0, (cfg && cfg.autoTop) || 8);
      top.forEach(function (c) { byNorm[normCity(c)] = c; });
    }
    return function (city) { return byNorm[normCity(city)] || 'ETC'; };
  }

  // 현지통화 환율: 같은 예약일에 현지통화로 들어온 예약의 fxRate(현지→KRW) 중앙값
  function buildFx(rows, local) {
    var byDay = {};
    rows.forEach(function (r) {
      if (r.currency === local && r.fxRate > 0 && r.bookingDate) {
        var d = r.bookingDate.slice(0, 10);
        (byDay[d] = byDay[d] || []).push(r.fxRate);
      }
    });
    var days = Object.keys(byDay).sort();
    var med = {};
    days.forEach(function (d) {
      var a = byDay[d].sort(function (x, y) { return x - y; });
      med[d] = a[a.length >> 1];
    });
    return {
      days: days,
      rate: function (day) {
        if (med[day]) return med[day];
        if (!days.length) return null;
        // 가장 가까운 날짜
        var lo = 0, hi = days.length - 1;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (days[mid] < day) lo = mid + 1; else hi = mid; }
        var c = days[lo], p = days[Math.max(0, lo - 1)];
        return Math.abs(parseYmd(c) - parseYmd(day)) <= Math.abs(parseYmd(p) - parseYmd(day)) ? med[c] : med[p];
      },
    };
  }

  // 현지통화로 결제된 예약이 없으면(태국처럼 USD·KRW로만 결제) 현지 환율을 알 수 없으므로
  // ELLIS가 예약마다 주는 KRW 환율(fxRate)로 원화 집계한다
  var KRW_FX = { days: ['krw'], rate: function () { return 1; } };
  function pickFx(rows, local) {
    var fx = buildFx(rows, local);
    return fx.days.length ? { local: local, fx: fx } : { local: 'KRW', fx: KRW_FX };
  }

  // 예약 1건의 현지통화 판매가/마진
  function toLocal(r, local, fx) {
    if (r.currency === local) return { sell: +r.billing || 0, margin: +r.revenue || 0 };
    var lr = fx.rate((r.bookingDate || '').slice(0, 10));
    if (!lr || !(r.fxRate > 0)) return null;
    var k = r.fxRate / lr;
    return { sell: (+r.billing || 0) * k, margin: (+r.revenue || 0) * k };
  }

  // 시점 t(YYYY-MM-DD, 그날 끝) 기준으로 살아 있던 예약인가
  function aliveAt(r, t) {
    var end = t + ' 23:59:59';
    if (!r.bookingDate || r.bookingDate > end) return false;
    if (ACTIVE[r.bookingStatus]) return true;
    if (/^Cancel/i.test(r.bookingStatus || '') && r.cancelDate) {
      var c = String(r.cancelDate).replace('T', ' ');
      if (c.length === 10) c += ' 00:00:00';
      return c > end;
    }
    return false;
  }

  function blank() { return { rn: 0, sell: 0, margin: 0 }; }
  function add(a, rn, v) { a.rn += rn; a.sell += v.sell; a.margin += v.margin; }

  /**
   * rows: 체크아웃일 기준으로 받은 예약(올해 전체 + 전월이 작년이면 그 달 포함)
   * opts: { country, date(D), cfg:{regions,aliases,hotels:[{code,label}]}, lyRows? }
   */
  function compute(rows, opts) {
    var cc = opts.country, D = opts.date;
    var year = D.slice(0, 4);
    var T = { cur: D, prev: addDays(D, -7), prev2: addDays(D, -14) };
    var curM = D.slice(0, 7), prevM = prevMonthStart(D).slice(0, 7);
    var cfg = opts.cfg || {};
    var pf = pickFx(rows, CCY[cc] || 'VND'), local = pf.local, fx = pf.fx;

    // 1차: 도시별 RN (자동 지역 선택용) + 상태 집계
    var cityRn = {}, statuses = {}, skippedFx = 0;
    rows.forEach(function (r) {
      statuses[r.bookingStatus] = (statuses[r.bookingStatus] || 0) + 1;
      if ((r.checkOutDate || '').slice(0, 4) === year && aliveAt(r, D)) cityRn[r.hotelCity] = (cityRn[r.hotelCity] || 0) + (+r.roomNights || 0);
    });
    var regionOf = regionMapper(cfg, cityRn);
    var listed = {};
    (cfg.hotels || []).forEach(function (h) { listed[String(h.code)] = h; });

    var tot = { cur: blank(), prev: blank(), prev2: blank() };
    var month = { cur: blank(), prev: blank() }; // 당월 OTB / 전월 체크아웃 실적 (D 시점)
    var regions = {}, hotels = {};
    var seen = {};

    rows.forEach(function (r) {
      var key = r.bookingItemCode || (r.bookingCode + '|' + r.hotelCode + '|' + r.checkOutDate);
      if (seen[key]) return; // 구간 경계 중복 방지
      seen[key] = 1;
      var co = (r.checkOutDate || '').slice(0, 10);
      var rn = +r.roomNights || 0;
      var a0 = aliveAt(r, T.cur), a7 = aliveAt(r, T.prev), a14 = aliveAt(r, T.prev2);
      if (!a0 && !a7 && !a14) return;
      var v = toLocal(r, local, fx);
      if (!v) { skippedFx++; return; }
      var coM = co.slice(0, 7);
      if (a0 && coM === prevM) add(month.prev, rn, v);
      if (co.slice(0, 4) !== year) return;
      if (a0 && coM === curM) add(month.cur, rn, v);

      var rg = regionOf(r.hotelCity);
      var R = regions[rg] || (regions[rg] = { name: rg, cur: blank(), prev: blank(), prev2: blank(), mCur: 0, mPrev: 0 });
      var hc = String(r.hotelCode);
      var H = hotels[hc] || (hotels[hc] = { code: hc, name: r.hotelName, city: r.hotelCity, region: rg, cur: blank(), prev: blank(), prev2: blank(), ct: {}, months: null });
      if (a0) {
        add(tot.cur, rn, v); add(R.cur, rn, v); add(H.cur, rn, v);
        H.ct[r.contractType || '–'] = (H.ct[r.contractType || '–'] || 0) + rn;
        if (coM === curM) R.mCur += rn;
        if (listed[hc]) {
          if (!H.months) H.months = Array.apply(null, Array(12)).map(blank);
          add(H.months[+co.slice(5, 7) - 1], rn, v);
        }
      }
      if (a7) { add(tot.prev, rn, v); add(R.prev, rn, v); add(H.prev, rn, v); }
      if (a14) { add(tot.prev2, rn, v); add(R.prev2, rn, v); add(H.prev2, rn, v); }
    });
    // 지역별 전월 체크아웃 RN (전월이 작년이어도 포함)
    rows.forEach(function (r) {
      var co = (r.checkOutDate || '').slice(0, 7);
      if (co === prevM && aliveAt(r, T.cur) && seen[r.bookingItemCode || (r.bookingCode + '|' + r.hotelCode + '|' + r.checkOutDate)]) {
        var rg = regionOf(r.hotelCity);
        var R = regions[rg] || (regions[rg] = { name: rg, cur: blank(), prev: blank(), prev2: blank(), mCur: 0, mPrev: 0 });
        R.mPrev += +r.roomNights || 0;
      }
    });

    function slim(x) { return { rn: x.rn, sell: Math.round(x.sell), margin: Math.round(x.margin) }; }
    function dominant(ct) { return Object.keys(ct).sort(function (a, b) { return ct[b] - ct[a]; })[0] || ''; }

    var regionList = Object.keys(regions).map(function (k) {
      var R = regions[k];
      return { name: R.name, cur: slim(R.cur), prev: slim(R.prev), prev2: slim(R.prev2), mCur: R.mCur, mPrev: R.mPrev };
    }).filter(function (R) { return R.cur.rn || R.prev.rn || R.mPrev; })
      .sort(function (a, b) { return a.name === 'ETC' ? 1 : b.name === 'ETC' ? -1 : b.cur.rn - a.cur.rn; });

    var hotelList = Object.keys(hotels).map(function (k) {
      var H = hotels[k];
      return { code: H.code, name: H.name, city: H.city, region: H.region, ct: dominant(H.ct), cur: slim(H.cur), prev: slim(H.prev), prev2: slim(H.prev2) };
    });
    var byRn = hotelList.slice().sort(function (a, b) { return b.cur.rn - a.cur.rn; });

    // 신규: D-7 시점 0 → D 시점 >0
    var newHotels = hotelList.filter(function (h) { return h.cur.rn > 0 && h.prev.rn === 0; })
      .sort(function (a, b) { return b.cur.rn - a.cur.rn; }).slice(0, 10);
    // 급감속: 이번 주 픽업 - 지난주 픽업 이 가장 많이 줄어든 순 (지난주 픽업이 있던 곳만)
    function decel(x) { return (x.cur.rn - x.prev.rn) - (x.prev.rn - x.prev2.rn); }
    var dropHotels = hotelList.filter(function (h) { return h.prev.rn - h.prev2.rn > 0 && decel(h) < 0; })
      .sort(function (a, b) { return decel(a) - decel(b); }).slice(0, 10);
    var dropRegions = regionList.filter(function (h) { return h.prev.rn - h.prev2.rn > 0 && decel(h) < 0; })
      .sort(function (a, b) { return decel(a) - decel(b); }).slice(0, 10);

    // 독점/HB 지정 호텔
    var ex = { count: 0, cur: blank(), prev: blank(), hotels: [] };
    (cfg.hotels || []).forEach(function (h) {
      var H = hotels[String(h.code)];
      ex.count++;
      var months = H && H.months ? H.months.map(slim) : Array.apply(null, Array(12)).map(blank);
      ex.hotels.push({ code: String(h.code), label: h.label || '', name: (H && H.name) || h.name || '', region: H ? H.region : '', ct: H ? dominant(H.ct) : '', cur: H ? slim(H.cur) : blank(), prev: H ? slim(H.prev) : blank(), months: months });
      if (H) { add(ex.cur, H.cur.rn, H.cur); add(ex.prev, H.prev.rn, H.prev); }
    });
    ex.cur = slim(ex.cur); ex.prev = slim(ex.prev);

    var out = {
      country: cc, currency: local, date: D, year: +year, prevDate: T.prev,
      curMonth: curM, prevMonth: prevM,
      generatedAt: new Date().toISOString(),
      kpi: { cur: slim(tot.cur), prev: slim(tot.prev), prev2: slim(tot.prev2), monthCur: slim(month.cur), monthPrev: slim(month.prev) },
      regions: regionList,
      topHotels: byRn.slice(0, 10),
      hotelsTop50: byRn.slice(0, 50),
      hotelCount: hotelList.filter(function (h) { return h.cur.rn > 0; }).length,
      newHotels: newHotels, dropHotels: dropHotels, dropRegions: dropRegions,
      exclusive: ex,
      diag: { rows: rows.length, unique: Object.keys(seen).length, statuses: statuses, skippedFx: skippedFx, fxDays: fx.days.length },
    };
    out.currencyNote = local !== (CCY[cc] || 'VND') ? '현지통화(' + (CCY[cc] || '') + ')로 결제된 예약이 없어 ELLIS 예약 시점 환율로 원화(KRW) 집계' : '';
    if (opts.lyRows) out.kpi.ly = computeLy(opts.lyRows, cc, D, local);
    return out;
  }

  // 전년 동기: 작년 체크아웃 연도, 작년 같은 날 시점
  function computeLy(rows, cc, D, want) {
    var t = addYears(D, -1), year = t.slice(0, 4);
    var pf = want === 'KRW' ? { local: 'KRW', fx: KRW_FX } : pickFx(rows, CCY[cc] || 'VND'), local = pf.local, fx = pf.fx, acc = blank(), seen = {};
    rows.forEach(function (r) {
      var key = r.bookingItemCode || (r.bookingCode + '|' + r.hotelCode + '|' + r.checkOutDate);
      if (seen[key]) return; seen[key] = 1;
      if ((r.checkOutDate || '').slice(0, 4) !== year || !aliveAt(r, t)) return;
      var v = toLocal(r, local, fx);
      if (v) add(acc, +r.roomNights || 0, v);
    });
    return { rn: acc.rn, sell: Math.round(acc.sell), margin: Math.round(acc.margin) };
  }

  // 받아올 체크아웃 구간 목록
  function fetchPlan(D, withLy) {
    var year = +D.slice(0, 4);
    var from = year + '-01-01', pm = prevMonthStart(D);
    if (pm < from) from = pm;
    var plan = windows(from, year + '-12-31').map(function (w) { return { from: w[0], to: w[1], ly: false }; });
    if (withLy) windows((year - 1) + '-01-01', (year - 1) + '-12-31').forEach(function (w) { plan.push({ from: w[0], to: w[1], ly: true }); });
    return plan;
  }

  // 필요한 필드만 남겨 메모리 절약
  var KEEP = ['bookingItemCode', 'bookingCode', 'bookingDate', 'checkOutDate', 'hotelName', 'hotelCode', 'hotelCity', 'contractType', 'roomNights', 'billing', 'revenue', 'currency', 'fxRate', 'bookingStatus', 'cancelDate'];
  function slimRow(r) { var o = {}; for (var i = 0; i < KEEP.length; i++) o[KEEP[i]] = r[KEEP[i]]; return o; }

  return { compute: compute, fetchPlan: fetchPlan, windows: windows, slimRow: slimRow, addDays: addDays, normCity: normCity, aliveAt: aliveAt, CCY: CCY };
})();
if (typeof module !== 'undefined') module.exports = SCM;
