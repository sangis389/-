// node recap.js <vn_rows> <th_rows> <D> <vn_report.json> <th_report.json> <prev_vn_report> <prev_th_report>
const fs = require('fs'); const S = require('./engine.js');
const [vnF, thF, D, vnR, thR, pvF, ptF] = process.argv.slice(2);
const J = (f) => { const x = JSON.parse(fs.readFileSync(f)); return x.data || x; };
const vn = J(vnR), th = J(thR), pv = J(pvF), pt = J(ptF);
const cost = (x) => x.margin / (x.sell - x.margin) * 100;
const sell = (x) => x.margin / x.sell * 100;
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const sg = (v) => (v >= 0 ? '+' : '−') + n0(Math.abs(v));
const mon = +D.slice(5, 7);
function monthRN(f, t) {
  const rows = JSON.parse(fs.readFileSync(f)), m = D.slice(0, 7);
  return rows.filter(r => (r.checkOutDate || '').slice(0, 7) === m && S.aliveAt(r, t)).reduce((a, r) => a + (+r.roomNights || 0), 0);
}
const out = {};
// VN: cumulative, prev = last week's saved report
const vc = vn.kpi.cur, vp = pv.kpi.cur;
out.VN = { rn: vc.rn, rnPrev: vp.rn, margin: vc.margin, marginPrev: vp.margin, rate: cost(vc), ratePrev: cost(vp), rateSell: sell(vc),
  prevRecalc: vn.kpi.prev, newHotels: vn.newHotels.map(h => [h.name.trim(), h.cur.rn]),
  pickup: vn.hotelsTop50.map(h => [h.name.trim(), h.cur.rn - h.prev.rn, h.cur.rn]).sort((a, b) => b[1] - a[1]).slice(0, 5),
  exclusive: vn.exclusive.hotels.map(h => [h.name, h.label, h.cur.rn, h.cur.rn - h.prev.rn]) };
// TH: current-month RN, cumulative margin
const tc = th.kpi.cur, tp = pt.kpi.cur;
out.TH = { monthRN: monthRN(thF, D), monthRNPrev: monthRN(thF, S.addDays(D, -7)), margin: tc.margin, marginPrev: tp.margin, ccy: th.currency,
  rate: cost(tc), ratePrev: cost(tp), rateSell: sell(tc), rateSellPrev: sell(tp), cumRN: tc.rn, cumPrev: tp.rn,
  prevMonth: th.kpi.monthPrev, newHotels: th.newHotels.map(h => [h.name.trim(), h.cur.rn]),
  pickup: th.hotelsTop50.map(h => [h.name.trim(), h.cur.rn - h.prev.rn, h.cur.rn, h.city]).sort((a, b) => b[1] - a[1]).slice(0, 5) };
out.VN.monthRN = monthRN(vnF, D); out.VN.monthRNPrev = monthRN(vnF, S.addDays(D, -7));
console.log(JSON.stringify(out, null, 1));
