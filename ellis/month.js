// node month.js <rows> <CC> <D> : 당월 체크아웃 RN·판매가·마진 at D and D-7 (현지통화 or KRW, engine과 같은 환율 규칙)
const fs=require('fs'),S=require('./engine.js');
const [f,cc,D]=process.argv.slice(2);
const rows=JSON.parse(fs.readFileSync(f)).map(S.slimRow);
const m=D.slice(0,7);
const sub=rows.filter(r=>(r.checkOutDate||'').slice(0,7)===m);
// engine.compute gives monthCur at D using its FX rules; run at D and D-7
const a=S.compute(rows,{country:cc,date:D,cfg:{}}).kpi.monthCur;
const b=S.compute(rows,{country:cc,date:S.addDays(D,-7),cfg:{}}).kpi.monthCur;
const r=(x)=>({rn:x.rn,margin:x.margin,sell:x.sell,rateCost:(x.margin/(x.sell-x.margin)*100).toFixed(2)});
console.log(cc,m,JSON.stringify({cur:r(a),prev:r(b)}));
