// node recap_month.js <rows> <CC> <D> [prevD]  — 보고 당월 체크아웃 기준 리캡 숫자 (prevD 생략 시 D-7)
const fs=require('fs'),S=require('./engine.js');
const [f,cc,D,PD]=process.argv.slice(2);
const all=JSON.parse(fs.readFileSync(f)).map(S.slimRow);
const m=D.slice(0,7), P=PD||S.addDays(D,-7); // PD: 전주 보고 기준일(선택)
// 금액은 engine과 같은 환율 규칙을 쓰기 위해 당월 체크아웃 행만 넣어 compute (환율표는 전체 행 기준이 정확하므로 rate만 따로 뽑음)
const rows=all.filter(r=>(r.checkOutDate||'').slice(0,7)===m);
const full=(d)=>S.compute(all,{country:cc,date:d,cfg:{}});
const cur=full(D), prev=full(P);
const k=(x)=>x.kpi.monthCur;
const c=k(cur), p=k(prev);
const rate=(x)=>x.margin/(x.sell-x.margin)*100;
// 호텔별 당월 RN at D / D-7
const by={};
for(const r of rows){const h=by[r.hotelCode]||(by[r.hotelCode]={name:(r.hotelName||'').trim(),city:r.hotelCity,cur:0,prev:0,everPrev:0});
  if(S.aliveAt(r,D)) h.cur+=+r.roomNights||0; if(S.aliveAt(r,P)) h.prev+=+r.roomNights||0;}
const hs=Object.values(by);
const pickup=hs.map(h=>[h.name,h.cur-h.prev,h.cur,h.city]).sort((a,b)=>b[1]-a[1]).slice(0,5);
const newly=hs.filter(h=>h.prev===0&&h.cur>0).sort((a,b)=>b.cur-a.cur).map(h=>[h.name,h.cur,h.city]);
// 월별 RN (기록 비교용): 각 달 체크아웃 RN at D (지난달은 실적)
const months={};for(const r of all){const mm=(r.checkOutDate||'').slice(0,7);if(S.aliveAt(r,D))months[mm]=(months[mm]||0)+(+r.roomNights||0);}
console.log(JSON.stringify({cc,month:m,cur:{rn:c.rn,margin:c.margin,sell:c.sell,rate:+rate(c).toFixed(2)},prev:{rn:p.rn,margin:p.margin,sell:p.sell,rate:+rate(p).toFixed(2)},
 currency:cur.currency,pickup,newly,months},null,1));
