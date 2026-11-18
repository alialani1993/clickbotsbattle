// CPU-vs-CPU balance simulator. Run: node tools/balance-sim.js [blitz|standard|marathon]
const { GameServer } = require('../js/server.js');
const { CpuBot } = require('../js/ai.js');
const MODE = process.argv[2] || 'standard';
const N = 200;
function run(d1, d2) {
  const s = new GameServer({ mode: MODE }); s.allowClick = () => true; s.start();
  const b1 = new CpuBot('p1', d1, m => s.rpc('p1', m));
  const b2 = new CpuBot('p2', d2, m => s.rpc('p2', m));
  let snap = s.snapshot(), t = 0;
  while (s.phase !== 'over' && t < 1000) {
    s.tick(0.05); t += 0.05; snap = s.snapshot();
    b1.update(snap, 0.05); b2.update(snap, 0.05);
  }
  return { winner: s.winner, reason: s.reason, time: s.elapsed, cps: snap.players.p1.stats.avgCps };
}
console.log(`mode: ${MODE} (${new GameServer({ mode: MODE }).matchSeconds}s), ${N} matches per pairing`);
for (const [a, b] of [['normal', 'normal'], ['hard', 'normal'], ['easy', 'normal'], ['hard', 'hard']]) {
  const R = []; for (let i = 0; i < N; i++) R.push(run(a, b));
  const w1 = R.filter(r => r.winner === 'p1').length, w2 = R.filter(r => r.winner === 'p2').length;
  const ko = R.filter(r => r.reason === 'Bot destroyed').length;
  const avgT = R.reduce((x, r) => x + r.time, 0) / N;
  console.log(`${a} vs ${b}: p1 ${w1}  p2 ${w2}  draw ${N - w1 - w2} | KO ${ko}/${N} | avg length ${avgT.toFixed(0)}s | p1 avg CPS ${(R.reduce((x, r) => x + r.cps, 0) / N).toFixed(1)}`);
}
