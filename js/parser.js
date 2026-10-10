/* OMH SCM Weekly Report 엑셀 파서
 * 양식(OMH_SCM_Weekly_Report_EN)의 4개 시트를 셀 위치가 아닌 '제목/헤더 텍스트'로 찾아 읽는다.
 * 행·열이 조금 밀려도 동작하도록 고정 좌표를 쓰지 않는다.
 */
(function (global) {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
  const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
  const num = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const n = Number(String(v).replace(/[,%\s]/g, ''));
    return isFinite(n) ? n : null;
  };
  const str = (v) => (isBlank(v) ? '' : String(v).trim());

  function sheetRows(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  }

  // 조건에 맞는 첫 행 인덱스
  function findRow(rows, pred, from = 0, to = rows.length) {
    for (let r = from; r < Math.min(to, rows.length); r++) if (pred(rows[r] || [], r)) return r;
    return -1;
  }
  const rowHas = (row, text) => row.some((c) => norm(c).includes(text));
  const rowHasAll = (row, texts) => texts.every((t) => rowHas(row, t));

  // 헤더 행 → { 정규화된 헤더: 열 인덱스 }
  function headerMap(row) {
    const m = {};
    row.forEach((c, i) => {
      if (!isBlank(c)) m[c instanceof Date ? '__date' : norm(c)] = i;
    });
    return m;
  }
  function col(map, ...keys) {
    for (const k of keys) {
      const nk = norm(k);
      if (map[nk] != null) return map[nk];
      const hit = Object.keys(map).find((h) => h.startsWith(nk));
      if (hit) return map[hit];
    }
    return -1;
  }
  const cell = (row, c) => (c < 0 || !row ? null : row[c]);

  function pickSheet(wb, matchers, fallbackIdx) {
    for (const name of wb.SheetNames) {
      const n = norm(name);
      if (matchers.some((m) => n.includes(m))) return wb.Sheets[name];
    }
    const name = wb.SheetNames[fallbackIdx];
    return name ? wb.Sheets[name] : null;
  }

  /* ---------- ① 주간 내역 ---------- */
  function parseSummary(rows, out) {
    // 메타: Country / 기간 / 작성자
    for (let r = 0; r < Math.min(6, rows.length); r++) {
      const row = rows[r] || [];
      row.forEach((c, i) => {
        const s = str(c);
        if (/^country\s*:/i.test(s)) out.country = s.replace(/^country\s*:/i, '').trim();
        else if (/^prepared by\s*:/i.test(s)) {
          const inline = s.replace(/^prepared by\s*:/i, '').trim();
          out.preparedBy = inline || str(row.slice(i + 1).find((x) => !isBlank(x)));
        } else if (!out.weekLabel && /\d{4}/.test(s) && i > 0 && !/country/i.test(s)) out.weekLabel = s;
      });
    }

    // 주간 총 실적 표
    const hk = findRow(rows, (row) => rowHasAll(row, ['metric', 'this week', 'previous week']));
    if (hk >= 0) {
      const h = headerMap(rows[hk]);
      const cM = col(h, 'metric');
      const cCur = col(h, 'this week'), cPrev = col(h, 'previous week');
      const cMavg = col(h, 'prior month'), cLy = col(h, 'prior year');
      const cRem = col(h, 'remarks');
      const keyOf = (label) => {
        const l = norm(label);
        if (l.startsWith('total rn') || l.startsWith('rn')) return 'rn';
        if (l.startsWith('selling')) return 'rev';
        if (l.startsWith('buying')) return 'cost';
        if (l.startsWith('margin rate')) return 'rate';
        if (l.startsWith('margin')) return 'margin';
        return null;
      };
      for (let r = hk + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const label = cell(row, cM);
        if (isBlank(label)) break;
        const k = keyOf(label);
        if (!k) continue;
        out.kpi[k] = {
          label: str(label),
          cur: num(cell(row, cCur)), prev: num(cell(row, cPrev)),
          mavg: num(cell(row, cMavg)), ly: num(cell(row, cLy)),
          remark: str(cell(row, cRem)),
        };
      }
    }
    const ccy = rows.flat().find((c) => /currency\s*:/i.test(str(c)));
    if (ccy) out.currencyNote = str(ccy);

    // 지역별 실적
    const hr = findRow(rows, (row) => rowHas(row, 'region/city') && rowHas(row, 'rn'));
    if (hr >= 0) {
      const h = headerMap(rows[hr]);
      const c = {
        name: col(h, 'region/city'), rn: col(h, 'rn (nights)', 'rn'), rev: col(h, 'revenue'),
        margin: col(h, 'margin'), wowRn: col(h, 'wow δrn', 'wow drn'), wowMargin: col(h, 'wow δmargin', 'wow dmargin'),
        momRn: col(h, 'mom δrn', 'mom drn'), remark: col(h, 'remarks'), base: h.__date != null ? h.__date : -1,
      };
      const baseDate = c.base >= 0 ? rows[hr][c.base] : null;
      if (baseDate instanceof Date) out.momBaseDate = isoDate(baseDate);
      for (let r = hr + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const name = str(cell(row, c.name));
        if (/^total$/i.test(name)) break;
        if (!name) {
          if (rows.slice(r, r + 4).every((x) => !x || x.every(isBlank))) break;
          continue;
        }
        const rn = num(cell(row, c.rn));
        const base = num(cell(row, c.base));
        out.regions.push({
          name, rn, rev: num(cell(row, c.rev)), margin: num(cell(row, c.margin)),
          wowRn: num(cell(row, c.wowRn)), wowMargin: num(cell(row, c.wowMargin)),
          momRn: num(cell(row, c.momRn)) ?? (rn != null && base != null ? rn - base : null),
          momBaseRn: base, remark: str(cell(row, c.remark)),
        });
      }
    }

    // Top 10 호텔
    const hh = findRow(rows, (row) => rowHas(row, 'hotel name'));
    if (hh >= 0) out.topHotels = readHotelTable(rows, hh);

    // 독점 / 하드블록
    const ht = findRow(rows, (row) => rowHas(row, 'exclusive') && rowHas(row, 'hard block'));
    const he = findRow(rows, (row) => rowHasAll(row, ['metric', 'this week']), ht >= 0 ? ht : hk + 1);
    if (he >= 0 && he !== hk) {
      const h = headerMap(rows[he]);
      const cM = col(h, 'metric'), cCur = col(h, 'this week'), cPrev = col(h, 'previous week'), cRem = col(h, 'remarks');
      const keyOf = (label) => {
        const l = norm(label);
        if (l.includes('number of exclusive')) return 'exclHotels';
        if (l.includes('exclusive rn share')) return 'exclRnShare';
        if (l.includes('exclusive margin contribution')) return 'exclMarginShare';
        if (l.includes('exclusive avg margin')) return 'exclMarginRate';
        if (l.includes('hard block total')) return 'hbTotalRn';
        if (l.includes('hard block unsold')) return 'hbUnsoldRn';
        if (l.includes('utilization')) return 'hbUtil';
        return null;
      };
      for (let r = he + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const label = cell(row, cM);
        if (isBlank(label)) break;
        const k = keyOf(label);
        if (k) out.exclusive[k] = { label: str(label), cur: num(cell(row, cCur)), prev: num(cell(row, cPrev)), remark: str(cell(row, cRem)) };
      }
    }
  }

  function readHotelTable(rows, hr) {
    const h = headerMap(rows[hr]);
    const c = {
      name: col(h, 'hotel name'), region: col(h, 'region'), rn: col(h, 'rn'), rev: col(h, 'revenue'),
      margin: col(h, 'margin'), wowRn: col(h, 'wow δrn', 'wow drn'), contract: col(h, 'contract type'), remark: col(h, 'remarks'),
    };
    const list = [];
    for (let r = hr + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const first = row.find((x) => !isBlank(x));
      // 다음 표 제목(숫자가 아닌 텍스트만 있는 행)이 나오면 종료
      if (first != null && typeof first === 'string' && isBlank(cell(row, c.name)) && !/^\d+$/.test(first)) break;
      const name = str(cell(row, c.name));
      if (!name) {
        if (rows.slice(r, r + 3).every((x) => !x || x.every(isBlank))) break;
        continue;
      }
      list.push({
        name, region: str(cell(row, c.region)), rn: num(cell(row, c.rn)), rev: num(cell(row, c.rev)),
        margin: num(cell(row, c.margin)), wowRn: num(cell(row, c.wowRn)),
        contract: str(cell(row, c.contract)), remark: str(cell(row, c.remark)),
      });
    }
    return list;
  }

  /* ---------- ② 신규 / 급감속 ---------- */
  function parseMovers(rows, out) {
    const sections = [
      { key: 'newHotels', match: (t) => t.includes('신규') || t.includes('new') },
      { key: 'dropHotels', match: (t) => (t.includes('급감속') || t.includes('decline')) && (t.includes('호텔') || t.includes('hotel')) },
      { key: 'dropRegions', match: (t) => (t.includes('급감속') || t.includes('decline')) && (t.includes('지역') || t.includes('region')) },
    ];
    rows.forEach((row, r) => {
      const t = norm(row && row[0]);
      if (!t || /^\d+$/.test(t)) return;
      const sec = sections.find((s) => s.match(t));
      if (!sec) return;
      const hr = findRow(rows, (x) => rowHas(x, '#'), r + 1, r + 3);
      if (hr < 0) return;
      if (sec.key === 'dropRegions') {
        const h = headerMap(rows[hr]);
        const c = { name: col(h, 'region'), rn: col(h, 'rn'), rev: col(h, 'revenue'), margin: col(h, 'margin'), wowRn: col(h, 'wow δrn', 'wow drn'), remark: col(h, 'remarks') };
        for (let i = hr + 1; i < rows.length; i++) {
          const x = rows[i] || [];
          if (x.every(isBlank)) break;
          const name = str(cell(x, c.name));
          if (name) out.dropRegions.push({ name, rn: num(cell(x, c.rn)), rev: num(cell(x, c.rev)), margin: num(cell(x, c.margin)), wowRn: num(cell(x, c.wowRn)), remark: str(cell(x, c.remark)) });
        }
      } else {
        out[sec.key] = readHotelTable(rows, hr);
      }
    });
  }

  /* ---------- ③ HB / Floating ---------- */
  function parseHB(rows, out) {
    const metricKey = (label) => {
      const l = norm(label);
      if (l.startsWith('selling')) return 'sell';
      if (l.startsWith('buying')) return 'buy';
      if (l.startsWith('margin rate')) return 'rate';
      if (l.startsWith('margin')) return 'margin';
      if (l.startsWith('room nights')) return 'rn';
      if (l.startsWith('unsold buying')) return 'unsoldCost';
      if (l.startsWith('unsold')) return 'unsold';
      if (l.startsWith('share of total / margin')) return 'shareMargin';
      if (l.startsWith('share of total / room')) return 'shareRn';
      return null;
    };
    rows.forEach((row, r) => {
      if (!row || norm(row[0]) !== 'values' || norm(row[1]) !== 'jan') return;
      const monthCols = MONTHS.map((m) => row.findIndex((c) => norm(c) === m.toLowerCase()));
      // 블록 제목: 위로 올라가며 텍스트 셀 탐색 (연도 숫자는 건너뜀)
      let title = '', year = null, scope = 'hotel';
      for (let u = r - 1; u >= Math.max(0, r - 6); u--) {
        const v = rows[u] && rows[u][0];
        if (isBlank(v)) continue;
        if (typeof v === 'number' && v > 1900 && v < 2100) { year = year || v; continue; }
        const s = str(v);
        if (/^▌/.test(s)) break;
        if (/total$/i.test(s) && !title) { year = year || num(s.match(/\d{4}/)?.[0]); title = s; scope = 'total'; continue; }
        if (!title) title = s;
        break;
      }
      if (!title) return;
      const block = { title, year, scope, metrics: {} };
      const m = title.match(/^\[?(\d{4,})\]?\s*[-–]?\s*(.*)$/);
      if (m) { block.code = m[1]; block.name = m[2].trim(); }
      else block.name = title;
      const tm = block.name.match(/\(([^)]+)\)\s*$/);
      if (tm) { block.type = tm[1]; block.name = block.name.replace(/\s*\([^)]+\)\s*$/, ''); }
      for (let i = r + 1; i < rows.length; i++) {
        const x = rows[i] || [];
        const label = x[0];
        if (isBlank(label)) {
          if (rows.slice(i, i + 2).every((y) => !y || isBlank(y[0]))) break;
          continue;
        }
        const k = metricKey(label);
        if (!k) break;
        block.metrics[k] = monthCols.map((c) => num(cell(x, c)));
      }
      const mt = block.metrics;
      // 마진/마진율이 비어 있으면 계산으로 채움
      if (mt.sell && mt.buy) {
        if (!mt.margin || mt.margin.every((v) => v == null)) mt.margin = mt.sell.map((s, i) => (s != null && mt.buy[i] != null ? s - mt.buy[i] : null));
      }
      if (scope === 'total' && !out.hb.total) out.hb.total = block;
      else if (Object.keys(mt).length) out.hb.hotels.push(block);
    });
  }

  /* ---------- ④ 시장 / 경쟁사 ---------- */
  function parseMarket(rows, out) {
    const hm = findRow(rows, (row) => rowHas(row, 'region/city') && rowHas(row, 'market'));
    if (hm >= 0) {
      for (let r = hm + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const a = str(row[0]);
        if (a.startsWith('※') || a.startsWith('▌')) break;
        const region = str(row[1]), issue = str(row[2]), impact = str(row[3]);
        if (region || issue || impact) out.market.push({ region, issue, impact });
      }
    }
    const hc = findRow(rows, (row) => rowHas(row, 'competitor') && rowHas(row, 'description'));
    if (hc >= 0) {
      for (let r = hc + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const a = str(row[0]);
        if (a.startsWith('※') || a.startsWith('▌')) break;
        const name = str(row[1]), desc = str(row[2]), resp = str(row[3]);
        if (name || desc || resp) out.competitors.push({ name, desc, resp });
      }
    }
  }

  function isoDate(d) {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  // "2026.24 - 25-Sep" / 파일명 "..._0925" 등에서 정렬용 날짜 추정
  function guessDate(weekLabel, fileName) {
    const y = (String(weekLabel).match(/(20\d{2})/) || [])[1] || new Date().getFullYear();
    const mi = String(weekLabel).match(/(\d{1,2})[-\s]?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    if (mi) {
      const mo = MONTHS.findIndex((m) => m.toLowerCase() === mi[2].toLowerCase());
      return isoDate(new Date(+y, mo, +mi[1]));
    }
    const fm = String(fileName || '').match(/[-_](\d{2})(\d{2})(?:[_\-.]|$)/);
    if (fm && +fm[1] >= 1 && +fm[1] <= 12) return isoDate(new Date(+y, +fm[1] - 1, +fm[2]));
    return isoDate(new Date());
  }

  function parseWorkbook(data, fileName) {
    const wb = XLSX.read(data, { type: 'array', cellDates: true });
    const out = {
      fileName: fileName || '', importedAt: new Date().toISOString(),
      country: '', weekLabel: '', preparedBy: '', currencyNote: '', momBaseDate: null,
      kpi: {}, regions: [], topHotels: [], exclusive: {},
      newHotels: [], dropHotels: [], dropRegions: [],
      hb: { total: null, hotels: [] }, market: [], competitors: [],
      raw: {},
    };
    const s1 = pickSheet(wb, ['주간 내역', 'weekly'], 0);
    const s2 = pickSheet(wb, ['신규', 'new'], 1);
    const s3 = pickSheet(wb, ['hb', 'floating', 'hard block'], 2);
    const s4 = pickSheet(wb, ['market', 'competitor', '시장'], 3);
    if (s1) parseSummary(sheetRows(s1), out);
    if (s2) parseMovers(sheetRows(s2), out);
    if (s3) parseHB(sheetRows(s3), out);
    if (s4) parseMarket(sheetRows(s4), out);

    if (!out.country) out.country = 'Unknown';
    out.date = guessDate(out.weekLabel, fileName);
    out.id = `${out.country}|${out.date}`;
    if (!out.kpi.rn && !out.regions.length) throw new Error('주간 내역 시트(Weekly Total Performance)를 찾지 못했습니다. 양식이 맞는지 확인해 주세요.');
    return out;
  }

  global.WeeklyParser = { parseWorkbook, MONTHS };
})(window);
