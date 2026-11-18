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
    server = cpu = host = guest = null; mode = null;
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
        setStatus('lobbyStatus', 'Room open. Waiting for a player to join…');
        show('lobby');
      },
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
  }

  // ---------- guest ----------
  function joinMatch(code) {
    teardown();
    mode = 'guest';
    setStatus('netStatus', 'Connecting…');
    UI.myId = 'p2';
    guest = new Net.GuestSession({
      onConnected() {
        setStatus('netStatus', 'Connected! Waiting for host…');
        guest.send({ a: 'name', name: myName() });
      },
      onSnapshot(s) {
        if (!$('game').classList.contains('active')) show('game');
        UI.render(s);
      },
      onPing(ms) { $('ping').textContent = ms + ' ms'; },
      onClosed(text) { toMenu(text, true); },
      onError(text) { toMenu(text, true); },
    });
    UI.onAction = m => guest && guest.send(m);
    guest.join(code);
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
    $('btnCopyLink').onclick = async () => {
      const url = location.origin + location.pathname + '#join=' + $('roomCode').textContent;
      try { await navigator.clipboard.writeText(url); setStatus('lobbyStatus', 'Invite link copied!'); }
      catch (_) { setStatus('lobbyStatus', url); }
    };

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
