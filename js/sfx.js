/* Tiny procedural sound effects (no audio files needed). */
(function (root) {
  let ctx = null, muted = false;
  const last = {};

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ f = 440, f2 = null, type = 'square', dur = 0.06, vol = 0.05, delay = 0 }) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // throttle so 20 clicks/sec doesn't turn into noise
  function throttled(key, ms, fn) {
    const now = performance.now();
    if (last[key] && now - last[key] < ms) return;
    last[key] = now; fn();
  }

  const SFX = {
    unlock: ensure,
    toggle() { muted = !muted; return muted; },
    get muted() { return muted; },
    hit(crit)   { throttled('hit', 40, () => tone(crit ? { f: 900, f2: 120, dur: 0.16, vol: 0.07, type: 'sawtooth' } : { f: 260, f2: 90, dur: 0.07, vol: 0.05 })); },
    hurt()      { throttled('hurt', 70, () => tone({ f: 140, f2: 60, dur: 0.09, vol: 0.05, type: 'sawtooth' })); },
    heal()      { throttled('heal', 50, () => tone({ f: 500, f2: 900, dur: 0.07, vol: 0.035, type: 'sine' })); },
    gain()      { throttled('gain', 40, () => tone({ f: 1200 + Math.random() * 300, dur: 0.04, vol: 0.03, type: 'triangle' })); },
    buy()       { [523, 659, 784, 1046].forEach((f, i) => tone({ f, dur: 0.08, vol: 0.05, type: 'triangle', delay: i * 0.05 })); },
    tick()      { tone({ f: 880, dur: 0.05, vol: 0.05, type: 'square' }); },
    go()        { tone({ f: 660, f2: 1320, dur: 0.25, vol: 0.06, type: 'square' }); },
    win()       { [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ f, dur: 0.14, vol: 0.06, type: 'triangle', delay: i * 0.09 })); },
    lose()      { [392, 330, 262, 196].forEach((f, i) => tone({ f, dur: 0.2, vol: 0.06, type: 'sawtooth', delay: i * 0.13 })); },
  };

  root.SFX = SFX;
})(window);
