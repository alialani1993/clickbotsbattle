/* ClickBots PvP — CPU opponent.
 * Plays through the same rpc() interface a human client uses, so it
 * can't cheat: it only sees snapshots and sends inputs.
 *
 * Shopping is cost/benefit: every offered card (affordable or not) is scored as
 * expected "HP swing" over the rest of the match ÷ price. Benefits use the CPU's own
 * click mix, its income and the damage it's taking; income upgrades are valued by the
 * combat upgrades that income could buy. If the best card isn't affordable yet, the CPU
 * saves for it (and mines more) unless an affordable card is within 80% of its score.
 * Difficulty = clicks per second, reaction time and estimate noise. */
(function (root) {
  const { CONFIG, UPGRADE_BY_ID, scaledMod, zoneSpec } =
    (typeof module !== 'undefined' && module.exports) ? require('./config.js') : root;

  // Difficulty settings live in config.js (CONFIG.CPU_DIFFICULTY).
  const DIFFICULTY = CONFIG.CPU_DIFFICULTY;

  class CpuBot {
    constructor(pid, difficulty, send, rng = Math.random) {
      this.pid = pid;
      this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
      this.send = send;
      this.rng = rng;
      this.budget = 0;
      this.buyCooldown = 0;
      this.clicks = { attack: 1, repair: 0.5, gather: 1 };   // decayed counts of its own clicks
      this.saving = null;                                    // card it is saving for
    }

    update(s, dt) {
      if (s.phase !== 'playing') { this.budget = 0; return; }
      const me = s.players[this.pid];
      const op = s.players[this.pid === 'p1' ? 'p2' : 'p1'];

      const decay = Math.pow(0.5, dt / 8);                    // ~8s half-life
      for (const k in this.clicks) this.clicks[k] *= decay;
      this.buyCooldown -= dt;
      if (this.buyCooldown <= 0) {
        if (this.tryAbility(s, me, op) || this.tryBuy(s, me, op)) this.buyCooldown = this.d.buyDelay;
      }

      // jittery click rate so it feels human
      this.budget += this.d.cps * dt * (0.7 + this.rng() * 0.6);
      while (this.budget >= 1) {
        this.budget -= 1;
        const a = this.chooseClick(s, me, op);
        this.clicks[a] += 1;
        this.send(a === 'attack' ? { a, ...this.aim(s, me) } : { a });
      }
    }

    chooseClick(s, me, op) {
      const frac = 1 - s.timeLeft / (s.matchSeconds || CONFIG.MATCH_SECONDS); // 0 → 1 over the match
      const myPct = me.hp / me.maxHp, opPct = op.hp / op.maxHp;

      // early: invest in economy; scales with match length (Blitz / Standard / Marathon)
      const early = Math.min(25, (s.matchSeconds || 120) * 0.2);
      const elapsed = frac * (s.matchSeconds || 120);
      let wGather = elapsed < early ? 0.55 : frac < 0.66 ? 0.3 : 0.12;
      let wRepair = 0;
      if (myPct < 0.98) wRepair = (1 - myPct) * 0.9;
      if (me.hp < op.hp && myPct < 0.5) wRepair += 0.35;
      if (me.effects.shield > 0) wRepair *= 0.4;      // shielded: go aggressive
      let wAttack = 0.45 + (opPct < 0.3 ? 0.35 : 0);  // smell blood
      if (this.saving) wGather += 0.15;               // saving up for a bigger upgrade
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

    // ---------- crit zone aim ----------
    // Share of attack clicks that end up as crits: each plate (op.maxHp / plates HP) of damage
    // opens one zone, caught with a chance that grows with zone size and lifetime (Matrix).
    critRate(me, op, atkCps, matrix = me.zone || 0) {
      const z = zoneSpec(matrix), g = z.r / CONFIG.CRIT_ZONE.radius;
      const pHit = Math.min(0.95, this.d.zoneHit * g * g);
      const caught = 1 - Math.pow(1 - pHit, Math.max(1, z.life * Math.max(atkCps, 0.5)));
      const chunk = op.maxHp / CONFIG.CRIT_ZONE.plates;
      return Math.min(0.5, caught * me.atk / chunk);
    }

    aim(s, me) {
      const z = me.critZone && me.critZone.active;
      if (z && this.rng() < this.d.zoneHit) {
        const a = this.rng() * 6.283, d = this.rng() * z.r * 0.6;
        return { x: z.x + Math.cos(a) * d, y: z.y + Math.sin(a) * d };
      }
      let x, y, tries = 0;
      do { x = 0.15 + this.rng() * 0.7; y = 0.15 + this.rng() * 0.75; } while (z && Math.hypot(x - z.x, y - z.y) < z.r * 1.6 && ++tries < 8);
      return { x, y };
    }

    // ---------- held abilities ----------
    tryAbility(s, me, op) {
      if (!me.abilities.length) return false;
      const sum = a => a[0] + a[1];
      const incoming = sum(op.activity.dmg), myRep = sum(me.activity.rep), myDps = sum(me.activity.dmg);
      const full = me.abilities.length >= CONFIG.ABILITY_SLOTS;
      this.heldFull = full ? (this.heldFull || 0) + 1 : 0;
      const want = me.abilities.findIndex(id => {
        if (id === 'shield') return me.effects.shield <= 0 &&
          (op.effects.overclock > 0 || incoming > Math.max(6, myRep * 1.5) || (me.hp < me.maxHp * 0.45 && incoming > 2));
        if (id === 'overclock') return me.effects.overclock <= 0 && op.effects.shield <= 0 && (myDps > 6 || s.timeLeft < 20);
        if (id === 'emp') return op.effects.emp <= 0 && (op.autoAtk + op.autoRep + op.autoGat * 0.3) >= 4;
        return false;
      });
      // Sitting on full slots for a while: fire something so a new ability can be bought.
      const slot = want >= 0 ? want : (this.heldFull > 12 || s.timeLeft < 6 ? 0 : -1);
      if (slot < 0) return false;
      this.send({ a: 'ability', slot });
      this.heldFull = 0;
      return true;
    }

    // ---------- shopping: cost / benefit ----------
    // Every offered card gets a benefit in "HP swing" over the expected rest of the match:
    // damage dealt to the enemy and damage prevented/repaired on itself count 1:1, extra
    // income counts as the combat value it could buy later. Score = benefit / cost, with
    // the remaining horizon shortened by however long it must save to afford the card.
    rates(s, me, op) {
      const c = this.clicks, total = c.attack + c.repair + c.gather || 1;
      const cps = this.d.cps;
      const atkCps = cps * c.attack / total, repCps = cps * c.repair / total, gatCps = cps * c.gather / total;
      const sum = a => a[0] + a[1];
      return {
        atkCps, repCps, gatCps,
        myDps: sum(me.activity.dmg), incoming: sum(op.activity.dmg),
        myRep: sum(me.activity.rep), income: Math.max(0.5, sum(me.activity.res)),
        clickDps: atkCps * me.atk * (1 + this.critRate(me, op, atkCps) * (CONFIG.CRIT_MULT - 1)),
      };
    }

    horizon(s, me, op, r) {
      // Expected seconds until the match ends: timer, or whoever is losing HP falls first.
      const myNet = Math.max(0.1, r.incoming - r.myRep), opNet = Math.max(0.1, r.myDps - op.activity.rep[0] - op.activity.rep[1]);
      const ko = Math.min(me.hp / myNet, op.hp / opNet);
      return Math.max(8, Math.min(s.timeLeft, ko * 1.2));
    }

    // Benefit (HP-equivalent) of upgrade u if it starts working after `wait` seconds.
    benefit(u, s, me, op, r, H, wait, hpPerRes) {
      const live = Math.max(0, H - wait);
      if (!live) return 0;
      if (u.kind === 'active') {        // held: fired at a good moment later
        if (me.abilities.length >= CONFIG.ABILITY_SLOTS) return 0;
        // Held abilities are fired at the best moment (vs a spike, an Overclock, a big auto build),
        // so they're worth more than their average-case effect: TIMING_BONUS.
        const dur = Math.min(u.duration, live), TIMING_BONUS = 2.5;
        const spike = Math.max(r.incoming, op.atk * this.d.cps * 0.5 + op.autoAtk, 4);
        if (u.effect === 'shield') return dur * spike * CONFIG.SHIELD_REDUCTION * TIMING_BONUS;
        if (u.effect === 'overclock') return dur * (r.myDps + r.myRep * 0.5 + r.income * hpPerRes * 0.5) * TIMING_BONUS;
        if (u.effect === 'emp') return dur * (op.autoAtk + Math.min(op.autoRep, r.myDps) + op.autoGat * hpPerRes * 0.5) * TIMING_BONUS;
        return 0;
      }
      let rate = 0, once = 0;
      const repairNeed = Math.max(0, r.incoming - r.myRep) + (me.maxHp - me.hp) / Math.max(5, H);
      for (const [k, v] of Object.entries(scaledMod(u, s.mode))) {
        if (k === 'atk') rate += v * me.atkMult0 * r.atkCps;
        else if (k === 'autoAtk') rate += v;
        else if (k === 'atkMult') rate += v * (r.clickDps / Math.max(1, me.atkMult0));
        else if (k === 'zone') {            // Targeting Matrix: bigger, longer zones → more caught
          const m = me.zone || 0;
          const dCrit = this.critRate(me, op, r.atkCps, m + v) - this.critRate(me, op, r.atkCps, m);
          rate += dCrit * (CONFIG.CRIT_MULT - 1) * r.atkCps * me.atk;
        }
        else if (k === 'rep') rate += Math.min(v * r.repCps, repairNeed + 1);
        else if (k === 'autoRep') rate += Math.min(v, repairNeed + 1);
        else if (k === 'gat') rate += v * r.gatCps * hpPerRes * 0.5;      // income → future upgrades
        else if (k === 'autoGat') rate += v * hpPerRes * 0.5;
        else if (k === 'maxHp') once += v * (r.incoming > 0 ? 1 : 0.5);
      }
      return rate * live + once;
    }

    tryBuy(s, me, op) {
      if (s.timeLeft < 6) return false;
      const r = this.rates(s, me, op);
      const H = this.horizon(s, me, op, r);
      me.atkMult0 = 1;
      const cards = [];
      for (const tier of Object.keys(CONFIG.TIERS)) {
        s.offers[tier].forEach((id, idx) => cards.push({ tier, idx, id, u: UPGRADE_BY_ID[id], cost: me.costs[tier] }));
      }
      // Exchange rate for income: best combat value per resource among current cards (no recursion).
      let hpPerRes = 0;
      for (const c of cards) {
        if (c.u.mod && (c.u.mod.gat || c.u.mod.autoGat)) continue;
        hpPerRes = Math.max(hpPerRes, this.benefit(c.u, s, me, op, r, H, 0, 0) / c.cost);
      }
      let best = null, bestNow = null;
      for (const c of cards) {
        const wait = Math.max(0, (c.cost - me.res) / r.income);
        const noise = 1 + (this.rng() * 2 - 1) * this.d.noise;
        c.score = this.benefit(c.u, s, me, op, r, H, wait, hpPerRes) / c.cost * noise;
        c.affordable = me.res >= c.cost;
        if (!best || c.score > best.score) best = c;
        if (c.affordable && (!bestNow || c.score > bestNow.score)) bestNow = c;
      }
      if (!best || best.score <= 0) { this.saving = null; return false; }
      // Buy the best card if affordable; otherwise buy an affordable one only if it's nearly as good.
      const pick = best.affordable ? best : (bestNow && bestNow.score >= best.score * 0.8 ? bestNow : null);
      this.saving = pick ? null : best;
      if (!pick) return false;
      this.send({ a: 'buy', tier: pick.tier, idx: pick.idx, id: pick.id });
      return true;
    }
  }

  const api = { CpuBot, DIFFICULTY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
