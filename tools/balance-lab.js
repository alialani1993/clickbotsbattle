// Balance experiments without editing config.js. Example:
//   node tools/balance-lab.js '{"modes":["standard"],"pace":{"standard":2},"power":0.47}' 200
// Keys: hp, modes, growth{tier}, base{tier}, power (number or {tier}), pace{mode} (price multiplier),
//       mod{upgradeId:{stat:value}}, ramp{start,max}. Prints KO %, avg length, Hard-vs-Normal win %, first-buy time.
// Balance harness: node run.js '<json overrides>' [N]
// overrides: { hp, growth:{bronze,silver,gold}, base:{...}, power:{bronze,silver,gold} | number,
//              pace:{blitz,standard,marathon} (price multiplier per mode), ramp:{start,max} (damage escalation) }
const path = require('path').join(__dirname, '../js/');
const { CONFIG, UPGRADES } = require(path + 'config.js');
const { GameServer } = require(path + 'server.js');
const { CpuBot } = require(path + 'ai.js');
const o = JSON.parse(process.argv[2] || '{}'); const N = +process.argv[3] || 150;
const modes = o.modes || ['blitz', 'standard', 'marathon'];
if (o.hp) for (const m of Object.values(CONFIG.MATCH_MODES)) m.startHp = o.hp;
for (const t of ['bronze', 'silver', 'gold']) {
  if (o.growth && o.growth[t] != null) CONFIG.TIERS[t].growth = o.growth[t];
  if (o.base && o.base[t] != null) CONFIG.TIERS[t].baseCost = o.base[t];
}
if (o.power != null) {
  const pw = typeof o.power === 'number' ? { bronze: o.power, silver: o.power, gold: o.power } : o.power;
  for (const u of UPGRADES) if (u.mod && pw[u.tier] != null) for (const k of Object.keys(u.mod)) if (k !== 'crit') u.mod[k] = +(u.mod[k] * pw[u.tier]).toFixed(3);
}
if (o.mod) for (const u of UPGRADES) if (o.mod[u.id]) Object.assign(u.mod, o.mod[u.id]);
const out = {};
for (const mode of modes) {
  const pace = (o.pace && o.pace[mode]) || 1;
  const res = {};
  for (const pair of [['normal', 'normal'], ['hard', 'normal']]) {
    let ko = 0, T = 0, w1 = 0, fb = 0, fbn = 0, buys = 0;
    for (let i = 0; i < N; i++) {
      const s = new GameServer({ mode }); s.allowClick = () => true;
      if (pace !== 1) { const tc = s.tierCost.bind(s); s.tierCost = (pid, t) => Math.round(tc(pid, t) * pace); }
      if (o.ramp) { // damage escalation: after start fraction of match, damage multiplier rises linearly to max
        const dmg = s.damage.bind(s);
        s.damage = (tgt, amt) => { const f = s.elapsed / s.matchSeconds; const m = f <= o.ramp.start ? 1 : 1 + (o.ramp.max - 1) * (f - o.ramp.start) / (1 - o.ramp.start); return dmg(tgt, amt * m); };
      }
      s.start();
      const b1 = new CpuBot('p1', pair[0], m => s.rpc('p1', m)), b2 = new CpuBot('p2', pair[1], m => s.rpc('p2', m));
      let first = null;
      while (s.phase !== 'over') { s.tick(0.05); const sn = s.snapshot(); for (const e of sn.events) if (e.k === 'buy') { buys++; if (first === null) first = s.elapsed; } b1.update(sn, 0.05); b2.update(sn, 0.05); }
      if (first !== null) { fb += first; fbn++; }
      if (s.reason === 'Bot destroyed') ko++; T += s.elapsed; if (s.winner === 'p1') w1++;
    }
    res[pair.join('/')] = { ko: Math.round(ko / N * 100), avg: Math.round(T / N), p1win: Math.round(w1 / N * 100), firstBuy: fbn ? Math.round(fb / fbn) : null, buys: +(buys / N / 2).toFixed(1) };
  }
  out[mode] = res;
}
console.log(JSON.stringify({ o, out }));
