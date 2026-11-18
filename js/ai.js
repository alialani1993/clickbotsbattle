/* ClickBots PvP — CPU opponent.
 * Plays through the same rpc() interface a human client uses, so it
 * can't cheat: it only sees snapshots and sends inputs. */
(function (root) {
  const { CONFIG, UPGRADE_BY_ID } =
    (typeof module !== 'undefined' && module.exports) ? require('./config.js') : root;

  const DIFFICULTY = {
    easy:   { cps: 4,  buyDelay: 1.6, smart: 0.5 },
    normal: { cps: 6.5, buyDelay: 0.9, smart: 0.8 },
    hard:   { cps: 9,  buyDelay: 0.35, smart: 1.0 },
  };

  // Rough value of each upgrade to the CPU (higher = buy first).
  const VALUE = {
    fists: 3, patchkit: 2, pickaxe: 4, minidrill: 4, plating: 2,
    piston: 6, welder: 4, excavator: 6, turret: 7, drone: 5, rig: 7,
    overdrive: 9, matrix: 7, laser: 10, nanos: 7, shield: 6, overclock: 8,
  };

  class CpuBot {
    constructor(pid, difficulty, send, rng = Math.random) {
      this.pid = pid;
      this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
      this.send = send;
      this.rng = rng;
      this.budget = 0;
      this.buyCooldown = 0;
    }

    update(s, dt) {
      if (s.phase !== 'playing') { this.budget = 0; return; }
      const me = s.players[this.pid];
      const op = s.players[this.pid === 'p1' ? 'p2' : 'p1'];

      this.buyCooldown -= dt;
      if (this.buyCooldown <= 0 && this.tryBuy(s, me, op)) this.buyCooldown = this.d.buyDelay;

      // jittery click rate so it feels human
      this.budget += this.d.cps * dt * (0.7 + this.rng() * 0.6);
      while (this.budget >= 1) {
        this.budget -= 1;
        this.send({ a: this.chooseClick(s, me, op) });
      }
    }

    chooseClick(s, me, op) {
      const elapsed = CONFIG.MATCH_SECONDS - s.timeLeft;
      const myPct = me.hp / me.maxHp, opPct = op.hp / op.maxHp;

      let wGather = elapsed < 25 ? 0.55 : elapsed < 80 ? 0.3 : 0.12;
      let wRepair = 0;
      if (myPct < 0.98) wRepair = (1 - myPct) * 0.9;
      if (me.hp < op.hp && myPct < 0.5) wRepair += 0.35;
      if (me.effects.shield > 0) wRepair *= 0.4;      // shielded: go aggressive
      let wAttack = 0.45 + (opPct < 0.3 ? 0.35 : 0);  // smell blood
      if (s.timeLeft < 15) wGather = 0.02;            // late game: resources are worthless

      // a "dumber" CPU is noisier
      const noise = 1 - this.d.smart;
      wGather += this.rng() * noise; wRepair += this.rng() * noise * 0.5; wAttack += this.rng() * noise;

      const total = wGather + wRepair + wAttack;
      let r = this.rng() * total;
      if ((r -= wAttack) < 0) return 'attack';
      if ((r -= wRepair) < 0 && me.hp < me.maxHp) return 'repair';
      return 'gather';
    }

    tryBuy(s, me, op) {
      if (s.timeLeft < 8) return false; // not worth it this late
      let best = null;
      for (const tier of Object.keys(CONFIG.TIERS)) {
        const cost = me.costs[tier];
        if (me.res < cost) continue;
        me.offers[tier].forEach((id, idx) => {
          let v = VALUE[id] || 1;
          const u = UPGRADE_BY_ID[id];
          if (u.kind === 'timed' && me.effects[u.effect] > 2) v -= 5;
          if (id === 'shield' && op.autoAtk + op.atk > 20) v += 3;
          if ((id === 'patchkit' || id === 'welder' || id === 'drone' || id === 'nanos') && me.hp / me.maxHp > 0.85) v -= 2;
          if ((u.mod && (u.mod.autoGat || u.mod.gat)) && s.timeLeft < 40) v -= 4;
          if (!best || v > best.v) best = { tier, idx, v };
        });
      }
      if (!best) return false;
      // Save for a higher tier sometimes instead of buying junk
      if (best.v < 3 && this.rng() < this.d.smart * 0.7) return false;
      this.send({ a: 'buy', tier: best.tier, idx: best.idx });
      return true;
    }
  }

  const api = { CpuBot, DIFFICULTY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
