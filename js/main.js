/* ClickBots PvP — app controller: menus, modes, and wiring between
 * the GameServer (authority), the transport, and the UI (view). */
(function () {
  const $ = id => document.getElementById(id);
  const screens = ['menu', 'lobby', 'game'];
  const show = id => screens.forEach(s => $(s).classList.toggle('active', s === id));

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };

  let mode = null;        // 'cpu' | 'host' | 'guest'
  let lastSnapAt = 0;     // guest: when the host last sent state
  let hiddenAt = 0;
  let route = '';         // 'direct' | 'relay' once connected

  // Keep the phone screen on while hosting/playing online: a sleeping phone can't answer joins.
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator && !document.hidden) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
    } catch (_) { /* not supported / denied: fine */ }
  }
  const inviteUrl = () => location.origin + location.pathname + '#join=' + $('roomCode').textContent;
  let server = null, cpu = null, host = null, guest = null, loop = null;

  const getMode = () => store.get('cb_mode', CONFIG.DEFAULT_MODE);
  function setMode(m) {
    if (!CONFIG.MATCH_MODES[m]) m = CONFIG.DEFAULT_MODE;
    store.set('cb_mode', m);
    document.querySelectorAll('#modeSeg button').forEach(b => {
      const on = b.dataset.mode === m;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    });
  }
  const modeText = m => { const t = CONFIG.MATCH_MODES[m].seconds; return `${CONFIG.MATCH_MODES[m].label} · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  const myName = () => ($('nameInput').value.trim() || 'Player').slice(0, 16);
  const setStatus = (id, text, err) => { const el = $(id); el.textContent = text || ''; el.classList.toggle('err', !!err); };

  // ---------- local authoritative loop (CPU + host modes) ----------
  function startLoop(onSnap) {
    stopLoop();
    let last = performance.now();
    loop = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1.5, (now - last) / 1000);  // clamp after tab sleep
      last = now;
      server.tick(dt);
      onSnap(server.snapshot(), dt);
    }, CONFIG.TICK_MS);
  }
  // For playtesting/QA from the browser console: ClickBotsDebug().server
  window.ClickBotsDebug = () => ({ server, cpu, mode });

  function stopLoop() { if (loop) clearInterval(loop); loop = null; }

  function teardown() {
    stopLoop();
    host && host.close(); guest && guest.close();
    server = cpu = host = guest = null; mode = null; route = '';
    keepAwake(false);
    $('ping').textContent = '';
  }

  function toMenu(msg, err) {
    teardown();
    show('menu');
    setStatus('netStatus', msg, err);
    history.replaceState(null, '', location.pathname + location.search);
  }

  // ---------- vs CPU ----------
  function playCpu() {
    teardown();
    mode = 'cpu';
    const diff = $('difficulty').value;
    server = new GameServer({ names: { p1: myName(), p2: `CPU (${diff})` }, mode: getMode() });
    cpu = new CpuBot('p2', diff, m => server.rpc('p2', m));
    UI.myId = 'p1';
    UI.onAction = m => server && server.rpc('p1', m);
    show('game');
    server.start();
    startLoop((snap, dt) => {
      UI.render(snap);
      cpu.update(snap, dt);
      if (snap.phase === 'over' && !snap.rematch.p2) server.rpc('p2', { a: 'rematch' }); // CPU always wants more
    });
  }

  // ---------- host ----------
  function hostMatch() {
    teardown();
    mode = 'host';
    setStatus('netStatus', 'Creating room…');
    server = new GameServer({ names: { p1: myName(), p2: 'Guest' }, mode: getMode() });
    $('lobbyMode').textContent = modeText(getMode());
    UI.myId = 'p1';
    UI.onAction = m => server && server.rpc('p1', m);

    host = new Net.HostSession({
      onOpen(code) {
        $('roomCode').textContent = code;
        $('inviteUrl').textContent = inviteUrl();
        setStatus('lobbyStatus', 'Room open. Waiting for a player to join…');
        show('lobby');
      },
      onStatus(text) { if (text) setStatus('lobbyStatus', text); },
      onRoute(r) { $('ping').textContent = r === 'relay' ? 'via relay' : 'direct'; },
      onGuest() {
        setStatus('lobbyStatus', 'Opponent connected!');
        show('game');
        server.start();
        startLoop(snap => { UI.render(snap); host.send({ t: 's', s: snap }); });
      },
      onMessage(m) { server && server.rpc('p2', m); },
      onGuestLeft() {
        stopLoop();
        server.phase = 'waiting';
        server.setName('p2', 'Guest');
        setStatus('lobbyStatus', 'Opponent left. Waiting for a new player…');
        show('lobby');
      },
      onError(text) { toMenu(text, true); },
    });
    host.open();
    keepAwake(true);
  }

  // ---------- guest ----------
  function joinMatch(code) {
    teardown();
    mode = 'guest';
    setStatus('netStatus', 'Connecting…');
    UI.myId = 'p2';
    guest = new Net.GuestSession({
      onStatus(text) { setStatus('netStatus', text); },
      onConnected() {
        setStatus('netStatus', 'Connected! Waiting for host…');
        guest.send({ a: 'name', name: myName() });
      },
      onSnapshot(s) {
        lastSnapAt = performance.now();
        if (!$('game').classList.contains('active')) show('game');
        UI.render(s);
      },
      onRoute(r) { route = r; },
      onPing(ms) { $('ping').textContent = ms + ' ms' + (route ? ' · ' + route : ''); },
      onClosed(text) { toMenu(text, true); },
      onError(text) { toMenu(text, true); },
    });
    UI.onAction = m => guest && guest.send(m);
    guest.join(code);
    keepAwake(true);
  }

  // ---------- connection self-test ----------
  async function runNetTest() {
    const el = $('netTest');
    el.hidden = false;
    el.innerHTML = 'Testing… (up to 8 seconds)';
    const r = await Net.testIce();
    const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const line = (ok, label, note) => `<div class="${ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'bad'}">${ok === true ? '✅' : ok === 'warn' ? '⚠️' : '❌'} ${label}${note ? ` <code>${esc(note)}</code>` : ''}</div>`;
    let html = '';
    html += line(r.turnCount > 0 ? true : 'bad', `TURN servers in loaded config: ${r.turnCount}`, r.forced ? 'relay-only mode (?relay=1)' : '');
    if (!r.forced) {
      html += line(r.host > 0 ? true : 'warn', 'Same-network play');
      html += line(r.srflx > 0 ? true : 'warn', 'Public address found (STUN)', r.srflx ? '' : 'none');
    }
    html += line(r.relay > 0 ? true : 'bad', 'TURN relay reachable and accepted login', r.relayUrls.join(' '));
    r.errors.slice(0, 4).forEach(e => { html += `<div class="bad"><code>${esc(e)}</code></div>`; });
    let verdict;
    if (r.relay > 0) verdict = '<span class="ok">Cross-network play should work on this device. Run this on the other device too.</span>';
    else if (r.turnCount === 0) verdict = '<span class="bad">This page loaded a config.js with no TURN servers. If you just edited it, GitHub Pages can take a few minutes to update — check the build number below, then reload.</span>';
    else if (r.errors.some(e => / 401\b/.test(e))) verdict = '<span class="bad">The relay rejected the login (401). Re-copy the username and password (credential) from ExpressTURN.</span>';
    else verdict = '<span class="bad">Could not get a relay address. Check the urls (host and port) in TURN_SERVERS, or this network blocks the relay\'s ports — try the turns:…:443 URL.</span>';
    html += `<div class="verdict">${verdict}</div>`;
    el.innerHTML = html;
  }

  // ---------- desktop fixed-size stage ----------
  function setupStage() {
    const q = new URLSearchParams(location.search).get('stage');
    const m = q && q.match(/^(\d{3,4})x(\d{3,4})$/);
    const W = m ? +m[1] : CONFIG.STAGE.w, H = m ? +m[2] : CONFIG.STAGE.h;
    const mouse = matchMedia('(hover: hover) and (pointer: fine)');
    const root = document.documentElement.style;
    root.setProperty('--stage-w', W + 'px');
    root.setProperty('--stage-h', H + 'px');
    const fit = () => {
      document.body.classList.toggle('fixed-stage', mouse.matches);
      // Never scale UP (that would spread targets apart again). Only shrink to fit
      // small windows; uniform scaling keeps the distance-to-size ratio identical.
      const s = Math.min(1, (innerWidth - 24) / W, (innerHeight - 24) / H);
      root.setProperty('--stage-scale', Math.max(0.5, s).toFixed(4));
    };
    addEventListener('resize', fit);
    mouse.addEventListener && mouse.addEventListener('change', fit);
    fit();
  }

  // ---------- wiring ----------
  function init() {
    setupStage();
    UI.init();
    $('nameInput').value = store.get('cb_name', '');
    $('nameInput').addEventListener('change', () => store.set('cb_name', myName()));
    $('difficulty').value = store.get('cb_diff', 'normal');
    setMode(getMode());
    document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    $('difficulty').addEventListener('change', e => store.set('cb_diff', e.target.value));

    $('btnCpu').onclick = () => { SFX.unlock(); store.set('cb_name', myName()); playCpu(); };
    $('btnHost').onclick = () => { SFX.unlock(); store.set('cb_name', myName()); hostMatch(); };
    $('btnJoin').onclick = () => { SFX.unlock(); store.set('cb_name', myName()); joinMatch($('joinCode').value); };
    $('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
    $('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

    $('btnLobbyBack').onclick = () => toMenu('');
    $('btnNetTest').onclick = runNetTest;
    $('btnCopyLink').onclick = async () => {
      try { await navigator.clipboard.writeText(inviteUrl()); setStatus('lobbyStatus', 'Invite link copied!'); }
      catch (_) { setStatus('lobbyStatus', 'Copy this link: ' + inviteUrl()); }
    };
    // Native share sheet on phones (no need to leave the page to copy the link)
    if (navigator.share) {
      $('btnShare').hidden = false;
      $('btnShare').onclick = async () => {
        try {
          await navigator.share({ title: 'ClickBots PvP', text: `Join my ClickBots match! Room ${$('roomCode').textContent}`, url: inviteUrl() });
          setStatus('lobbyStatus', 'Invite sent. Keep this page open — the game starts when they join.');
        } catch (_) { /* share cancelled */ }
      };
    }

    // Mobile browsers freeze background tabs; reconnect the moment we're visible again.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = performance.now(); return; }
      const away = hiddenAt ? performance.now() - hiddenAt : 0;
      host && host.resume(away);
      guest && guest.resume();
      if (host || guest) keepAwake(true);   // wake locks are released when the page is hidden
    });
    addEventListener('online', () => { host && host.resume(); guest && guest.resume(); });

    // Guest: warn when the host stops sending state (host switched apps, bad connection).
    setInterval(() => {
      if (mode !== 'guest' || !$('game').classList.contains('active')) return;
      const quiet = performance.now() - lastSnapAt;
      if (quiet > 15000) toMenu('The host stopped responding (they may have closed the game).', true);
      else if (quiet > 2500) $('ping').textContent = '⚠ waiting for host…';
    }, 1000);
    // Closing/leaving the page: tell the other side right away instead of letting it time out.
    addEventListener('pagehide', () => { host && host.close(); guest && guest.close(); });

    $('btnRematch').onclick = () => UI.onAction && UI.onAction({ a: 'rematch' });
    $('btnMenu').onclick = () => toMenu('');
    $('btnMute').onclick = () => { $('btnMute').textContent = SFX.toggle() ? '🔇' : '🔊'; };

    // invite links: index.html#join=ABCDE
    const m = location.hash.match(/join=([A-Za-z0-9]{5})/);
    if (m) {
      $('joinCode').value = m[1].toUpperCase();
      setStatus('netStatus', 'Invite found — enter your name and press Join.');
    }
    if (!Net.peerAvailable()) {
      // PeerJS loads with `defer`; re-check once the page has fully loaded.
      window.addEventListener('load', () => {
        if (!Net.peerAvailable()) setStatus('netStatus', 'Online play unavailable (PeerJS failed to load). vs CPU still works.', true);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
