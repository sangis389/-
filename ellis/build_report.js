// node build_report.js <rows.json> <CC> <YYYY-MM-DD> <settings.json> <out.json>
const fs = require('fs'); const S = require('./engine.js');
const [rowsF, cc, D, setF, outF] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(rowsF)).map(S.slimRow);
let cfg = {};
try { const s = JSON.parse(fs.readFileSync(setF)); const d = s.data || s; cfg = d[cc] || {}; } catch (e) {}
const r = S.compute(rows, { country: cc, date: D, cfg });
r.secs = 0; r.source = 'Claude 세션에서 ELLIS 조회 후 생성';
fs.writeFileSync(outF, JSON.stringify(r));
console.log(cc, D, r.currency, r.currencyNote || '', 'RN', r.kpi.cur.rn, 'prev', r.kpi.prev.rn, 'sell', r.kpi.cur.sell, 'margin', r.kpi.cur.margin,
  'rate', (r.kpi.cur.margin / r.kpi.cur.sell * 100).toFixed(2) + '%', 'hotels', r.hotelCount, 'regions', r.regions.length, 'skippedFx', r.diag.skippedFx, 'bytes', JSON.stringify(r).length);
console.log('regions', r.regions.map(x => x.name + ':' + x.cur.rn).join(', '));
console.log('top3', r.topHotels.slice(0, 3).map(h => h.name + ':' + h.cur.rn).join(' | '));
console.log('ex', r.exclusive.count, r.exclusive.hotels.map(h => h.code + ':' + h.cur.rn).join(' '));
