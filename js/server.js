/* ClickBots PvP — authoritative game server.
 *
 * Mirrors the GDD networking model:
 *   • Clients only send inputs (rpc) and render state.
 *   • The server computes damage / repair / resources, tracks upgrades,
 *     auto-clickers and temporary effects, and broadcasts snapshots.
 *
 * In the browser build the "server" runs inside the host player's tab
 * (or locally for vs-CPU). It has no DOM dependencies, so it also runs in Node
 * for automated balance tests.
 */
(function (root) {
  const { CONFIG, UPGRADES, UPGRADE_BY_ID } =
    (typeof module !== 'undefined' && module.exports) ? require('./config.js') : root;

  const PIDS = ['p1', 'p2'];
  const other = pid => (pid === 'p1' ? 'p2' : 'p1');

  const BUCKET = 0.5;
  const MAX_BUCKETS = Math.ceil(Math.max(CONFIG.CPS_WINDOW, CONFIG.ACTIVITY_WINDOW) / BUCKET) + 1;
  const newBucket = () => ({ clicks: 0, dmg: 0, dmgA: 0, rep: 0, repA: 0, res: 0, resA: 0 });

  function newPlayer(id, name, startHp = CONFIG.START_HP) {
    return {
      id, name,
      hp: startHp, maxHp: startHp,
      res: CONFIG.START_RESOURCES,
      // per-click stats
      atk: CONFIG.BASE_ATTACK, rep: CONFIG.BASE_REPAIR, gat: CONFIG.BASE_GATHER,
      atkMult: 1, crit: 0,
      // auto-clickers (per second)
      autoAtk: 0, autoRep: 0, autoGat: 0,
      // temporary effects: seconds remaining
      effects: { shield: 0, overclock: 0 },
      upgrades: {},                    // id -> count
      tierBuys: { bronze: 0, silver: 0, gold: 0 },
      stats: { clicks: 0, dmg: 0, healed: 0, mined: 0 },
      _clickTimes: [],                 // for rate limiting
      _acc: { atk: 0, rep: 0, gat: 0 },// fractional auto accumulators
      _autoReport: { dmg: 0, heal: 0, gain: 0 },
      // rolling history in 0.5s buckets: clicks + output split manual/auto
      _buckets: [newBucket()],
      peakCps: 0,
    };
  }

  class GameServer {
    constructor(opts = {}) {
      this.rng = opts.rng || Math.random;
      this.names = { p1: 'Player 1', p2: 'Player 2', ...(opts.names || {}) };
      this.phase = 'waiting';          // waiting | countdown | playing | over
      this.events = [];
      this.rematch = { p1: false, p2: false };
      this.round = 0;
      this.setMode(opts.mode || CONFIG.DEFAULT_MODE);
      this.reset();
    }

    // ---------- lifecycle ----------
    setMode(mode) {                    // only takes effect at the next reset/start
      if (!CONFIG.MATCH_MODES[mode]) return;
      this.mode = mode;
      this.matchSeconds = CONFIG.MATCH_MODES[mode].seconds;
      if (this.phase === 'waiting' || this.phase === 'over') this.timeLeft = this.matchSeconds;
    }

    reset() {
      const hp = CONFIG.MATCH_MODES[this.mode].startHp || CONFIG.START_HP;
      this.players = { p1: newPlayer('p1', this.names.p1, hp), p2: newPlayer('p2', this.names.p2, hp) };
      // One shared shop for both players: buying a card replaces it for everyone (race to the upgrade).
      this.offers = {};
      for (const t of Object.keys(CONFIG.TIERS)) this.rollOffers(t);
      this.timeLeft = this.matchSeconds;
      this.elapsed = 0;
      this._bucketT = 0;
      this.countdown = CONFIG.COUNTDOWN_SECONDS;
      this.winner = null; this.reason = null;
      this.rematch = { p1: false, p2: false };
      this._autoTimer = 0;
    }

    start() {                          // called when both players are present
      this.reset();
      this.round++;
      this.phase = 'countdown';
      this.events.push({ k: 'phase', phase: 'countdown' });
    }

    setName(pid, name) {
      name = String(name || '').slice(0, 16).trim();
      if (!name) return;
      this.names[pid] = name;
      this.players[pid].name = name;
    }

    // ---------- upgrades ----------
    tierCost(pid, tier) {
      const t = CONFIG.TIERS[tier];
      return Math.round(t.baseCost * Math.pow(t.growth, this.players[pid].tierBuys[tier]));
    }

    rollOffers(tier) {
      const pool = UPGRADES.filter(u => u.tier === tier).map(u => u.id);
      const picks = [];
      while (picks.length < CONFIG.OFFERS_PER_TIER && pool.length) {
        picks.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]);
      }
      this.offers[tier] = picks;
    }

    // Replace one bought card with a new random upgrade not already on display
    // (and, when the pool allows, not the one just bought).
    rerollSlot(tier, idx, boughtId) {
      const shown = this.offers[tier];
      const all = UPGRADES.filter(u => u.tier === tier).map(u => u.id);
      let pool = all.filter(id => !shown.includes(id) && id !== boughtId);
      if (!pool.length) pool = all.filter(id => !shown.includes(id) || id === boughtId);
      shown[idx] = pool[Math.floor(this.rng() * pool.length)];
    }

    applyUpgrade(p, u) {
      if (u.kind === 'timed') {
        p.effects[u.effect] = Math.max(p.effects[u.effect], 0) + u.duration;
      } else {
        for (const [k, v] of Object.entries(u.mod)) {
          if (k === 'maxHp') { p.maxHp += v; p.hp = Math.min(p.maxHp, p.hp + v); }
          else p[k] += v;
        }
      }
      p.upgrades[u.id] = (p.upgrades[u.id] || 0) + 1;
    }

    // ---------- inputs ("ServerRPCs") ----------
    rpc(pid, msg) {
      if (!msg || !this.players[pid]) return;
      if (msg.a === 'rematch') return this.voteRematch(pid);
      if (msg.a === 'name') return this.setName(pid, msg.name);
      if (this.phase !== 'playing') return;

      const p = this.players[pid];
      const o = this.players[other(pid)];

      if (msg.a === 'attack' || msg.a === 'repair' || msg.a === 'gather') {
        if (!this.allowClick(p)) return;
        p.stats.clicks++;
        p._buckets[p._buckets.length - 1].clicks++;
        const oc = p.effects.overclock > 0 ? CONFIG.OVERCLOCK_MULT : 1;

        if (msg.a === 'attack') {
          const crit = this.rng() < p.crit;
          let dmg = p.atk * p.atkMult * oc * (crit ? CONFIG.CRIT_MULT : 1);
          dmg = this.damage(o, dmg);
          p.stats.dmg += dmg;
          this.record(p, 'dmg', dmg, false);
          this.events.push({ k: 'hit', from: pid, to: o.id, amt: Math.round(dmg), crit });
        } else if (msg.a === 'repair') {
          const healed = this.heal(p, p.rep * oc);
          p.stats.healed += healed;
          this.record(p, 'rep', healed, false);
          this.events.push({ k: 'heal', pid, amt: Math.round(healed) });
        } else {
          const g = p.gat * oc;
          p.res += g; p.stats.mined += g;
          this.record(p, 'res', g, false);
          this.events.push({ k: 'gain', pid, amt: Math.round(g) });
        }
        this.checkDeath();
        return;
      }

      if (msg.a === 'buy') {
        const tier = msg.tier;
        if (!CONFIG.TIERS[tier]) return;
        const id = this.offers[tier][msg.idx];
        // The client says which upgrade it clicked. If the other player already took
        // that card, the slot now holds something else: reject instead of buying it.
        if (msg.id && msg.id !== id) { this.events.push({ k: 'miss', pid, tier, idx: msg.idx, id: msg.id }); return; }
        const u = UPGRADE_BY_ID[id];
        if (!u) return;
        const cost = this.tierCost(pid, tier);
        if (p.res < cost) return;
        p.res -= cost;
        p.tierBuys[tier]++;
        this.applyUpgrade(p, u);
        this.rerollSlot(tier, msg.idx, id);
        this.events.push({ k: 'buy', pid, id, tier, idx: msg.idx });
      }
    }

    allowClick(p) {                    // sliding-window rate limit
      const now = Date.now();
      const w = p._clickTimes;
      while (w.length && now - w[0] > 1000) w.shift();
      if (w.length >= CONFIG.MAX_CLICKS_PER_SEC) return false;
      w.push(now);
      return true;
    }

    record(p, key, amt, auto) {        // feeds CPS + activity bars
      const b = p._buckets[p._buckets.length - 1];
      b[auto ? key + 'A' : key] += amt;
    }

    rate(p, windowSec, fn) {           // per-second rate over the last windowSec
      const n = Math.round(windowSec / BUCKET);
      const bs = p._buckets.slice(-n);
      const span = Math.min(this.elapsed, (bs.length - 1) * BUCKET + this._bucketT);
      if (span < 0.25) return 0;
      return bs.reduce((s, b) => s + fn(b), 0) / span;
    }

    damage(target, amt) {
      if (target.effects.shield > 0) amt *= (1 - CONFIG.SHIELD_REDUCTION);
      const dealt = Math.min(target.hp, amt);
      target.hp -= dealt;
      return dealt;
    }

    heal(p, amt) {
      const h = Math.min(p.maxHp - p.hp, amt);
      p.hp += h;
      return h;
    }

    voteRematch(pid) {
      if (this.phase !== 'over') return;
      this.rematch[pid] = true;
      if (this.rematch.p1 && this.rematch.p2) this.start();
    }

    // ---------- simulation ----------
    tick(dt) {                         // dt in seconds
      if (this.phase === 'countdown') {
        this.countdown -= dt;
        if (this.countdown <= 0) {
          this.phase = 'playing';
          this.events.push({ k: 'phase', phase: 'playing' });
        }
        return;
      }
      if (this.phase !== 'playing') return;

      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.elapsed += dt;
      this._bucketT += dt;
      while (this._bucketT >= BUCKET) {
        this._bucketT -= BUCKET;
        for (const pid of PIDS) {
          const p = this.players[pid];
          if (this.elapsed >= 3) p.peakCps = Math.max(p.peakCps, this.cps(p));
          p._buckets.push(newBucket());
          if (p._buckets.length > MAX_BUCKETS) p._buckets.shift();
        }
      }

      for (const pid of PIDS) {
        const p = this.players[pid], o = this.players[other(pid)];
        const oc = p.effects.overclock > 0 ? CONFIG.OVERCLOCK_MULT : 1;

        p._acc.atk += p.autoAtk * oc * dt;
        p._acc.rep += p.autoRep * oc * dt;
        p._acc.gat += p.autoGat * oc * dt;

        if (p._acc.atk >= 1) { const a = Math.floor(p._acc.atk); p._acc.atk -= a; const d = this.damage(o, a); p.stats.dmg += d; p._autoReport.dmg += d; this.record(p, 'dmg', d, true); }
        if (p._acc.rep >= 1) { const a = Math.floor(p._acc.rep); p._acc.rep -= a; const h = this.heal(p, a); p.stats.healed += h; p._autoReport.heal += h; this.record(p, 'rep', h, true); }
        if (p._acc.gat >= 1) { const a = Math.floor(p._acc.gat); p._acc.gat -= a; p.res += a; p.stats.mined += a; p._autoReport.gain += a; this.record(p, 'res', a, true); }

        for (const e of Object.keys(p.effects)) p.effects[e] = Math.max(0, p.effects[e] - dt);
      }

      // Report auto-clicker output twice a second so clients can show floating numbers.
      this._autoTimer += dt;
      if (this._autoTimer >= 0.5) {
        this._autoTimer = 0;
        for (const pid of PIDS) {
          const p = this.players[pid], r = p._autoReport;
          if (r.dmg)  this.events.push({ k: 'hit',  from: pid, to: other(pid), amt: Math.round(r.dmg), auto: true });
          if (r.heal) this.events.push({ k: 'heal', pid, amt: Math.round(r.heal), auto: true });
          if (r.gain) this.events.push({ k: 'gain', pid, amt: Math.round(r.gain), auto: true });
          p._autoReport = { dmg: 0, heal: 0, gain: 0 };
        }
      }

      this.checkDeath();
      if (this.phase === 'playing' && this.timeLeft <= 0) this.endByTimer();
    }

    checkDeath() {
      if (this.phase !== 'playing') return;
      const d1 = this.players.p1.hp <= 0, d2 = this.players.p2.hp <= 0;
      if (d1 && d2) this.finish(null, 'Double knockout!');
      else if (d1) this.finish('p2', 'Bot destroyed');
      else if (d2) this.finish('p1', 'Bot destroyed');
    }

    endByTimer() {
      const h1 = Math.round(this.players.p1.hp), h2 = Math.round(this.players.p2.hp);
      if (h1 === h2) this.finish(null, 'Time up — equal HP');
      else this.finish(h1 > h2 ? 'p1' : 'p2', 'Time up — most HP remaining');
    }

    finish(winner, reason) {
      this.phase = 'over';
      this.winner = winner;
      this.reason = reason;
      this.events.push({ k: 'phase', phase: 'over', winner });
    }

    cps(p) { return this.rate(p, CONFIG.CPS_WINDOW, b => b.clicks); }

    // ---------- broadcast ----------
    snapshot() {
      const pub = p => ({
        id: p.id, name: p.name,
        hp: Math.round(p.hp), maxHp: p.maxHp, res: Math.floor(p.res),
        atk: +(p.atk * p.atkMult).toFixed(1), rep: p.rep, gat: p.gat, crit: p.crit,
        autoAtk: p.autoAtk, autoRep: p.autoRep, autoGat: p.autoGat,
        effects: { shield: +p.effects.shield.toFixed(1), overclock: +p.effects.overclock.toFixed(1) },
        upgrades: p.upgrades,
        costs: Object.fromEntries(Object.keys(CONFIG.TIERS).map(t => [t, this.tierCost(p.id, t)])),
        stats: {
          clicks: p.stats.clicks, dmg: Math.round(p.stats.dmg), healed: Math.round(p.stats.healed), mined: Math.round(p.stats.mined),
          avgCps: this.elapsed > 0 ? +(p.stats.clicks / this.elapsed).toFixed(2) : 0,
          peakCps: +p.peakCps.toFixed(1),
        },
        cps: this.phase === 'playing' ? +this.cps(p).toFixed(1) : 0,
        // per-second output over ACTIVITY_WINDOW: [manual, auto]
        activity: Object.fromEntries(['dmg', 'rep', 'res'].map(k => {
          const w = CONFIG.ACTIVITY_WINDOW;
          return [k, [+this.rate(p, w, b => b[k]).toFixed(1), +this.rate(p, w, b => b[k + 'A']).toFixed(1)]];
        })),
      });
      const snap = {
        phase: this.phase, round: this.round,
        mode: this.mode, matchSeconds: this.matchSeconds,
        offers: this.offers,
        timeLeft: +this.timeLeft.toFixed(2),
        countdown: +this.countdown.toFixed(2),
        winner: this.winner, reason: this.reason,
        rematch: { ...this.rematch },
        players: { p1: pub(this.players.p1), p2: pub(this.players.p2) },
        events: this.events,
      };
      this.events = [];
      return snap;
    }
  }

  const api = { GameServer, other };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
