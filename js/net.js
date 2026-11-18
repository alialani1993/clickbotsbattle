/* ClickBots PvP — online transport over WebRTC (PeerJS).
 *
 * GitHub Pages can only serve static files, so there is no dedicated game
 * server. Instead the HOST's browser runs the authoritative GameServer and the
 * GUEST connects peer-to-peer. PeerJS's free public broker is only used to
 * exchange connection details; game traffic flows directly between browsers
 * (or through a TURN relay when the two networks can't reach each other).
 *
 * Resilience (mobile browsers freeze background tabs):
 *   • The host keeps its room code and silently reconnects to the broker when it
 *     comes back to the foreground. Losing the broker never closes the lobby.
 *   • A guest whose room "isn't found" keeps retrying for a while, so it can join
 *     as soon as the host returns to the tab.
 *
 * Protocol (JSON):
 *   guest → host  { t:'in',   m:{ a:'attack'|'repair'|'gather'|'buy'|'rematch'|'name', ... } }   // "ServerRPC"
 *   host  → guest { t:'s',    s:<snapshot> }                                                       // state broadcast
 *   both          { t:'ping', ts } / { t:'pong', ts }
 *   host  → guest { t:'full' }   room already has two players
 */
(function (root) {
  const PREFIX = 'clickbots-gdd-v1-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const RECOVERABLE = ['network', 'socket-error', 'socket-closed', 'server-error', 'disconnected'];
  const JOIN_RETRIES = 15;          // × 2s ≈ 30s of "waiting for host"
  const CONNECT_TIMEOUT_MS = 20000; // per attempt, once the room has been found

  const ICE_FAIL_MSG = 'Found the room, but your two networks blocked a direct connection. ' +
    'Try both devices on the same Wi-Fi, or add a TURN relay (see README → "Online connection problems").';

  function makeCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }

  function peerAvailable() { return typeof root.Peer === 'function'; }

  // Use custom ICE servers only when a TURN relay is configured; otherwise keep PeerJS defaults.
  function peerOptions() {
    const turn = (root.CONFIG && root.CONFIG.TURN_SERVERS) || [];
    const opts = { debug: 1 };
    if (turn.length) {
      opts.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...turn] };
    }
    return opts;
  }

  // Report ICE progress so failures say *where* they happened.
  function watchIce(conn, onState) {
    const pc = conn && conn.peerConnection;
    if (!pc || !pc.addEventListener) return;
    pc.addEventListener('iceconnectionstatechange', () => onState(pc.iceConnectionState));
  }

  function describe(err) {
    const map = {
      'browser-incompatible': 'This browser does not support WebRTC.',
      'network': 'Lost connection to the matchmaking server.',
      'server-error': 'Matchmaking server error. Try again in a moment.',
      'socket-error': 'Could not reach the matchmaking server.',
      'unavailable-id': 'Could not create a room. Try again.',
      'webrtc': 'WebRTC error while connecting.',
    };
    return map[err && err.type] || ('Network error: ' + (err && (err.type || err.message) || 'unknown'));
  }

  // ======================= HOST =======================
  class HostSession {
    constructor(handlers) {
      // { onOpen(code), onStatus(text), onGuest(), onMessage(msg), onGuestLeft(), onError(text) }
      this.h = handlers;
      this.conn = null; this.peer = null;
      this.code = null; this.everOpened = false;
      this.codeTries = 0; this.retry = 0; this.closed = false;
    }

    status(t) { this.h.onStatus && this.h.onStatus(t); }

    open() {
      if (!peerAvailable()) return this.h.onError('Online library failed to load (check your connection).');
      this.code = makeCode();
      this.create();
    }

    create() {
      if (this.closed) return;
      const peer = new root.Peer(PREFIX + this.code, peerOptions());
      this.peer = peer;
      peer.on('open', () => {
        if (peer !== this.peer) return;
        this.retry = 0;
        const first = !this.everOpened;
        this.everOpened = true;
        if (first) this.h.onOpen(this.code);
        else this.status(this.conn && this.conn.open ? '' : 'Room open again. Waiting for a player to join…');
      });
      peer.on('connection', conn => this.accept(conn));
      peer.on('disconnected', () => { if (peer === this.peer) this.lostBroker(); });
      peer.on('error', err => {
        if (peer !== this.peer || this.closed) return;
        if (err.type === 'unavailable-id') {
          if (!this.everOpened && this.codeTries++ < 5) { this.code = makeCode(); return this.recreate(); }
          // Our own old registration is still lingering on the broker — keep the code and retry.
          this.status('Re-opening room ' + this.code + '…');
          return this.schedule(() => this.recreate());
        }
        if (RECOVERABLE.includes(err.type)) return this.lostBroker();
        if (err.type === 'peer-unavailable') return; // not relevant to the host
        if (!this.everOpened) return this.h.onError(describe(err));
        this.status(describe(err) + ' Retrying…');
        this.lostBroker();
      });
    }

    // Broker connection dropped (tab backgrounded, Wi-Fi blip…). An already-connected
    // guest is unaffected: game traffic is peer-to-peer.
    lostBroker() {
      if (this.closed) return;
      if (!(this.conn && this.conn.open)) this.status('Reconnecting room ' + this.code + '…');
      this.schedule(() => this.reconnect());
    }

    reconnect() {
      if (this.closed) return;
      const p = this.peer;
      if (!p || p.destroyed) return this.recreate();
      if (p.disconnected) { try { p.reconnect(); } catch (_) { this.recreate(); } }
    }

    recreate() {
      if (this.closed) return;
      if (this.conn && this.conn.open) return; // never kill a live match just to re-register
      try { this.peer && this.peer.destroy(); } catch (_) {}
      this.create();
    }

    schedule(fn) {
      clearTimeout(this.timer);
      const delay = Math.min(8000, 600 * Math.pow(2, this.retry++));
      this.timer = setTimeout(fn, delay);
    }

    // Page came back to the foreground: reconnect immediately instead of waiting for backoff.
    resume() {
      if (this.closed || !this.peer) return;
      this.retry = 0;
      if (this.peer.destroyed) this.recreate();
      else if (this.peer.disconnected) this.reconnect();
    }

    accept(conn) {
      if (this.conn && this.conn.open) {
        conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); });
        return;
      }
      this.conn = conn;
      this.status('Player found — connecting…');
      watchIce(conn, st => {
        if (conn !== this.conn || conn.open) return;
        if (st === 'checking') this.status('Player found — negotiating connection…');
        if (st === 'failed') { this.status('A player tried to join but the networks blocked a direct connection. See README → "Online connection problems".'); this.conn = null; }
      });
      conn.on('open', () => { if (conn === this.conn) this.h.onGuest(); });
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'ping') return conn.send({ t: 'pong', ts: msg.ts });
        if (msg.t === 'in') this.h.onMessage(msg.m);
      });
      conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.h.onGuestLeft(); } });
      conn.on('error', () => {});
    }

    send(obj) { if (this.conn && this.conn.open) this.conn.send(obj); }

    close() {
      this.closed = true; clearTimeout(this.timer);
      try { this.conn && this.conn.close(); this.peer && this.peer.destroy(); } catch (_) {}
      this.conn = null; this.peer = null;
    }
  }

  // ======================= GUEST =======================
  class GuestSession {
    constructor(handlers) {
      // { onStatus(text), onConnected(), onSnapshot(s), onPing(ms), onClosed(text), onError(text) }
      this.h = handlers;
      this.peer = null; this.conn = null; this.pingTimer = null;
      this.attempts = 0; this.closed = false; this.connected = false;
    }

    status(t) { this.h.onStatus && this.h.onStatus(t); }

    join(code) {
      if (!peerAvailable()) return this.h.onError('Online library failed to load (check your connection).');
      this.code = String(code || '').toUpperCase().trim();
      if (this.code.length !== 5) return this.h.onError('Room codes are 5 characters.');
      this.status('Connecting to matchmaking…');
      this.peer = new root.Peer(peerOptions());
      this.peer.on('open', () => { if (!this.conn && !this.connected) this.connect(); });
      this.peer.on('disconnected', () => {
        if (this.closed || this.connected) return;   // after joining, the broker isn't needed
        setTimeout(() => { try { this.peer && this.peer.reconnect(); } catch (_) {} }, 1000);
      });
      this.peer.on('error', err => {
        if (this.closed || this.connected) return;
        if (err.type === 'peer-unavailable') {
          this.conn = null;
          if (this.attempts < JOIN_RETRIES) {
            this.status(`Room ${this.code} not reachable yet — the host may have switched apps. Retrying (${this.attempts}/${JOIN_RETRIES})…`);
            clearTimeout(this.retryTimer);
            this.retryTimer = setTimeout(() => this.connect(), 2000);
          } else {
            this.h.onError(`Room ${this.code} not found. Check the code, and make sure the host has the game open in the foreground.`);
          }
          return;
        }
        if (RECOVERABLE.includes(err.type)) { this.status('Matchmaking connection dropped — retrying…'); return; }
        this.h.onError(describe(err));
      });
    }

    connect() {
      if (this.closed || this.connected) return;
      this.attempts++;
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.conn = conn;
      clearTimeout(this.connTimer);
      this.connTimer = setTimeout(() => {
        if (conn === this.conn && !conn.open && !this.closed) {
          const st = conn.peerConnection && conn.peerConnection.iceConnectionState;
          this.h.onError(st === 'checking' || st === 'failed' ? ICE_FAIL_MSG
            : 'Timed out connecting to the host. Make sure the host has the game open in the foreground, then try again.');
        }
      }, CONNECT_TIMEOUT_MS);
      watchIce(conn, st => {
        if (conn !== this.conn || conn.open) return;
        if (st === 'checking') this.status('Room found — negotiating a direct connection…');
        if (st === 'failed') { clearTimeout(this.connTimer); this.h.onError(ICE_FAIL_MSG); }
      });
      conn.on('open', () => {
        if (conn !== this.conn) return;
        clearTimeout(this.connTimer);
        this.connected = true;
        this.h.onConnected();
        this.pingTimer = setInterval(() => conn.open && conn.send({ t: 'ping', ts: performance.now() }), 2000);
      });
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 's') this.h.onSnapshot(msg.s);
        else if (msg.t === 'pong') this.h.onPing(Math.round(performance.now() - msg.ts));
        else if (msg.t === 'full') this.h.onError('That room is already full.');
      });
      conn.on('close', () => {
        if (conn !== this.conn || this.closed) return;
        clearInterval(this.pingTimer);
        if (this.connected) this.h.onClosed('Connection to the host was lost.');
      });
      conn.on('error', () => {});
    }

    resume() {
      if (this.closed || this.connected || !this.peer) return;
      if (this.peer.disconnected) { try { this.peer.reconnect(); } catch (_) {} }
    }

    send(m) { if (this.conn && this.conn.open) this.conn.send({ t: 'in', m }); }

    close() {
      this.closed = true;
      clearInterval(this.pingTimer); clearTimeout(this.retryTimer); clearTimeout(this.connTimer);
      try { this.conn && this.conn.close(); this.peer && this.peer.destroy(); } catch (_) {}
      this.conn = null; this.peer = null;
    }
  }

  root.Net = { HostSession, GuestSession, peerAvailable };
})(window);
