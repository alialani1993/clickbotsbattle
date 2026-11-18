/* ClickBots PvP — tuning + upgrade pool.
 * Everything a designer is likely to tweak lives in this file.
 * Shared by host ("server") and guest so both sides agree on names/costs. */
(function (root) {
  const CONFIG = {
    MATCH_SECONDS: 120,       // GDD: 2 minutes per match (default mode)
    MATCH_MODES: {            // selectable match lengths
      // optional per-mode startHp overrides START_HP, e.g. blitz: { ..., startHp: 1300 }
      blitz:    { label: 'Blitz',    seconds: 60 },
      standard: { label: 'Standard', seconds: 120 },
      marathon: { label: 'Marathon', seconds: 300 },
    },
    DEFAULT_MODE: 'standard',

    CPS_WINDOW: 5,            // seconds averaged for the live clicks-per-second readout
    ACTIVITY_WINDOW: 10,      // seconds averaged for the activity bars
    // Activity bars: a bar is full when it hits the larger of the two players' rates,
    // but never scales below these floors (so 1 dmg/s vs 0 doesn't read as "maxed").
    ACTIVITY_FLOOR: { dmg: 25, rep: 15, res: 6 },
    COUNTDOWN_SECONDS: 3,
    TICK_MS: 50,              // server simulation / broadcast rate (20 Hz)

    START_HP: 2500,
    START_RESOURCES: 0,

    BASE_ATTACK: 5,           // damage per attack click
    BASE_REPAIR: 4,           // HP per repair click
    BASE_GATHER: 1,           // resources per gather click

    CRIT_MULT: 3,
    SHIELD_REDUCTION: 0.6,    // shield blocks 60% of incoming damage
    OVERCLOCK_MULT: 2,

    MAX_CLICKS_PER_SEC: 20,   // server-side anti-macro cap (inputs above this are dropped)

    // Per-tier price; each purchase in a tier raises that tier's price.
    TIERS: {
      bronze: { label: 'Bronze', baseCost: 20,  growth: 1.2 },
      silver: { label: 'Silver', baseCost: 60,  growth: 1.25 },
      gold:   { label: 'Gold',   baseCost: 160, growth: 1.3 },
    },
    OFFERS_PER_TIER: 2,       // random choices shown per tier (GDD: random within tier)
  };

  // kind: 'stat' = permanent stat change, 'timed' = temporary effect (GDD: shields, overclock)
  const UPGRADES = [
    // ---------- BRONZE ----------
    { id: 'fists',     tier: 'bronze', icon: '👊', name: 'Sharpened Fists', desc: '+3 attack per click',      kind: 'stat', mod: { atk: 3 } },
    { id: 'patchkit',  tier: 'bronze', icon: '🩹', name: 'Patch Kit',       desc: '+3 repair per click',      kind: 'stat', mod: { rep: 3 } },
    { id: 'pickaxe',   tier: 'bronze', icon: '⛏️', name: 'Better Pickaxe',  desc: '+1 resource per click',    kind: 'stat', mod: { gat: 1 } },
    { id: 'minidrill', tier: 'bronze', icon: '🔩', name: 'Mini Drill',      desc: 'Auto: +1 resource / sec',  kind: 'stat', mod: { autoGat: 1 } },
    { id: 'plating',   tier: 'bronze', icon: '🛡️', name: 'Scrap Plating',   desc: '+150 max HP (and heals it)', kind: 'stat', mod: { maxHp: 150 } },

    // ---------- SILVER ----------
    { id: 'piston',    tier: 'silver', icon: '🥊', name: 'Piston Punch',    desc: '+8 attack per click',      kind: 'stat', mod: { atk: 8 } },
    { id: 'welder',    tier: 'silver', icon: '🔥', name: 'Arc Welder',      desc: '+8 repair per click',      kind: 'stat', mod: { rep: 8 } },
    { id: 'excavator', tier: 'silver', icon: '🚜', name: 'Excavator Arm',   desc: '+3 resources per click',   kind: 'stat', mod: { gat: 3 } },
    { id: 'turret',    tier: 'silver', icon: '🔫', name: 'Auto-Turret',     desc: 'Auto: 6 damage / sec',     kind: 'stat', mod: { autoAtk: 6 } },
    { id: 'drone',     tier: 'silver', icon: '🛸', name: 'Repair Drone',    desc: 'Auto: 5 repair / sec',     kind: 'stat', mod: { autoRep: 5 } },
    { id: 'rig',       tier: 'silver', icon: '🏭', name: 'Mining Rig',      desc: 'Auto: +4 resources / sec', kind: 'stat', mod: { autoGat: 4 } },

    // ---------- GOLD ----------
    { id: 'overdrive', tier: 'gold', icon: '⚡', name: 'Overdrive Core',   desc: 'Attack clicks ×1.5 (stacks)', kind: 'stat', mod: { atkMult: 0.5 } },
    { id: 'matrix',    tier: 'gold', icon: '🎯', name: 'Targeting Matrix', desc: '+20% crit chance (×3 dmg)',  kind: 'stat', mod: { crit: 0.2 } },
    { id: 'laser',     tier: 'gold', icon: '🛰️', name: 'Orbital Laser',    desc: 'Auto: 25 damage / sec',      kind: 'stat', mod: { autoAtk: 25 } },
    { id: 'nanos',     tier: 'gold', icon: '🧬', name: 'Nano Swarm',       desc: 'Auto: 15 repair / sec',      kind: 'stat', mod: { autoRep: 15 } },
    { id: 'shield',    tier: 'gold', icon: '🔰', name: 'Energy Shield',    desc: '10s: block 60% of damage',   kind: 'timed', effect: 'shield',    duration: 10 },
    { id: 'overclock', tier: 'gold', icon: '🌀', name: 'Overclock',        desc: '10s: all clicks & autos ×2', kind: 'timed', effect: 'overclock', duration: 10 },
  ];

  const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

  const api = { CONFIG, UPGRADES, UPGRADE_BY_ID };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
