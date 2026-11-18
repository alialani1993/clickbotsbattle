/* ClickBots PvP — client renderer.
 * Pure view: takes server snapshots and draws them. Inputs are forwarded
 * through ui.onAction(msg); the UI never changes game state itself. */
(function (root) {
  const { CONFIG, UPGRADE_BY_ID } = root;
  const $ = id => document.getElementById(id);

  // ---------- art ----------
  function robotSVG(main, dark, uid) {
    return `
<svg viewBox="0 0 200 210" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="body${uid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${main}"/><stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    <radialGradient id="core${uid}"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${main}"/><stop offset="1" stop-color="${dark}" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse cx="100" cy="203" rx="70" ry="7" fill="#000" opacity=".35"/>
  <!-- treads -->
  <rect x="38" y="168" width="124" height="32" rx="16" fill="#1b2030" stroke="#2c3550" stroke-width="3"/>
  <g fill="#3a4466"><circle cx="58" cy="184" r="9"/><circle cx="84" cy="184" r="9"/><circle cx="116" cy="184" r="9"/><circle cx="142" cy="184" r="9"/></g>
  <!-- back arm -->
  <rect x="34" y="104" width="20" height="54" rx="9" fill="${dark}" stroke="#0b0f1e" stroke-width="3"/>
  <!-- body -->
  <rect x="48" y="94" width="104" height="80" rx="16" fill="url(#body${uid})" stroke="#0b0f1e" stroke-width="4"/>
  <rect x="64" y="108" width="72" height="44" rx="8" fill="#0b0f1e" opacity=".55"/>
  <circle class="core" cx="100" cy="130" r="17" fill="url(#core${uid})"/>
  <g stroke="${main}" stroke-width="3" opacity=".7"><line x1="70" y1="160" x2="88" y2="160"/><line x1="112" y1="160" x2="130" y2="160"/></g>
  <!-- front arm + fist -->
  <rect x="146" y="104" width="20" height="44" rx="9" fill="${main}" stroke="#0b0f1e" stroke-width="3"/>
  <rect x="142" y="142" width="30" height="24" rx="7" fill="#d9deef" stroke="#0b0f1e" stroke-width="3"/>
  <!-- neck + head -->
  <rect x="88" y="84" width="24" height="14" fill="#2c3550"/>
  <rect x="56" y="30" width="88" height="60" rx="14" fill="url(#body${uid})" stroke="#0b0f1e" stroke-width="4"/>
  <rect x="72" y="46" width="68" height="26" rx="9" fill="#0b0f1e"/>
  <g class="eyes" fill="#fff"><rect x="96" y="53" width="12" height="12" rx="3"/><rect x="118" y="53" width="12" height="12" rx="3"/></g>
  <rect x="52" y="50" width="8" height="20" rx="3" fill="${dark}" stroke="#0b0f1e" stroke-width="2"/>
  <!-- antenna -->
  <line x1="100" y1="30" x2="100" y2="12" stroke="#0b0f1e" stroke-width="4"/>
  <circle class="antenna" cx="100" cy="10" r="7" fill="${main}" stroke="#0b0f1e" stroke-width="3"/>
  <!-- damage -->
  <g class="dmg dmg1" stroke="#0b0f1e" stroke-width="3" fill="none" stroke-linecap="round">
    <path d="M60 104 l12 10 l-4 10 l10 8"/><path d="M128 36 l-8 12 l6 6"/>
  </g>
  <g class="dmg dmg2" stroke="#0b0f1e" stroke-width="3" fill="none" stroke-linecap="round">
    <path d="M140 120 l-14 6 l4 12 l-12 10"/><path d="M66 74 l10 -8 l8 6"/>
    <circle cx="80" cy="18" r="9" fill="#5a607a" stroke="none" opacity=".7"><animate attributeName="cy" values="22;-10" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".7;0" dur="1.4s" repeatCount="indefinite"/></circle>
    <circle cx="70" cy="22" r="6" fill="#5a607a" stroke="none" opacity=".6"><animate attributeName="cy" values="26;-4" dur="1.1s" begin=".5s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0" dur="1.1s" begin=".5s" repeatCount="indefinite"/></circle>
  </g>
</svg>`;
  }

  function crystalSVG() {
    return `
<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gemA" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#ffcc4d"/><stop offset="1" stop-color="#d48a00"/></linearGradient>
    <radialGradient id="gemGlow"><stop offset="0" stop-color="#ffcc4d" stop-opacity=".55"/><stop offset="1" stop-color="#ffcc4d" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="80" cy="80" r="78" fill="url(#gemGlow)"><animate attributeName="r" values="70;78;70" dur="2.4s" repeatCount="indefinite"/></circle>
  <ellipse cx="80" cy="146" rx="44" ry="8" fill="#000" opacity=".35"/>
  <path d="M40 132 h80 l-8 -14 h-64z" fill="#3a4466" stroke="#0b0f1e" stroke-width="3"/>
  <polygon points="80,14 118,58 100,122 60,122 42,58" fill="url(#gemA)" stroke="#0b0f1e" stroke-width="4" stroke-linejoin="round"/>
  <polygon points="80,14 92,58 80,122 68,58" fill="#fff" opacity=".35"/>
  <polyline points="42,58 118,58" stroke="#0b0f1e" stroke-width="3" fill="none" opacity=".5"/>
  <polygon points="80,14 68,58 42,58" fill="#fff" opacity=".25"/>
</svg>`;
  }

  // ---------- helpers ----------
  const fmtTime = s => { s = Math.ceil(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  // Element centre in fx-layer coordinates (handles the desktop stage being offset/scaled).
  const centerOf = el => {
    const fx = document.getElementById('fxLayer');
    const f = fx.getBoundingClientRect(), k = f.width / (fx.offsetWidth || 1);
    const r = el.getBoundingClientRect();
    return { x: (r.left - f.left + r.width / 2) / k, y: (r.top - f.top + r.height / 2) / k, w: r.width / k, h: r.height / k };
  };
  const restart = (el, cls, ms) => {
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    clearTimeout(el['_t' + cls]); el['_t' + cls] = setTimeout(() => el.classList.remove(cls), ms);
  };

  const UI = {
    onAction: null,      // set by main.js
    myId: 'p1',
    _keys: {},
    _lastCount: null,
    _round: -1,
    _phase: null,

    init() {
      this.el = {
        meBot: $('meBot'), opBot: $('opBot'), node: $('node'),
        shop: $('shop'), fx: $('fxLayer'), overlay: $('overlay'),
      };
      this.el.meBot.innerHTML = robotSVG('#33e6b0', '#127a5e', 'me') + '<div class="effect-tags"></div>';
      this.el.opBot.innerHTML = robotSVG('#ff4f6d', '#8f1d33', 'op') + '<div class="effect-tags"></div>';
      this.el.node.innerHTML = crystalSVG();
      this.initActivity();

      const bind = (el, a) => el.addEventListener('pointerdown', e => {
        e.preventDefault();
        SFX.unlock();
        restart(el, 'press', 90);
        this.onAction && this.onAction({ a });
      });
      bind(this.el.meBot, 'repair');
      bind(this.el.opBot, 'attack');
      bind(this.el.node, 'gather');
      document.addEventListener('contextmenu', e => { if (e.target.closest('#game')) e.preventDefault(); });

      this.el.shop.addEventListener('pointerdown', e => {
        const card = e.target.closest('.card');
        if (!card || card.disabled) return;
        e.preventDefault();
        this.onAction && this.onAction({ a: 'buy', tier: card.dataset.tier, idx: +card.dataset.idx, id: card.dataset.id });
      });
    },

    // ---------- activity bars (what each player is spending effort on) ----------
    initActivity() {
      const ACTS = [['dmg', '⚔️', 'Damage'], ['rep', '🛠️', 'Repair'], ['res', '◆', 'Mine']];
      const side = who => `<div class="act-side ${who}"><div class="act-bar"><i class="m"></i><i class="a"></i></div><span class="v">0</span></div>`;
      const el = document.createElement('div');
      el.id = 'activity';
      el.className = 'act act-columns';
      el.innerHTML = ACTS.map(([k, ico, lbl]) => `
        <div class="act-row" data-k="${k}">
          ${side('me')}
          <div class="act-lbl"><span class="act-ico">${ico}</span><span class="act-txt">${lbl}</span></div>
          ${side('op')}
        </div>`).join('') +
        `<div class="act-legend"><span><i class="sw me"></i>You</span><span><i class="sw op"></i>Enemy</span><span><i class="sw auto"></i>Auto</span><span class="act-win">per sec · last ${CONFIG.ACTIVITY_WINDOW}s</span></div>`;
      document.querySelector('.lane.mid').appendChild(el);   // paired columns under the crystal
      this.act = {};
      el.querySelectorAll('.act-row').forEach(r => {
        const g = s => ({ m: r.querySelector(`.${s} .m`), a: r.querySelector(`.${s} .a`), v: r.querySelector(`.${s} .v`) });
        this.act[r.dataset.k] = { me: g('me'), op: g('op') };
      });
    },

    activity(me, op) {
      if (!this.act) return;
      for (const k of ['dmg', 'rep', 'res']) {
        const [mm, ma] = me.activity[k], [om, oa] = op.activity[k];
        const scale = Math.max(mm + ma, om + oa, CONFIG.ACTIVITY_FLOOR[k]);
        const set = (d, m, a) => {
          d.m.style.setProperty('--p', (m / scale * 100) + '%');
          d.a.style.setProperty('--p', (a / scale * 100) + '%');
          const t = m + a, txt = t >= 10 ? Math.round(t) : t.toFixed(1);
          if (d.v.textContent !== txt) d.v.textContent = txt;
        };
        set(this.act[k].me, mm, ma);
        set(this.act[k].op, om, oa);
      }
    },

    resetRound() {
      this.el.meBot.classList.remove('dead');
      this.el.opBot.classList.remove('dead');
      this._keys = {};
      this.el.fx.innerHTML = '';
      document.querySelectorAll('.click-pip').forEach(n => n.remove());
    },

    render(s) {
      const myId = this.myId, opId = myId === 'p1' ? 'p2' : 'p1';
      const me = s.players[myId], op = s.players[opId];

      if (s.round !== this._round) { this._round = s.round; this.resetRound(); }

      // HUD
      $('meName').textContent = me.name; $('opName').textContent = op.name;
      this.hp('me', me); this.hp('op', op);
      const t = $('timer');
      t.textContent = fmtTime(s.phase === 'waiting' || s.phase === 'countdown' ? s.matchSeconds : s.timeLeft);
      const ml = $('modeLabel'), modeTxt = CONFIG.MATCH_MODES[s.mode].label;
      if (ml.textContent !== modeTxt) ml.textContent = modeTxt;
      this.cps($('meCps'), me.cps); this.cps($('opCps'), op.cps);
      t.classList.toggle('low', s.phase === 'playing' && s.timeLeft <= 15);

      $('resCount').textContent = me.res;
      this.statsLine($('meStats'), me);
      this.statsLine($('opStats'), op);
      this.upgIcons('meUpg', me.upgrades);
      this.upgIcons('opUpg', op.upgrades);
      this.botState(this.el.meBot, me);
      this.botState(this.el.opBot, op);
      this.shop(me, s.phase === 'playing', s.offers);
      this.activity(me, op);

      // If I lost a buy race this tick, the "Too slow!" message replaces "Enemy took…" for that card.
      this._missed = new Set((s.events || []).filter(e => e.k === 'miss' && e.pid === myId).map(e => e.tier + e.idx));
      for (const ev of s.events || []) this.event(ev, myId);
      this.phase(s, myId);
    },

    cps(el, v) {
      const k = v.toFixed(1);
      if (el._k === k) return; el._k = k;
      el.innerHTML = `⚡<b>${k}</b><span class="cps-unit"> CPS</span>`;
      el.classList.toggle('hot', v >= 8);
    },

    hp(side, p) {
      const pct = Math.max(0, p.hp / p.maxHp * 100);
      $(side + 'HpFill').style.width = pct + '%';
      $(side + 'HpGhost').style.width = pct + '%';
      $(side + 'HpText').textContent = `${p.hp} / ${p.maxHp}`;
    },

    statsLine(el, p) {
      const key = [p.atk, p.rep, p.gat, p.crit, p.autoAtk, p.autoRep, p.autoGat].join();
      if (el._k === key) return; el._k = key;
      const autos = [];
      if (p.autoAtk) autos.push(`⚔️${p.autoAtk}/s`);
      if (p.autoRep) autos.push(`🛠️${p.autoRep}/s`);
      if (p.autoGat) autos.push(`◆${p.autoGat}/s`);
      el.innerHTML = `ATK <b>${p.atk}</b> · REP <b>${p.rep}</b> · MINE <b>${p.gat}</b>${p.crit ? ` · CRIT <b>${Math.round(p.crit * 100)}%</b>` : ''}`
        + (autos.length ? `<br>🤖 ${autos.join(' ')}` : '');
    },

    upgIcons(id, upgrades) {
      const key = JSON.stringify(upgrades);
      if (this._keys[id] === key) return; this._keys[id] = key;
      $(id).innerHTML = Object.entries(upgrades).map(([uid, n]) => {
        const u = UPGRADE_BY_ID[uid];
        return `<span class="upg-icon" title="${u.name}: ${u.desc}">${u.icon}${n > 1 ? `<sup>×${n}</sup>` : ''}</span>`;
      }).join('');
    },

    botState(el, p) {
      const pct = p.hp / p.maxHp;
      el.querySelector('.dmg1').style.display = pct < 0.6 ? '' : 'none';
      el.querySelector('.dmg2').style.display = pct < 0.3 ? '' : 'none';
      let bubble = el.querySelector('.shield-bubble');
      if (p.effects.shield > 0 && !bubble) { bubble = document.createElement('div'); bubble.className = 'shield-bubble'; el.appendChild(bubble); }
      if (p.effects.shield <= 0 && bubble) bubble.remove();
      el.classList.toggle('overclock', p.effects.overclock > 0);
      const tags = [];
      if (p.effects.shield > 0) tags.push(`🔰 ${Math.ceil(p.effects.shield)}s`);
      if (p.effects.overclock > 0) tags.push(`🌀 ${Math.ceil(p.effects.overclock)}s`);
      const tagEl = el.querySelector('.effect-tags');
      const k = tags.join('|');
      if (tagEl._k !== k) { tagEl._k = k; tagEl.innerHTML = tags.map(x => `<span class="effect-tag">${x}</span>`).join(''); }
    },

    shop(me, active, offers) {
      const key = JSON.stringify([offers, me.costs]);
      if (this._keys.shop !== key) {
        this._keys.shop = key;
        this.el.shop.style.setProperty('--offers', CONFIG.OFFERS_PER_TIER);
        this.el.shop.classList.toggle('many', CONFIG.OFFERS_PER_TIER >= 3);
        this.el.shop.innerHTML = Object.entries(CONFIG.TIERS).map(([tier, info]) => `
          <div class="tier ${tier}">
            <div class="tier-head"><span>${info.label}</span><span class="tier-cost">◆ ${me.costs[tier]}</span></div>
            <div class="cards">
              ${offers[tier].map((id, idx) => { const u = UPGRADE_BY_ID[id]; return `
                <button class="card" data-tier="${tier}" data-idx="${idx}" data-id="${id}" data-cost="${me.costs[tier]}" title="${u.desc}">
                  <span class="card-ico">${u.icon}</span>
                  <span class="card-txt"><div class="card-name">${u.name}</div><div class="card-desc">${u.desc}</div></span>
                </button>`; }).join('')}
            </div>
          </div>`).join('');
      }
      this.el.shop.querySelectorAll('.card').forEach(c => { c.disabled = !active || me.res < +c.dataset.cost; });
    },

    // ---------- events → FX ----------
    event(ev, myId) {
      const botOf = pid => (pid === myId ? this.el.meBot : this.el.opBot);
      if (ev.k === 'hit') {
        const tgt = botOf(ev.to);
        if (!ev.auto) this.pip(tgt, ev.from === myId);
        this.float(tgt, (ev.crit ? 'CRIT -' : '-') + ev.amt, 'dmg' + (ev.crit ? ' crit' : '') + (ev.auto ? ' auto' : ''), ev.auto ? '🤖 ' : '');
        restart(tgt, 'hit', 140);
        if (ev.crit || !ev.auto) this.sparks(tgt, ev.crit ? 10 : 3, ev.to === myId ? '#33e6b0' : '#ff4f6d');
        ev.to === myId ? SFX.hurt() : SFX.hit(ev.crit);
      } else if (ev.k === 'heal') {
        const tgt = botOf(ev.pid);
        if (!ev.auto) this.pip(tgt, ev.pid === myId);
        if (ev.amt > 0) this.float(tgt, '+' + ev.amt, 'heal' + (ev.auto ? ' auto' : ''), ev.auto ? '🤖 ' : '');
        restart(tgt, 'healed', 160);
        if (ev.pid === myId && !ev.auto) SFX.heal();
      } else if (ev.k === 'gain') {
        if (!ev.auto) this.pip(this.el.node, ev.pid === myId);
        if (ev.pid === myId) {
          this.float(this.el.node, '+' + ev.amt + ' ◆', 'gain' + (ev.auto ? ' auto' : ''), ev.auto ? '🤖 ' : '');
          restart(this.el.node, 'mined', 140);
          if (!ev.auto) SFX.gain();
        }
      } else if (ev.k === 'buy') {
        const u = UPGRADE_BY_ID[ev.id];
        this.float(botOf(ev.pid), `${u.icon} ${u.name}`, 'buy');
        const card = this.card(ev.tier, ev.idx);
        if (ev.pid === myId) { SFX.buy(); card && restart(card, 'fresh', 700); }
        else if (card) {           // the opponent won the race: show what they took
          restart(card, 'taken', 900);
          if (!this._missed.has(ev.tier + ev.idx)) this.float(card, `Enemy took ${u.icon} ${u.name}`, 'taken');
        }
      } else if (ev.k === 'miss' && ev.pid === myId) {
        const u = UPGRADE_BY_ID[ev.id], card = this.card(ev.tier, ev.idx);
        this.float(card || this.el.shop, `Too slow! ${u ? u.icon + ' ' + u.name : ''} was taken`, 'miss');
        SFX.hurt();
      }
    },

    card(tier, idx) { return this.el.shop.querySelector(`.card[data-tier="${tier}"][data-idx="${idx}"]`); },

    pip(target, mine) {
      const d = document.createElement('div');
      d.className = 'click-pip ' + (mine ? 'g' : 'r');
      d.style.left = (20 + Math.random() * 60) + '%';
      d.style.top = (20 + Math.random() * 60) + '%';
      target.appendChild(d);
      setTimeout(() => d.remove(), 600);
    },

    float(target, text, cls, prefix = '') {
      if (this.el.fx.childElementCount > 60) return;
      const c = centerOf(target);
      const d = document.createElement('div');
      d.className = 'float ' + cls;
      d.textContent = prefix + text;
      d.style.left = (c.x + (Math.random() - 0.5) * c.w * 0.6) + 'px';
      d.style.top = (c.y - c.h * 0.15 + (Math.random() - 0.5) * c.h * 0.3) + 'px';
      this.el.fx.appendChild(d);
      setTimeout(() => d.remove(), 900);
    },

    sparks(target, n, color) {
      if (this.el.fx.childElementCount > 80) return;
      const c = centerOf(target);
      for (let i = 0; i < n; i++) {
        const s = document.createElement('div');
        s.className = 'spark';
        s.style.background = color;
        s.style.left = (c.x + (Math.random() - 0.5) * c.w * 0.4) + 'px';
        s.style.top = (c.y + (Math.random() - 0.5) * c.h * 0.4) + 'px';
        const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 50;
        s.style.setProperty('--dx', Math.cos(a) * r + 'px');
        s.style.setProperty('--dy', Math.sin(a) * r + 'px');
        this.el.fx.appendChild(s);
        setTimeout(() => s.remove(), 500);
      }
    },

    // ---------- phase overlays ----------
    phase(s, myId) {
      const ov = this.el.overlay, title = $('ovTitle'), sub = $('ovSub');
      const changed = s.phase !== this._phase;
      this._phase = s.phase;

      if (s.phase === 'countdown') {
        const n = Math.ceil(s.countdown);
        ov.className = 'overlay countdown';
        $('ovButtons').style.display = 'none'; $('ovStats').innerHTML = ''; sub.textContent = '';
        if (this._lastCount !== n) { this._lastCount = n; title.className = 'ov-title big'; title.textContent = n; void title.offsetWidth; SFX.tick(); }
        return;
      }
      if (s.phase === 'playing') {
        if (changed) {
          this._lastCount = null;
          ov.className = 'overlay countdown';
          title.className = 'ov-title big'; title.textContent = 'FIGHT!'; SFX.go();
          setTimeout(() => { if (this._phase === 'playing') ov.className = 'overlay hidden'; }, 800);
        }
        return;
      }
      if (s.phase === 'over') {
        ov.className = 'overlay';
        $('ovButtons').style.display = '';
        const won = s.winner === myId, draw = !s.winner;
        if (changed) {
          title.className = 'ov-title ' + (draw ? '' : won ? 'win' : 'lose');
          title.textContent = draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
          const loser = s.winner ? (s.winner === 'p1' ? 'p2' : 'p1') : null;
          if (loser && s.players[loser].hp <= 0) (loser === myId ? this.el.meBot : this.el.opBot).classList.add('dead');
          draw ? SFX.tick() : won ? SFX.win() : SFX.lose();
          const me = s.players[myId], op = s.players[myId === 'p1' ? 'p2' : 'p1'];
          const row = (label, a, b) => `<div class="l">${a}</div><div class="m">${label}</div><div class="r">${b}</div>`;
          $('ovStats').innerHTML =
            row('', me.name, op.name) +
            row('HP left', me.hp, op.hp) +
            row('Damage dealt', me.stats.dmg, op.stats.dmg) +
            row('Repaired', me.stats.healed, op.stats.healed) +
            row('Mined', me.stats.mined, op.stats.mined) +
            row('Clicks', me.stats.clicks, op.stats.clicks) +
            row('Avg CPS', me.stats.avgCps.toFixed(1), op.stats.avgCps.toFixed(1)) +
            row('Peak CPS', me.stats.peakCps.toFixed(1), op.stats.peakCps.toFixed(1)) +
            row('Upgrades', Object.values(me.upgrades).reduce((a, b) => a + b, 0), Object.values(op.upgrades).reduce((a, b) => a + b, 0));
        }
        const opId = myId === 'p1' ? 'p2' : 'p1';
        const btn = $('btnRematch');
        btn.style.display = '';
        btn.disabled = !!s.rematch[myId];
        btn.textContent = s.rematch[myId] ? 'Waiting for opponent…' : 'Rematch';
        sub.textContent = s.reason + (s.rematch[opId] && !s.rematch[myId] ? ' · Opponent wants a rematch!' : '');
        return;
      }
      // waiting (opponent left)
      ov.className = 'overlay';
      title.className = 'ov-title'; title.textContent = 'Waiting…';
      sub.textContent = 'Waiting for an opponent to connect.';
      $('ovStats').innerHTML = '';
      $('ovButtons').style.display = '';
      $('btnRematch').style.display = 'none';
    },
  };

  root.UI = UI;
})(window);
