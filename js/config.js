/* ClickBots PvP — tuning + upgrade pool.
 * Everything a designer is likely to tweak lives in this file.
 * Shared by host ("server") and guest so both sides agree on names/costs. */
(function (root) {
  const CONFIG = {
    MATCH_SECONDS: 120,       // GDD: 2 minutes per match (default mode)
    // Desktop (mouse) players get a fixed-size game area so every target is the same
    // distance apart on every monitor. Phones/tablets stay full-screen.
    STAGE: { w: 1120, h: 700 },   // override for testing with ?stage=960x600

    // TURN relay (ExpressTURN) for online play when two networks can't connect directly
    // (phone on cellular ↔ PC on Wi-Fi, school/work networks). Keep exactly ONE
    // TURN_SERVERS entry: a second one later in this object silently overrides it.
    // Check it in-game: menu → "Test connection".
    TURN_SERVERS: [{
      urls: [
        'turn:free.expressturn.com:3478',                // UDP (fastest)
        'turn:free.expressturn.com:3478?transport=tcp',  // TCP fallback for networks that block UDP
      ],
      username: '000000002110454346',
      credential: 'EnDJqp9bHFwj/941dRqsWLp6A5Y=',
    }],

    // Selectable match lengths. startHp = default max HP (1,000 everywhere; menu can override).
    // Longer modes run a slower economy so ~75% of matches end by knockout, ~25% on time.
    //   priceMult — multiplies every tier price      powerMult — scales every upgrade's effect
    // Tuned with tools/balance-lab.js against the cost/benefit CPU (Normal vs Normal, 200+ matches):
    //   Blitz 74% KO / ~50s avg · Standard 72% / ~102s · Marathon 73% / ~248s
    //   (with armor plates → crit zones + held abilities)
    // KO rate is very sensitive to powerMult: nudge in steps of ~0.01.
    MATCH_MODES: {
      blitz:    { label: 'Blitz',    seconds: 60,  startHp: 1000, priceMult: 1.15, powerMult: 0.46 },
      standard: { label: 'Standard', seconds: 120, startHp: 1000, priceMult: 2,    powerMult: 0.335 },
      marathon: { label: 'Marathon', seconds: 300, startHp: 1000, priceMult: 3.5,  powerMult: 0.24 },
    },
    HP_PRESETS: [1000, 2500, 5000, 10000, 30000, 100000, 200000],  // menu "Max HP" choices
    HP_MIN: 100, HP_MAX: 1000000,
    DEFAULT_MODE: 'standard',

    CPS_WINDOW: 5,            // seconds averaged for the live clicks-per-second readout
    ACTIVITY_WINDOW: 10,      // seconds averaged for the activity bars
    // Activity bars: a bar is full when it hits the larger of the two players' rates,
    // but never scales below these floors (so 1 dmg/s vs 0 doesn't read as "maxed").
    ACTIVITY_FLOOR: { dmg: 25, rep: 15, res: 6 },
    COUNTDOWN_SECONDS: 3,
    TICK_MS: 50,              // server simulation / broadcast rate (20 Hz)

    START_HP: 1000,
    START_RESOURCES: 0,

    BASE_ATTACK: 5,           // damage per attack click
    BASE_REPAIR: 4,           // HP per repair click
    BASE_GATHER: 1,           // resources per gather click

    CRIT_MULT: 3,             // crit-zone hits do ×3 damage
    SHIELD_REDUCTION: 0.8,    // shield blocks 80% of incoming damage

    // Held abilities: active cards go into slots and are fired later (button or keys 1–3).
    // Full slots = you can't buy another active until you use one.
    ABILITY_SLOTS: 2,

    // Armor plates + crit zones: each bot's HP is split into `plates` equal chunks. When your
    // damage breaks a plate (HP drops below a divider), a crit zone opens for you on that bot
    // for `life` seconds; clicking it crits (×CRIT_MULT) and uses it up. A broken plate only
    // comes back once its whole chunk is repaired (no farming one divider).
    // Targeting Matrix (per stack): zones `matrixGrow` bigger and `matrixLife` seconds longer.
    CRIT_ZONE: { plates: 10, radius: 0.15, life: 2.5, matrixGrow: 0.25, matrixLife: 1 },
    OVERCLOCK_MULT: 2,

    // CPU opponent difficulty.
    //   cps      — clicks per second (the main difficulty knob; humans average ~5–8, fast players 10+)
    //   buyDelay — seconds between shop decisions (reaction time)
    //   noise    — error in its cost/benefit estimates (0 = perfect shopper, 0.6 = sloppy)
    //   smart    — how sensible its click choices are (1 = best, lower = more random)
    //   zoneHit  — chance that an attack click goes into a crit zone while one is showing
    CPU_DIFFICULTY: {
      easy:    { cps: 4,   buyDelay: 1.6,  noise: 0.6,  smart: 0.5, zoneHit: 0.1 },
      normal:  { cps: 6.5, buyDelay: 0.9,  noise: 0.25, smart: 0.8, zoneHit: 0.2 },
      hard:    { cps: 9,   buyDelay: 0.35, noise: 0.05, smart: 1.0, zoneHit: 0.35 },
      extreme: { cps: 18,  buyDelay: 0.25, noise: 0,    smart: 1.0, zoneHit: 0.55 },
    },

    MAX_CLICKS_PER_SEC: 20,   // server-side anti-macro cap (inputs above this are dropped)

    // Per-tier price; each purchase in a tier raises that tier's price.
    TIERS: {
      bronze: { label: 'Bronze', baseCost: 20,  growth: 1.2 },
      silver: { label: 'Silver', baseCost: 50,  growth: 1.25 },
      gold:   { label: 'Gold',   baseCost: 100, growth: 1.3 },
    },
    OFFERS_PER_TIER: 3,       // random choices shown per tier (GDD: random within tier)
  };

  // kind: 'stat' = permanent stat change, 'active' = held ability (goes into a slot, fired later)
  const UPGRADES = [
    // ---------- BRONZE ----------
    { id: 'fists',     tier: 'bronze', icon: '👊', name: 'Sharpened Fists', desc: '+3 attack per click',      kind: 'stat', mod: { atk: 3 } },
    { id: 'patchkit',  tier: 'bronze', icon: '🩹', name: 'Patch Kit',       desc: '+3 repair per click',      kind: 'stat', mod: { rep: 3 } },
    { id: 'pickaxe',   tier: 'bronze', icon: '⛏️', name: 'Better Pickaxe',  desc: '+3 resources per click',    kind: 'stat', mod: { gat: 3 } },
    { id: 'minidrill', tier: 'bronze', icon: '🔩', name: 'Mini Drill',      desc: 'Auto: +5 resources / sec',  kind: 'stat', mod: { autoGat: 5 } },
    { id: 'minilaser', tier: 'bronze', icon: '⚠️', name: 'Mini Laser',      desc: 'Auto: 5 damage / sec',  kind: 'stat', mod: { autoAtk: 5 } },
    { id: 'autorepair', tier: 'bronze', icon: '🔧', name: 'Auto Repair',      desc: 'Auto: 5 repair / sec',  kind: 'stat', mod: { autoRep: 5 } },
    { id: 'plating',   tier: 'bronze', icon: '🛡️', name: 'Scrap Plating',   desc: '+150 max HP (and heals it)', kind: 'stat', mod: { maxHp: 150 } },

    // ---------- SILVER ----------
    { id: 'piston',    tier: 'silver', icon: '🥊', name: 'Piston Punch',    desc: '+10 attack per click',      kind: 'stat', mod: { atk: 10 } },
    { id: 'welder',    tier: 'silver', icon: '🔥', name: 'Arc Welder',      desc: '+10 repair per click',      kind: 'stat', mod: { rep: 10 } },
    { id: 'excavator', tier: 'silver', icon: '🚜', name: 'Excavator Arm',   desc: '+10 resources per click',   kind: 'stat', mod: { gat: 10 } },
    { id: 'turret',    tier: 'silver', icon: '🔫', name: 'Auto-Turret',     desc: 'Auto: 15 damage / sec',     kind: 'stat', mod: { autoAtk: 15 } },
    { id: 'drone',     tier: 'silver', icon: '🛸', name: 'Repair Drone',    desc: 'Auto: 15 repair / sec',     kind: 'stat', mod: { autoRep: 15 } },
    { id: 'rig',       tier: 'silver', icon: '🏭', name: 'Mining Rig',      desc: 'Auto: +15 resources / sec', kind: 'stat', mod: { autoGat: 15 } },

    // ---------- GOLD ----------
    { id: 'overdrive', tier: 'gold', icon: '⚡', name: 'Overdrive Core',   desc: 'Attack clicks ×1.5 (stacks)', kind: 'stat', mod: { atkMult: 0.5 } },
    { id: 'matrix',    tier: 'gold', icon: '🎯', name: 'Targeting Matrix', desc: 'Crit zones 25% bigger, last 1s longer', kind: 'stat', mod: { zone: 1 } },
    { id: 'laser',     tier: 'gold', icon: '🛰️', name: 'Orbital Laser',    desc: 'Auto: 50 damage / sec',      kind: 'stat', mod: { autoAtk: 50 } },
    { id: 'nanos',     tier: 'gold', icon: '🧬', name: 'Nano Swarm',       desc: 'Auto: 50 repair / sec',      kind: 'stat', mod: { autoRep: 50 } },
    { id: 'terraform',     tier: 'gold', icon: '🪐', name: 'Terraforming',       desc: 'Auto: +50 resources / sec',      kind: 'stat', mod: { autoGat: 50 } },
    { id: 'shield',    tier: 'gold', icon: '🔰', name: 'Energy Shield',    desc: 'Ability · 10s: block 80% of damage', kind: 'active', effect: 'shield', duration: 10 },
    { id: 'overclock', tier: 'gold', icon: '🌀', name: 'Overclock',        desc: 'Ability · 10s: all clicks & autos ×2', kind: 'active', effect: 'overclock', duration: 10 },
    { id: 'emp',       tier: 'gold', icon: '📡', name: 'EMP Blast',        desc: "Ability · 6s: enemy auto-clickers offline", kind: 'active', effect: 'emp', duration: 6, target: 'enemy' },
  ];

  const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

  // ---- per-mode power scaling (shared by server + UI so cards always match the game) ----
  const modePower = mode => (CONFIG.MATCH_MODES[mode] && CONFIG.MATCH_MODES[mode].powerMult) || 1;
  const modePrice = mode => (CONFIG.MATCH_MODES[mode] && CONFIG.MATCH_MODES[mode].priceMult) || 1;
  const UNSCALED = ['crit', 'zone'];   // flat effects; abilities keep their durations
  function scaledMod(u, mode) {
    const k = modePower(mode), out = {};
    for (const [key, v] of Object.entries(u.mod || {})) out[key] = UNSCALED.includes(key) ? v : v * k;
    return out;
  }
  const fmtNum = v => String(+(+v).toFixed(v < 10 ? 1 : 0));
  // Rewrites the number in a card's description to the scaled value, e.g. "+10 attack" → "+4.7 attack".
  function describeUpgrade(u, mode) {
    if (u.kind !== 'stat' || modePower(mode) === 1) return u.desc;
    const [key, v] = Object.entries(scaledMod(u, mode))[0];
    if (UNSCALED.includes(key)) return u.desc;
    if (key === 'atkMult') return u.desc.replace(/×[\d.]+/, '×' + fmtNum(1 + v));
    return u.desc.replace(/[\d.]+/, fmtNum(v));
  }

  // Crit zone size/lifetime for a player with `matrix` Targeting Matrix stacks.
  const zoneSpec = (matrix = 0) => ({
    r: CONFIG.CRIT_ZONE.radius * (1 + CONFIG.CRIT_ZONE.matrixGrow * matrix),
    life: CONFIG.CRIT_ZONE.life + CONFIG.CRIT_ZONE.matrixLife * matrix,
  });

  const api = { CONFIG, UPGRADES, UPGRADE_BY_ID, scaledMod, describeUpgrade, modePrice, modePower, zoneSpec };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
