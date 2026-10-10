/* SCM Weekly Dashboard — 화면 렌더링 / 저장 */
(function () {
  'use strict';

  const STORE_KEY = 'omh-scm-weekly-v1';
  const MONTHS = WeeklyParser.MONTHS;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const state = {
    reports: {},        // id -> report
    country: null,
    id: null,
    basis: 'rev',
    tab: 'summary',
    hbHotel: null,
    charts: [],
  };

  /* ---------- 저장 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        state.reports = d.reports || {};
        state.basis = d.basis || 'rev';
        state.country = d.country || null;
        state.id = d.id || null;
      }
    } catch (e) { /* 저장소 사용 불가 시 메모리로만 동작 */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ reports: state.reports, basis: state.basis, country: state.country, id: state.id }));
    } catch (e) { toast('브라우저 저장 공간에 저장하지 못했습니다. (이번 세션에서만 유지됩니다)'); }
  }
  // 저장소(GitHub Pages)에 data/reports.json 이 있으면 함께 불러온다 — 팀 공유용
  async function loadShared() {
    try {
      const res = await fetch('data/reports.json', { cache: 'no-store' });
      if (!res.ok) return 0;
      const d = await res.json();
      let n = 0;
      (d.reports ? Object.values(d.reports) : Array.isArray(d) ? d : []).forEach((r) => {
        if (r && r.id && !state.reports[r.id]) { state.reports[r.id] = r; n++; }
      });
      return n;
    } catch (e) { return 0; }
  }

  /* ---------- 포맷 ---------- */
  const CURRENCY = [
    [/viet|vn/i, 'VND'], [/korea|kr/i, 'KRW'], [/japan|jp/i, 'JPY'], [/thai/i, 'THB'],
    [/malay/i, 'MYR'], [/hong|hk/i, 'HKD'], [/taiwan|tw/i, 'TWD'],
  ];
  const currencyOf = (country) => (CURRENCY.find(([re]) => re.test(country || '')) || [null, ''])[1];
  const nf0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
  const nfC = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const fmtInt = (v) => (isNum(v) ? nf0.format(v) : '–');
  const fmtMoney = (v) => (isNum(v) ? nfC.format(v) : '–');
  const fmtPct = (v, d = 1) => (isNum(v) ? (v * 100).toFixed(d) + '%' : '–');
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
  function fmtDelta(v, kind) {
    if (!isNum(v)) return '<span class="flat">–</span>';
    const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '';
    const a = Math.abs(v);
    const body = kind === 'pp' ? (a * 100).toFixed(2) + '%p' : kind === 'money' ? nfC.format(a) : nf0.format(a);
    return `<span class="${cls}">${arrow} ${sign(v)}${body}</span>`;
  }
  const pctChange = (cur, base) => (isNum(cur) && isNum(base) && base !== 0 ? (cur - base) / Math.abs(base) : null);
  function fmtDeltaPct(cur, base) {
    const p = pctChange(cur, base);
    if (p == null) return '';
    return ` <span class="muted">(${sign(p)}${Math.abs(p * 100).toFixed(1)}%)</span>`;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sum = (arr) => arr.reduce((a, b) => a + (isNum(b) ? b : 0), 0);

  function rate(margin, rev, cost) {
    const base = state.basis === 'cost' ? cost : rev;
    return isNum(margin) && isNum(base) && base !== 0 ? margin / base : null;
  }
  const basisLabel = () => (state.basis === 'cost' ? '원가 대비' : '매출 대비');

  /* ---------- 공통 UI ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 4200);
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function destroyCharts() { state.charts.forEach((c) => c.destroy()); state.charts = []; }

  function chartDefaults() {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = cssVar('--text-secondary');
    Chart.defaults.borderColor = cssVar('--grid');
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = cssVar('--surface-1');
    Chart.defaults.plugins.tooltip.titleColor = cssVar('--text-primary');
    Chart.defaults.plugins.tooltip.bodyColor = cssVar('--text-secondary');
    Chart.defaults.plugins.tooltip.borderColor = cssVar('--border');
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.maintainAspectRatio = false;
  }
  function makeChart(canvas, cfg) {
    if (!canvas) return null;
    const c = new Chart(canvas, cfg);
    state.charts.push(c);
    return c;
  }
  const barStyle = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22, borderWidth: 0 };
  const moneyTick = (v) => nfC.format(v);
  const intTick = (v) => nf0.format(v);

  // 정렬 가능한 표
  function table({ columns, rows, foot, sortKey, sortDir = 'desc', id }) {
    const tid = id || 't' + Math.random().toString(36).slice(2, 8);
    const html = `<div class="table-wrap"><table id="${tid}"><thead><tr>${columns
      .map((c, i) => `<th class="${c.r ? 'r ' : ''}${c.sort ? 'sortable' : ''}" data-i="${i}">${esc(c.label)}</th>`)
      .join('')}</tr></thead><tbody></tbody>${foot ? `<tfoot><tr>${foot.map((f, i) => `<td class="${columns[i].r ? 'r' : ''}">${f}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
    requestAnimationFrame(() => {
      const el = document.getElementById(tid);
      if (!el) return;
      let sk = sortKey != null ? sortKey : -1, sd = sortDir;
      const draw = () => {
        let rs = rows.slice();
        if (sk >= 0 && columns[sk].sort) {
          const f = columns[sk].sort;
          rs.sort((a, b) => {
            const x = f(a), y = f(b);
            if (x == null) return 1; if (y == null) return -1;
            return (typeof x === 'string' ? x.localeCompare(y) : x - y) * (sd === 'asc' ? 1 : -1);
          });
        }
        el.tBodies[0].innerHTML = rs.length
          ? rs.map((r, idx) => `<tr>${columns.map((c) => `<td class="${c.r ? 'r ' : ''}${c.cls || ''}">${c.cell(r, idx)}</td>`).join('')}</tr>`).join('')
          : `<tr><td colspan="${columns.length}" class="muted">입력된 내용이 없습니다</td></tr>`;
        $$('th', el).forEach((th) => {
          th.classList.remove('sorted-asc', 'sorted-desc');
          if (+th.dataset.i === sk) th.classList.add(sd === 'asc' ? 'sorted-asc' : 'sorted-desc');
        });
      };
      $$('th.sortable', el).forEach((th) => th.addEventListener('click', () => {
        const i = +th.dataset.i;
        if (sk === i) sd = sd === 'asc' ? 'desc' : 'asc'; else { sk = i; sd = 'desc'; }
        draw();
      }));
      draw();
    });
    return html;
  }
  function barCell(v, max, text) {
    const w = isNum(v) && max > 0 ? Math.max(0, (v / max) * 100) : 0;
    return `<div class="bar" style="width:calc((100% - 86px) * ${(w / 100).toFixed(4)})"></div><span>${text}</span>`;
  }
  const section = (title, body, aside = '') => `<div class="section"><div class="section-head"><h2>${esc(title)}</h2>${aside ? `<span class="muted small">${aside}</span>` : ''}</div>${body}</div>`;

  /* ---------- 선택 ---------- */
  const reportsOf = (country) => Object.values(state.reports).filter((r) => r.country === country).sort((a, b) => a.date.localeCompare(b.date));
  const countries = () => Array.from(new Set(Object.values(state.reports).map((r) => r.country))).sort();
  function current() { return state.reports[state.id] || null; }
  function previousOf(r) {
    const list = reportsOf(r.country);
    const i = list.findIndex((x) => x.id === r.id);
    return i > 0 ? list[i - 1] : null;
  }

  function syncSelectors() {
    const cs = countries();
    if (!cs.includes(state.country)) state.country = cs[0] || null;
    const list = state.country ? reportsOf(state.country) : [];
    if (!list.find((r) => r.id === state.id)) state.id = list.length ? list[list.length - 1].id : null;
    $('#sel-country').innerHTML = cs.map((c) => `<option ${c === state.country ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('#sel-week').innerHTML = list.slice().reverse().map((r) => `<option value="${esc(r.id)}" ${r.id === state.id ? 'selected' : ''}>${esc(r.weekLabel || r.date)} (${esc(r.date)})</option>`).join('');
    $('#sel-basis').value = state.basis;
  }

  /* ---------- 렌더 ---------- */
  function render() {
    syncSelectors();
    destroyCharts();
    chartDefaults();
    const r = current();
    $('#empty').hidden = !!r;
    $('#tabs').hidden = !r;
    $$('.panel').forEach((p) => (p.hidden = !r || p.dataset.panel !== state.tab));
    $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    if (!r) { $('#meta-line').textContent = '주간 보고 엑셀을 올리면 대시보드가 만들어집니다'; return; }
    const ccy = currencyOf(r.country);
    $('#meta-line').textContent = [r.country, r.weekLabel, r.preparedBy ? '작성: ' + r.preparedBy : '', ccy ? '통화 ' + ccy : '', r.fileName].filter(Boolean).join(' · ');
    renderSummary(r);
    renderMovers(r);
    renderHB(r);
    renderMarket(r);
    renderTrend(r);
    renderChecks(r);
  }

  /* ① 주간 실적 */
  function renderSummary(r) {
    const k = r.kpi;
    const ccy = currencyOf(r.country);
    const g = (key, f) => (k[key] ? k[key][f] : null);
    const rateOf = (f) => rate(g('margin', f), g('rev', f), g('cost', f));
    const tiles = [
      { key: 'rn', label: 'Total RN (Nights)', kind: 'int', unit: 'RN' },
      { key: 'rev', label: 'Selling Rate (Revenue)', kind: 'money', unit: ccy },
      { key: 'cost', label: 'Buying Rate (Cost)', kind: 'money', unit: ccy },
      { key: 'margin', label: 'Margin (Profit)', kind: 'money', unit: ccy },
      { key: 'rate', label: `Margin Rate (${basisLabel()})`, kind: 'pp' },
    ];
    const val = (t, f) => (t.key === 'rate' ? rateOf(f) : g(t.key, f));
    const fmtV = (t, v) => (t.kind === 'int' ? fmtInt(v) : t.kind === 'money' ? fmtMoney(v) : fmtPct(v, 2));
    const kpiHtml = tiles.map((t) => {
      const cur = val(t, 'cur');
      const row = (lbl, f) => {
        const b = val(t, f);
        const d = isNum(cur) && isNum(b) ? cur - b : null;
        return `<dt>${lbl}</dt><dd>${fmtDelta(d, t.kind)}${t.kind !== 'pp' ? fmtDeltaPct(cur, b) : ''}</dd>`;
      };
      return `<div class="card kpi"><div class="label">${esc(t.label)}</div>
        <div class="value">${fmtV(t, cur)}${t.unit && t.kind !== 'pp' ? `<span class="unit">${esc(t.unit)}</span>` : ''}</div>
        <dl class="deltas">${row('WoW', 'prev')}${row('MoM', 'mavg')}${row('YoY', 'ly')}</dl></div>`;
    }).join('');

    const cmpRows = tiles.map((t) => ({ t, cur: val(t, 'cur'), prev: val(t, 'prev'), mavg: val(t, 'mavg'), ly: val(t, 'ly'), remark: t.key === 'rate' ? '' : (k[t.key] || {}).remark }));
    const cmpTable = table({
      columns: [
        { label: 'Metric', cell: (x) => esc(x.t.label) },
        { label: 'This Week', r: true, cell: (x) => fmtV(x.t, x.cur) },
        { label: 'Previous Week', r: true, cell: (x) => fmtV(x.t, x.prev) },
        { label: 'WoW', r: true, cell: (x) => fmtDelta(isNum(x.cur) && isNum(x.prev) ? x.cur - x.prev : null, x.t.kind) },
        { label: 'Prior Month Avg', r: true, cell: (x) => fmtV(x.t, x.mavg) },
        { label: 'MoM', r: true, cell: (x) => fmtDelta(isNum(x.cur) && isNum(x.mavg) ? x.cur - x.mavg : null, x.t.kind) },
        { label: 'Prior Year', r: true, cell: (x) => fmtV(x.t, x.ly) },
        { label: 'YoY', r: true, cell: (x) => fmtDelta(isNum(x.cur) && isNum(x.ly) ? x.cur - x.ly : null, x.t.kind) },
        { label: 'Remarks', cls: 'remark', cell: (x) => esc(x.remark || '') },
      ],
      rows: cmpRows,
    });

    // 지역
    const regions = r.regions.filter((x) => isNum(x.rn));
    const totRn = sum(regions.map((x) => x.rn)), totRev = sum(regions.map((x) => x.rev)), totM = sum(regions.map((x) => x.margin));
    const maxRn = Math.max(0, ...regions.map((x) => x.rn));
    const regionTable = table({
      columns: [
        { label: 'Region/City', sort: (x) => x.name, cell: (x) => esc(x.name) },
        { label: 'RN', r: true, cls: 'bar-cell', sort: (x) => x.rn, cell: (x) => barCell(x.rn, maxRn, fmtInt(x.rn)) },
        { label: 'RN 비중', r: true, sort: (x) => x.rn, cell: (x) => fmtPct(totRn ? x.rn / totRn : null) },
        { label: 'Revenue', r: true, sort: (x) => x.rev, cell: (x) => fmtMoney(x.rev) },
        { label: 'Margin', r: true, sort: (x) => x.margin, cell: (x) => fmtMoney(x.margin) },
        { label: 'Margin Rate', r: true, sort: (x) => rate(x.margin, x.rev, x.rev - x.margin), cell: (x) => fmtPct(rate(x.margin, x.rev, x.rev - x.margin), 2) },
        { label: 'WoW ΔRN', r: true, sort: (x) => x.wowRn, cell: (x) => fmtDelta(x.wowRn, 'int') },
        { label: 'WoW ΔMargin', r: true, sort: (x) => x.wowMargin, cell: (x) => fmtDelta(x.wowMargin, 'money') },
        { label: 'MoM ΔRN', r: true, sort: (x) => x.momRn, cell: (x) => fmtDelta(x.momRn, 'int') },
        { label: 'Remarks', cls: 'remark', cell: (x) => esc(x.remark) },
      ],
      rows: regions, sortKey: 1,
      foot: ['Total', fmtInt(totRn), '100%', fmtMoney(totRev), fmtMoney(totM), fmtPct(rate(totM, totRev, totRev - totM), 2),
        fmtDelta(sum(regions.map((x) => x.wowRn)), 'int'), fmtDelta(sum(regions.map((x) => x.wowMargin)), 'money'), fmtDelta(sum(regions.map((x) => x.momRn)), 'int'), ''],
    });

    // Top hotels
    const hotels = r.topHotels;
    const maxH = Math.max(0, ...hotels.map((x) => x.rn || 0));
    const hotelTable = table({
      columns: [
        { label: '#', r: true, cell: (x, i) => i + 1 },
        { label: 'Hotel Name', sort: (x) => x.name, cell: (x) => esc(x.name) },
        { label: 'Region', sort: (x) => x.region, cell: (x) => esc(x.region) },
        { label: 'RN', r: true, cls: 'bar-cell', sort: (x) => x.rn, cell: (x) => barCell(x.rn, maxH, fmtInt(x.rn)) },
        { label: 'Revenue', r: true, sort: (x) => x.rev, cell: (x) => fmtMoney(x.rev) },
        { label: 'Margin', r: true, sort: (x) => x.margin, cell: (x) => fmtMoney(x.margin) },
        { label: 'Margin Rate', r: true, sort: (x) => rate(x.margin, x.rev, x.rev - x.margin), cell: (x) => fmtPct(rate(x.margin, x.rev, x.rev - x.margin), 2) },
        { label: 'WoW ΔRN', r: true, sort: (x) => x.wowRn, cell: (x) => fmtDelta(x.wowRn, 'int') },
        { label: '계약', cell: (x) => (x.contract ? `<span class="tag">${esc(x.contract)}</span>` : '') },
        { label: 'Remarks', cls: 'remark', cell: (x) => esc(x.remark) },
      ],
      rows: hotels, sortKey: 3,
    });

    // 독점 / HB
    const e = r.exclusive;
    const exStat = (key, kind, label) => {
      const x = e[key];
      if (!x) return '';
      const v = kind === 'pct' ? fmtPct(x.cur, 2) : fmtInt(x.cur);
      const d = isNum(x.cur) && isNum(x.prev) ? x.cur - x.prev : null;
      return `<div class="stat"><div class="label">${esc(label || x.label)}</div><div class="value">${v}</div><div class="delta">WoW ${fmtDelta(d, kind === 'pct' ? 'pp' : 'int')}</div></div>`;
    };
    const util = hbUtil(r);
    const exHtml = `<div class="card"><div class="stat-row">
      ${exStat('exclHotels', 'int', '독점 호텔 수')}
      ${exStat('exclRnShare', 'pct', '독점 RN 비중')}
      ${exStat('exclMarginShare', 'pct', '독점 마진 기여도')}
      ${exStat('exclMarginRate', 'pct', '독점 평균 마진율')}
      ${exStat('hbTotalRn', 'int', 'HB 총 RN')}
      ${exStat('hbUnsoldRn', 'int', 'HB 미판매 RN')}
      ${util.calc != null ? `<div class="stat"><div class="label">HB 소진율 (계산값)</div><div class="value">${fmtPct(util.calc, 2)}</div><div class="delta">WoW ${fmtDelta(util.calcPrev != null ? util.calc - util.calcPrev : null, 'pp')}</div></div>` : ''}
    </div></div>`;

    $('[data-panel="summary"]').innerHTML = `
      <div class="grid g-kpi">${kpiHtml}</div>
      ${section('Weekly Total Performance — WoW / MoM / YoY', `<div class="card">${cmpTable}</div>`, esc(r.currencyNote || ''))}
      ${section('Performance by Region', `
        <div class="grid g-2">
          <div class="card"><h3>지역별 RN</h3><div class="chart" style="height:${Math.max(220, regions.length * 30 + 40)}px"><canvas id="c-region-rn"></canvas></div></div>
          <div class="card"><h3>지역별 WoW ΔRN</h3><div class="chart" style="height:${Math.max(220, regions.length * 30 + 40)}px"><canvas id="c-region-wow"></canvas></div></div>
        </div>
        <div class="card" style="margin-top:16px">${regionTable}</div>`, r.momBaseDate ? `MoM ΔRN 기준: ${r.momBaseDate} 스냅샷` : '')}
      ${section('Top 10 Hotels (by RN)', `<div class="card">${hotelTable}</div>`)}
      ${section('Exclusive / Hard Block Performance Contribution', exHtml)}
    `;

    const sorted = regions.slice().sort((a, b) => b.rn - a.rn);
    makeChart($('#c-region-rn'), {
      type: 'bar',
      data: { labels: sorted.map((x) => x.name), datasets: [{ label: 'RN', data: sorted.map((x) => x.rn), backgroundColor: cssVar('--series-1'), ...barStyle }] },
      options: { indexAxis: 'y', scales: { x: { ticks: { callback: intTick }, grid: { color: cssVar('--grid') } }, y: { grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` RN ${fmtInt(c.raw)} · 비중 ${fmtPct(totRn ? c.raw / totRn : null)}` } } } },
    });
    const byWow = regions.slice().sort((a, b) => (b.wowRn || 0) - (a.wowRn || 0));
    makeChart($('#c-region-wow'), {
      type: 'bar',
      data: { labels: byWow.map((x) => x.name), datasets: [{ label: 'WoW ΔRN', data: byWow.map((x) => x.wowRn), backgroundColor: byWow.map((x) => ((x.wowRn || 0) >= 0 ? cssVar('--series-1') : '#e34948')), ...barStyle, borderSkipped: false }] },
      options: { indexAxis: 'y', scales: { x: { ticks: { callback: intTick }, grid: { color: cssVar('--grid') } }, y: { grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` WoW ΔRN ${sign(c.raw)}${fmtInt(Math.abs(c.raw))}` } } } },
    });
  }

  function hbUtil(r) {
    const e = r.exclusive;
    const t = e.hbTotalRn, u = e.hbUnsoldRn;
    const calc = t && isNum(t.cur) && t.cur > 0 && isNum(u && u.cur) ? (t.cur - u.cur) / t.cur : null;
    const calcPrev = t && isNum(t.prev) && t.prev > 0 && isNum(u && u.prev) ? (t.prev - u.prev) / t.prev : null;
    return { calc, calcPrev, sheet: e.hbUtil ? e.hbUtil.cur : null };
  }

  /* ② 신규 / 급감속 */
  function renderMovers(r) {
    const hotelCols = (auto) => [
      { label: '#', r: true, cell: (x, i) => i + 1 },
      { label: 'Hotel Name', sort: (x) => x.name, cell: (x) => esc(x.name) },
      { label: 'Region', sort: (x) => x.region, cell: (x) => esc(x.region) },
      { label: 'RN', r: true, sort: (x) => x.rn, cell: (x) => fmtInt(x.rn) },
      { label: 'Revenue', r: true, sort: (x) => x.rev, cell: (x) => fmtMoney(x.rev) },
      { label: 'Margin', r: true, sort: (x) => x.margin, cell: (x) => fmtMoney(x.margin) },
      { label: 'Margin Rate', r: true, cell: (x) => fmtPct(rate(x.margin, x.rev, x.rev - x.margin), 2) },
      { label: 'WoW ΔRN', r: true, sort: (x) => x.wowRn, cell: (x) => fmtDelta(x.wowRn, 'int') },
      { label: 'Remarks', cls: 'remark', cell: (x) => esc(x.remark) },
    ];
    // 원본 시트가 비어 있으면 ①의 지역 데이터에서 WoW 하위 지역을 자동 산출
    let dropRegions = r.dropRegions, autoRegions = false;
    if (!dropRegions.length && r.regions.some((x) => isNum(x.wowRn))) {
      dropRegions = r.regions.filter((x) => isNum(x.wowRn)).sort((a, b) => a.wowRn - b.wowRn).slice(0, 5);
      autoRegions = true;
    }
    // 신규 호텔: 이전 주차 Top10 에 없던 호텔 (원본 미입력 시 참고용)
    let newHotels = r.newHotels, autoNew = false;
    const prev = previousOf(r);
    if (!newHotels.length && prev && prev.topHotels.length) {
      const names = new Set(prev.topHotels.map((h) => h.name));
      newHotels = r.topHotels.filter((h) => !names.has(h.name));
      autoNew = newHotels.length > 0;
    }
    let dropHotels = r.dropHotels, autoDrop = false;
    if (!dropHotels.length && r.topHotels.some((x) => isNum(x.wowRn))) {
      dropHotels = r.topHotels.filter((x) => isNum(x.wowRn)).sort((a, b) => a.wowRn - b.wowRn).slice(0, 5);
      autoDrop = true;
    }
    const autoTag = (on, txt) => (on ? `<span class="tag auto">자동 산출 · ${txt}</span>` : '');
    const regionTable = table({
      columns: [
        { label: '#', r: true, cell: (x, i) => i + 1 },
        { label: 'Region', cell: (x) => esc(x.name) },
        { label: 'RN', r: true, cell: (x) => fmtInt(x.rn) },
        { label: 'Revenue', r: true, cell: (x) => fmtMoney(x.rev) },
        { label: 'Margin', r: true, cell: (x) => fmtMoney(x.margin) },
        { label: 'Margin Rate', r: true, cell: (x) => fmtPct(rate(x.margin, x.rev, x.rev - x.margin), 2) },
        { label: 'WoW ΔRN', r: true, cell: (x) => fmtDelta(x.wowRn, 'int') },
        { label: 'WoW ΔRN %', r: true, cell: (x) => (isNum(x.wowRn) && isNum(x.rn) && x.rn - x.wowRn ? fmtPct(x.wowRn / (x.rn - x.wowRn), 2) : '–') },
        { label: 'Remarks', cls: 'remark', cell: (x) => esc(x.remark) },
      ],
      rows: dropRegions,
    });
    $('[data-panel="movers"]').innerHTML = `
      ${(autoRegions || autoDrop || autoNew) ? `<div class="note warn">② 시트가 비어 있는 항목은 ①의 데이터로 자동 산출해 보여줍니다. 원본에 입력하면 입력값이 우선합니다. 주간 데이터가 누적형이라 WoW ΔRN이 양수여도 "증가폭이 가장 작은" 순으로 정렬됩니다.</div>` : ''}
      ${section('신규 예약 호텔', `<div class="card">${table({ columns: hotelCols(autoNew), rows: newHotels })}</div>`, autoTag(autoNew, '전주 Top10에 없던 호텔'))}
      ${section('전주 대비 급감속 호텔', `<div class="card">${table({ columns: hotelCols(autoDrop), rows: dropHotels })}</div>`, autoTag(autoDrop, 'Top10 중 WoW ΔRN 하위'))}
      ${section('전주 대비 급감속 지역', `<div class="card">${regionTable}</div>`, autoTag(autoRegions, '지역 WoW ΔRN 하위 5'))}
    `;
  }

  /* ③ HB / Floating */
  function renderHB(r) {
    const hb = r.hb;
    // 개별 호텔 블록을 합산한 계산 합계 (원본 'Total' 블록 검증·대체용)
    let calcTotal = null;
    if (hb.hotels.length > 1) {
      const keys = ['sell', 'buy', 'margin', 'rn', 'unsold', 'unsoldCost'];
      const metrics = {};
      keys.forEach((k) => {
        if (hb.hotels.some((b) => b.metrics[k])) metrics[k] = MONTHS.map((_, i) => sum(hb.hotels.map((b) => (b.metrics[k] || [])[i])));
      });
      calcTotal = { title: '__calc', name: `개별 호텔 합산 (계산, ${hb.hotels.length}개)`, scope: 'calc', metrics };
    }
    const blocks = [calcTotal, hb.total, ...hb.hotels].filter(Boolean);
    const el = $('[data-panel="hb"]');
    if (!blocks.length) { el.innerHTML = `<div class="card muted">③ 시트에서 HB/Floating 데이터를 찾지 못했습니다.</div>`; return; }
    const tot = (b, k) => sum((b.metrics[k] || []));
    const summaryRows = hb.hotels.map((b) => {
      const sell = tot(b, 'sell'), buy = tot(b, 'buy'), margin = tot(b, 'margin');
      return { b, sell, buy, margin, rn: tot(b, 'rn'), unsold: tot(b, 'unsold'), unsoldCost: tot(b, 'unsoldCost'), rate: rate(margin, sell, buy) };
    });
    const maxRn = Math.max(0, ...summaryRows.map((x) => x.rn));
    const sumTable = table({
      columns: [
        { label: 'Code', cell: (x) => esc(x.b.code || '') },
        { label: 'Hotel', sort: (x) => x.b.name, cell: (x) => `${esc(x.b.name)} ${x.b.type ? `<span class="tag">${esc(x.b.type)}</span>` : ''}` },
        { label: 'RN (연간)', r: true, cls: 'bar-cell', sort: (x) => x.rn, cell: (x) => barCell(x.rn, maxRn, fmtInt(x.rn)) },
        { label: 'Selling', r: true, sort: (x) => x.sell, cell: (x) => fmtMoney(x.sell) },
        { label: 'Buying', r: true, sort: (x) => x.buy, cell: (x) => fmtMoney(x.buy) },
        { label: 'Margin', r: true, sort: (x) => x.margin, cell: (x) => fmtMoney(x.margin) },
        { label: 'Margin Rate', r: true, sort: (x) => x.rate, cell: (x) => fmtPct(x.rate, 2) },
        { label: 'Unsold', r: true, sort: (x) => x.unsold, cell: (x) => (x.b.metrics.unsold ? fmtInt(x.unsold) : '–') },
        { label: 'Unsold Cost', r: true, sort: (x) => x.unsoldCost, cell: (x) => (x.b.metrics.unsoldCost ? fmtMoney(x.unsoldCost) : '–') },
      ],
      rows: summaryRows, sortKey: 2,
    });
    if (!blocks.find((b) => b.title === state.hbHotel)) state.hbHotel = blocks[0].title;
    const sel = blocks.find((b) => b.title === state.hbHotel);
    const m = sel.metrics;
    const monthTable = (b) => {
      const mt = b.metrics;
      const rowsDef = [['Selling Rate', 'sell', 'money'], ['Buying Rate', 'buy', 'money'], ['Margin', 'margin', 'money'], ['Room Nights', 'rn', 'int'], ['Unsold Rooms', 'unsold', 'int'], ['Unsold Buying Rate', 'unsoldCost', 'money']].filter(([, k]) => mt[k] && mt[k].some(isNum));
      const rateRow = MONTHS.map((_, i) => rate(mt.margin && mt.margin[i], mt.sell && mt.sell[i], mt.buy && mt.buy[i]));
      const f = (v, kind) => (kind === 'int' ? fmtInt(v) : fmtMoney(v));
      return `<div class="table-wrap"><table><thead><tr><th>Values</th>${MONTHS.map((x) => `<th class="r">${x}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
        ${rowsDef.map(([lbl, k, kind]) => `<tr><td>${lbl}</td>${mt[k].map((v) => `<td class="r">${f(v, kind)}</td>`).join('')}<td class="r"><b>${f(sum(mt[k]), kind)}</b></td></tr>`).join('')}
        <tr><td>Margin Rate (${basisLabel()})</td>${rateRow.map((v) => `<td class="r">${fmtPct(v)}</td>`).join('')}<td class="r"><b>${fmtPct(rate(sum(mt.margin || []), sum(mt.sell || []), sum(mt.buy || [])))}</b></td></tr>
      </tbody></table></div>`;
    };
    const thisMonth = new Date(r.date).getMonth();
    el.innerHTML = `
      ${section('HB / Floating 호텔 요약 (연간 합계)', `<div class="card">${sumTable}</div>`, `${hb.hotels.length}개 호텔`)}
      ${section('월별 현황', `
        <div class="hotel-pick" role="group" aria-label="호텔 선택">${blocks.map((b) => `<button type="button" data-hb="${esc(b.title)}" aria-pressed="${b.title === state.hbHotel}">${esc(b.scope === 'total' ? '원본 Total 블록 (' + b.title + ')' : b.name)}</button>`).join('')}</div>
        <div class="grid g-2">
          <div class="card"><h3>월별 Room Nights</h3><div class="chart short"><canvas id="c-hb-rn"></canvas></div></div>
          <div class="card"><h3>월별 Margin</h3><div class="chart short"><canvas id="c-hb-margin"></canvas></div></div>
        </div>
        <div class="card" style="margin-top:16px">${monthTable(sel)}</div>`, '현재 보고 월은 진하게, 이후 월(선예약)은 연하게 표시')}
    `;
    $$('[data-hb]', el).forEach((b) => b.addEventListener('click', () => { state.hbHotel = b.dataset.hb; render(); }));
    const colors = MONTHS.map((_, i) => (i > thisMonth ? cssVar('--series-1-soft') : cssVar('--series-1')));
    makeChart($('#c-hb-rn'), {
      type: 'bar',
      data: { labels: MONTHS, datasets: [{ label: 'RN', data: m.rn || [], backgroundColor: colors, ...barStyle }] },
      options: { scales: { y: { ticks: { callback: intTick } }, x: { grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: (c) => ` RN ${fmtInt(c.raw)}` } } } },
    });
    makeChart($('#c-hb-margin'), {
      type: 'bar',
      data: { labels: MONTHS, datasets: [{ label: 'Margin', data: m.margin || [], backgroundColor: colors, ...barStyle }] },
      options: { scales: { y: { ticks: { callback: moneyTick } }, x: { grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` Margin ${fmtMoney(c.raw)} · 마진율 ${fmtPct(rate(c.raw, (m.sell || [])[c.dataIndex], (m.buy || [])[c.dataIndex]))}` } } } },
    });
  }

  /* ④ 시장 / 경쟁사 */
  function renderMarket(r) {
    const mk = table({
      columns: [
        { label: '#', r: true, cell: (x, i) => i + 1 },
        { label: 'Region/City', cell: (x) => esc(x.region) },
        { label: 'Market Notable Issues', cell: (x) => esc(x.issue).replace(/\n/g, '<br>') },
        { label: 'OMH Impact / Implications', cell: (x) => esc(x.impact).replace(/\n/g, '<br>') },
      ],
      rows: r.market,
    });
    const cp = table({
      columns: [
        { label: '#', r: true, cell: (x, i) => i + 1 },
        { label: 'Competitor (Anonymous)', cell: (x) => esc(x.name) },
        { label: 'Description', cell: (x) => esc(x.desc).replace(/\n/g, '<br>') },
        { label: 'OMH Response / Reference', cell: (x) => esc(x.resp).replace(/\n/g, '<br>') },
      ],
      rows: r.competitors,
    });
    $('[data-panel="market"]').innerHTML = `
      <div class="note">SCM은 호텔 현장 관점(수요·OCC·요금·트렌드)을 다룹니다. 채널/거시 이슈는 SnM 담당. 경쟁 OTA 이름은 익명(예: Company E)으로 표기합니다.</div>
      ${section('Market Trends by Region', `<div class="card">${mk}</div>`)}
      ${section('Competitor Notable Issues', `<div class="card">${cp}</div>`)}
    `;
  }

  /* 주차 추이 */
  function renderTrend(r) {
    const list = reportsOf(r.country);
    const el = $('[data-panel="trend"]');
    const latestByCountry = countries().map((c) => { const l = reportsOf(c); return l[l.length - 1]; });
    const kv = (x, k) => (x.kpi[k] ? x.kpi[k].cur : null);
    const countryTable = table({
      columns: [
        { label: 'Country', sort: (x) => x.country, cell: (x) => esc(x.country) },
        { label: '최근 주차', cell: (x) => esc(x.weekLabel || x.date) },
        { label: 'RN', r: true, sort: (x) => kv(x, 'rn'), cell: (x) => fmtInt(kv(x, 'rn')) },
        { label: 'WoW ΔRN', r: true, cell: (x) => fmtDelta(isNum(kv(x, 'rn')) && x.kpi.rn && isNum(x.kpi.rn.prev) ? kv(x, 'rn') - x.kpi.rn.prev : null, 'int') },
        { label: 'Revenue', r: true, cell: (x) => `${fmtMoney(kv(x, 'rev'))} <span class="muted small">${currencyOf(x.country)}</span>` },
        { label: 'Margin', r: true, cell: (x) => `${fmtMoney(kv(x, 'margin'))} <span class="muted small">${currencyOf(x.country)}</span>` },
        { label: 'Margin Rate', r: true, sort: (x) => rate(kv(x, 'margin'), kv(x, 'rev'), kv(x, 'cost')), cell: (x) => fmtPct(rate(kv(x, 'margin'), kv(x, 'rev'), kv(x, 'cost')), 2) },
        { label: '저장 주차 수', r: true, cell: (x) => reportsOf(x.country).length },
      ],
      rows: latestByCountry,
    });
    const weekTable = table({
      columns: [
        { label: '주차', cell: (x) => esc(x.weekLabel || x.date) },
        { label: '기준일', cell: (x) => esc(x.date) },
        { label: 'RN', r: true, cell: (x) => fmtInt(kv(x, 'rn')) },
        { label: 'Revenue', r: true, cell: (x) => fmtMoney(kv(x, 'rev')) },
        { label: 'Margin', r: true, cell: (x) => fmtMoney(kv(x, 'margin')) },
        { label: 'Margin Rate', r: true, cell: (x) => fmtPct(rate(kv(x, 'margin'), kv(x, 'rev'), kv(x, 'cost')), 2) },
        { label: '파일', cls: 'remark', cell: (x) => esc(x.fileName) },
      ],
      rows: list.slice().reverse(),
    });
    // 저장된 주차가 1개뿐이면 엑셀의 '전주' 값으로 2점 추이를 보여준다
    let pts = list.map((x) => ({ label: x.weekLabel || x.date, rn: kv(x, 'rn'), margin: kv(x, 'margin'), rate: rate(kv(x, 'margin'), kv(x, 'rev'), kv(x, 'cost')) }));
    let note = '';
    if (list.length === 1 && r.kpi.rn && isNum(r.kpi.rn.prev)) {
      const p = (k) => (r.kpi[k] ? r.kpi[k].prev : null);
      pts = [{ label: 'Previous Week', rn: p('rn'), margin: p('margin'), rate: rate(p('margin'), p('rev'), p('cost')) }, ...pts];
      note = '<div class="note">아직 이 국가는 1개 주차만 저장되어 있어, 엑셀의 Previous Week 값을 함께 표시합니다. 매주 파일을 올리면 추이가 쌓입니다.</div>';
    }
    el.innerHTML = `
      ${note}
      ${section(`${r.country} 주차별 추이`, `
        <div class="grid g-3">
          <div class="card"><h3>Total RN</h3><div class="chart short"><canvas id="c-tr-rn"></canvas></div></div>
          <div class="card"><h3>Margin</h3><div class="chart short"><canvas id="c-tr-margin"></canvas></div></div>
          <div class="card"><h3>Margin Rate (${basisLabel()})</h3><div class="chart short"><canvas id="c-tr-rate"></canvas></div></div>
        </div>
        <div class="card" style="margin-top:16px">${weekTable}</div>`)}
      ${section('국가별 최신 주차 요약', `<div class="card">${countryTable}</div>`, '통화가 국가마다 달라 금액은 국가 간 직접 비교하지 않습니다')}
    `;
    const line = (id, key, tick, fmt) => makeChart($(id), {
      type: 'line',
      data: { labels: pts.map((p) => p.label), datasets: [{ data: pts.map((p) => p[key]), borderColor: cssVar('--series-1'), backgroundColor: cssVar('--series-1'), borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0 }] },
      options: { interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: tick } }, x: { grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: (c) => ' ' + fmt(c.raw) } } } },
    });
    line('#c-tr-rn', 'rn', intTick, fmtInt);
    line('#c-tr-margin', 'margin', moneyTick, fmtMoney);
    line('#c-tr-rate', 'rate', (v) => (v * 100).toFixed(2) + '%', (v) => fmtPct(v, 2));
  }

  /* 데이터 점검 — 엑셀 원본의 계산 오류·누락을 잡아낸다 */
  function runChecks(r) {
    const out = [];
    const k = r.kpi;
    const add = (level, title, body) => out.push({ level, title, body });

    // 1) 지역 합계 vs 총 RN
    const regRn = sum(r.regions.map((x) => x.rn));
    if (k.rn && isNum(k.rn.cur) && r.regions.length) {
      const diff = regRn - k.rn.cur;
      if (diff === 0) add('ok', '지역별 RN 합계 = 총 RN', `${fmtInt(regRn)} RN 으로 일치합니다.`);
      else add('bad', '지역별 RN 합계가 총 RN과 다릅니다', `지역 합계 ${fmtInt(regRn)} vs 총 RN ${fmtInt(k.rn.cur)} (차이 ${sign(diff)}${fmtInt(Math.abs(diff))}).`);
    }
    // 2) 지역 WoW 합계 vs 총 WoW
    if (k.rn && isNum(k.rn.cur) && isNum(k.rn.prev) && r.regions.some((x) => isNum(x.wowRn))) {
      const w = sum(r.regions.map((x) => x.wowRn)), tw = k.rn.cur - k.rn.prev;
      if (w === tw) add('ok', '지역별 WoW ΔRN 합계 = 총 WoW', `${sign(w)}${fmtInt(Math.abs(w))} RN 으로 일치합니다.`);
      else add('warn', '지역별 WoW ΔRN 합계가 총 WoW와 다릅니다', `지역 합계 ${sign(w)}${fmtInt(Math.abs(w))} vs 총 WoW ${sign(tw)}${fmtInt(Math.abs(tw))}.`);
    }
    // 3) Margin = Selling − Buying
    ['cur', 'prev', 'mavg'].forEach((f) => {
      if (k.rev && k.cost && k.margin && isNum(k.rev[f]) && isNum(k.cost[f]) && isNum(k.margin[f])) {
        const d = k.rev[f] - k.cost[f] - k.margin[f];
        if (Math.abs(d) > Math.max(1, Math.abs(k.margin[f]) * 1e-6)) add('bad', `Margin ≠ Selling − Buying (${{ cur: 'This Week', prev: 'Previous Week', mavg: 'Prior Month Avg' }[f]})`, `차이 ${fmtMoney(d)}.`);
      }
    });
    // 4) 마진율 기준 혼용
    if (k.margin && k.cost && k.rev) {
      add('info', '마진율 계산 기준이 시트 안에서 섞여 있습니다',
        `원본 엑셀은 총 실적 Margin Rate를 <b>Margin ÷ Buying(원가 대비)</b>, 지역·호텔은 <b>Margin ÷ Revenue(매출 대비)</b>로 계산합니다. 이번 주 기준 원가 대비 ${fmtPct(k.margin.cur / k.cost.cur, 2)} / 매출 대비 ${fmtPct(k.margin.cur / k.rev.cur, 2)}. 대시보드는 상단 '마진율 기준' 하나로 통일해 보여줍니다.`);
    }
    // 5) HB 소진율 — 시트 값이 하드코딩/불일치하는지
    const u = hbUtil(r);
    if (u.sheet != null && u.calc != null) {
      if (Math.abs(u.sheet - u.calc) > 0.0005) add('bad', 'HB 소진율(Hard Block Utilization)이 표의 값과 맞지 않습니다', `시트 값 ${fmtPct(u.sheet, 2)} vs (총 RN − 미판매 RN) ÷ 총 RN = ${fmtPct(u.calc, 2)}. 원본 셀 수식이 다른 숫자로 하드코딩되어 있을 가능성이 큽니다. 대시보드는 계산값을 표시합니다.`);
      else add('ok', 'HB 소진율 일치', `${fmtPct(u.calc, 2)}`);
    } else if (u.calc != null && u.sheet == null) add('warn', 'HB 소진율이 비어 있습니다', `계산값 ${fmtPct(u.calc, 2)}을 표시합니다.`);
    // 6) YoY 미입력
    if (k.rn && !isNum(k.rn.ly)) add('warn', '전년 동기(Prior Year Same Period)가 비어 있습니다', 'YoY 비교가 "–"로 표시됩니다.');
    // 7) ② 시트 미입력
    const emp = [['신규 예약 호텔', r.newHotels], ['급감속 호텔', r.dropHotels], ['급감속 지역', r.dropRegions]].filter(([, l]) => !l.length).map(([n]) => n);
    if (emp.length) add('warn', `② 시트 미입력: ${emp.join(', ')}`, '대시보드에서는 ①의 데이터로 자동 산출한 참고 목록을 보여줍니다.');
    // 8) HB 전체 합계가 특정 호텔 한 곳과 똑같은지 (복사 오류)
    if (r.hb.total && r.hb.hotels.length) {
      const key = (b) => JSON.stringify([b.metrics.sell, b.metrics.rn]);
      const same = r.hb.hotels.find((b) => key(b) === key(r.hb.total));
      const sumRn = sum(r.hb.hotels.map((b) => sum(b.metrics.rn || [])));
      const totRn = sum(r.hb.total.metrics.rn || []);
      if (same) add('bad', 'HB 전체 합계가 호텔 1곳의 값과 동일합니다', `"${esc(r.hb.total.title)}" 블록이 [${esc(same.code || '')}] ${esc(same.name)} 와 숫자가 같습니다. 전체 합계(${fmtInt(totRn)} RN)가 개별 호텔 합계(${fmtInt(sumRn)} RN)와 다르니 복사 누락인지 확인해 주세요.`);
    }
    // 9) Top10 호텔 지역명이 지역 표에 있는지
    const regionNames = new Set(r.regions.map((x) => x.name));
    const unknown = Array.from(new Set(r.topHotels.map((h) => h.region).filter((x) => x && !regionNames.has(x))));
    if (unknown.length && regionNames.size) add('warn', 'Top10 호텔의 지역명이 지역 표에 없습니다', esc(unknown.join(', ')));
    // 10) 작성자
    if (!r.preparedBy) add('info', '작성자(Prepared by)가 비어 있습니다', '');
    return out;
  }
  function renderChecks(r) {
    const list = runChecks(r);
    const order = { bad: 0, warn: 1, info: 2, ok: 3 };
    list.sort((a, b) => order[a.level] - order[b.level]);
    const bad = list.filter((x) => x.level === 'bad').length;
    const badge = $('#check-badge');
    badge.hidden = !bad; badge.textContent = bad;
    const ico = { ok: '✓', warn: '!', bad: '✕', info: 'i' };
    $('[data-panel="checks"]').innerHTML = section('업로드한 엑셀 자동 점검', `<div class="card">${list.map((c) => `<div class="check ${c.level}"><span class="ico" aria-label="${c.level}">${ico[c.level]}</span><div><b>${c.title}</b>${c.body ? `<p>${c.body}</p>` : ''}</div></div>`).join('')}</div>`);
  }

  /* ---------- 업로드 ---------- */
  async function handleFiles(files) {
    let ok = 0, last = null;
    for (const f of files) {
      try {
        if (/\.json$/i.test(f.name)) {
          const d = JSON.parse(await f.text());
          const arr = d.reports ? Object.values(d.reports) : Array.isArray(d) ? d : [];
          arr.forEach((x) => { if (x && x.id) { state.reports[x.id] = x; ok++; last = x; } });
          continue;
        }
        const rep = WeeklyParser.parseWorkbook(new Uint8Array(await f.arrayBuffer()), f.name);
        state.reports[rep.id] = rep;
        last = rep; ok++;
      } catch (e) {
        console.error(e);
        toast(`${f.name}: ${e.message || '읽기 실패'}`);
      }
    }
    if (last) {
      state.country = last.country; state.id = last.id;
      save(); render();
      toast(`${ok}개 파일 반영 완료 — ${last.country} ${last.weekLabel || last.date}`);
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), reports: state.reports }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reports.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- 이벤트 ---------- */
  function bind() {
    const fi = $('#file-input');
    $('#btn-upload').addEventListener('click', () => fi.click());
    $('#btn-upload-2').addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { handleFiles(Array.from(fi.files)); fi.value = ''; });
    $('#sel-country').addEventListener('change', (e) => { state.country = e.target.value; state.id = null; save(); render(); });
    $('#sel-week').addEventListener('change', (e) => { state.id = e.target.value; save(); render(); });
    $('#sel-basis').addEventListener('change', (e) => { state.basis = e.target.value; save(); render(); });
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      state.tab = b.dataset.tab;
      $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== state.tab));
      $$('#tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      state.charts.forEach((c) => c.resize());
    });
    const closeMenu = () => $('.menu').removeAttribute('open');
    $('#btn-export').addEventListener('click', () => { closeMenu(); exportJson(); });
    $('#btn-print').addEventListener('click', () => { closeMenu(); window.print(); });
    $('#btn-delete').addEventListener('click', () => {
      closeMenu();
      const r = current();
      if (r && confirm(`${r.country} ${r.weekLabel || r.date} 데이터를 삭제할까요?`)) { delete state.reports[r.id]; state.id = null; save(); render(); }
    });
    $('#btn-reset').addEventListener('click', () => {
      closeMenu();
      if (confirm('이 브라우저에 저장된 모든 주간 데이터를 삭제할까요?')) { state.reports = {}; state.id = null; save(); render(); }
    });
    // 드래그 앤 드롭
    let depth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('#drop-hint').hidden = false; });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#drop-hint').hidden = true; });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); depth = 0; $('#drop-hint').hidden = true;
      if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files));
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
    window.addEventListener('beforeprint', () => { $$('.panel').forEach((p) => (p.hidden = false)); state.charts.forEach((c) => c.resize()); });
    window.addEventListener('afterprint', () => { $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== state.tab)); });
  }

  async function init() {
    load();
    bind();
    const n = await loadShared();
    if (n) save();
    render();
  }
  init();
})();
