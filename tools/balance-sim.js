// CPU-vs-CPU balance simulator. Run: node tools/balance-sim.js
const { GameServer } = require('../js/server.js');
const { CpuBot } = require('../js/ai.js');
function run(d1, d2) {
  const s = new GameServer(); s.allowClick = () => true; s.start();
  const b1 = new CpuBot('p1', d1, m => s.rpc('p1', m));
  const b2 = new CpuBot('p2', d2, m => s.rpc('p2', m));
  let snap = s.snapshot(), t = 0; const buys = {p1:[],p2:[]};
  while (s.phase !== 'over' && t < 200) {
    s.tick(0.05); t += 0.05; snap = s.snapshot();
    for (const e of snap.events) if (e.k==='buy') buys[e.pid].push(e.id);
    b1.update(snap, 0.05); b2.update(snap, 0.05);
  }
  return { winner: s.winner, reason: s.reason, time: (120 - s.timeLeft).toFixed(0), hp: [snap.players.p1.hp, snap.players.p2.hp], buys: [buys.p1.length, buys.p2.length], stats: snap.players.p1.stats };
}
for (const [a,b] of [['normal','normal'],['hard','normal'],['easy','normal'],['hard','hard']]) {
  const R = []; for (let i=0;i<200;i++) R.push(run(a,b));
  const w1 = R.filter(r=>r.winner==='p1').length, w2 = R.filter(r=>r.winner==='p2').length;
  const ko = R.filter(r=>r.reason==='Bot destroyed').length;
  const avgT = R.reduce((x,r)=>x+ +r.time,0)/R.length;
  console.log(`${a} vs ${b}: p1 ${w1} p2 ${w2} draw ${200-w1-w2} | KO ${ko}/200 | avg len ${avgT.toFixed(0)}s | avg buys ${(R.reduce((x,r)=>x+r.buys[0],0)/200).toFixed(1)}`);
}
console.log(run('normal','normal'));
