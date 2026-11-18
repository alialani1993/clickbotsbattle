/* ClickBots PvP — online transport over WebRTC (PeerJS).
 *
 * GitHub Pages can only serve static files, so there is no dedicated game
 * server. Instead the HOST's browser runs the authoritative GameServer and the
 * GUEST connects peer-to-peer. PeerJS's free public broker is only used to
 * exchange connection details; game traffic flows directly between browsers.
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

  function makeCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }

  function peerAvailable() { return typeof root.Peer === 'function'; }

  class HostSession {
    constructor(handlers) {
      this.h = handlers;   // { onOpen(code), onGuest(), onMessage(msg), onGuestLeft(), onError(text) }
      this.conn = null;
      this.peer = null;
      this.tries = 0;
    }

    open() {
      if (!peerAvailable()) return this.h.onError('Online library failed to load (check your connection).');
      this.code = makeCode();
      this.peer = new root.Peer(PREFIX + this.code, { debug: 1 });
      this.peer.on('open', () => this.h.onOpen(this.code));
      this.peer.on('connection', conn => this.accept(conn));
      this.peer.on('error', err => {
        if (err.type === 'unavailable-id' && this.tries++ < 5) { this.peer.destroy(); return this.open(); }
        this.h.onError(describe(err));
      });
      this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) {} });
    }

    accept(conn) {
      if (this.conn && this.conn.open) {
        conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); });
        return;
      }
      this.conn = conn;
      conn.on('open', () => this.h.onGuest());
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'ping') return conn.send({ t: 'pong', ts: msg.ts });
        if (msg.t === 'in') this.h.onMessage(msg.m);
      });
      conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.h.onGuestLeft(); } });
      conn.on('error', () => {});
    }

    send(obj) { if (this.conn && this.conn.open) this.conn.send(obj); }

    close() { try { this.conn && this.conn.close(); this.peer && this.peer.destroy(); } catch (_) {} this.conn = null; this.peer = null; }
  }

  class GuestSession {
    constructor(handlers) {
      this.h = handlers;   // { onConnected(), onSnapshot(s), onPing(ms), onClosed(text), onError(text) }
      this.peer = null; this.conn = null; this.pingTimer = null;
    }

    join(code) {
      if (!peerAvailable()) return this.h.onError('Online library failed to load (check your connection).');
      code = String(code || '').toUpperCase().trim();
      if (code.length !== 5) return this.h.onError('Room codes are 5 characters.');
      this.peer = new root.Peer({ debug: 1 });
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        const timeout = setTimeout(() => { if (!conn.open) this.h.onError('Could not reach that room. Check the code and try again.'); }, 12000);
        conn.on('open', () => {
          clearTimeout(timeout);
          this.h.onConnected();
          this.pingTimer = setInterval(() => conn.open && conn.send({ t: 'ping', ts: performance.now() }), 2000);
        });
        conn.on('data', msg => {
          if (!msg || typeof msg !== 'object') return;
          if (msg.t === 's') this.h.onSnapshot(msg.s);
          else if (msg.t === 'pong') this.h.onPing(Math.round(performance.now() - msg.ts));
          else if (msg.t === 'full') this.h.onError('That room is already full.');
        });
        conn.on('close', () => { clearInterval(this.pingTimer); this.h.onClosed('Host left the match.'); });
      });
      this.peer.on('error', err => {
        if (err.type === 'peer-unavailable') this.h.onError('Room not found. Check the code.');
        else this.h.onError(describe(err));
      });
    }

    send(m) { if (this.conn && this.conn.open) this.conn.send({ t: 'in', m }); }

    close() { clearInterval(this.pingTimer); try { this.conn && this.conn.close(); this.peer && this.peer.destroy(); } catch (_) {} this.conn = null; this.peer = null; }
  }

  function describe(err) {
    const map = {
      'browser-incompatible': 'This browser does not support WebRTC.',
      'network': 'Lost connection to the matchmaking server.',
      'server-error': 'Matchmaking server error. Try again in a moment.',
      'socket-error': 'Could not reach the matchmaking server.',
      'unavailable-id': 'Could not create a room. Try again.',
    };
    return map[err && err.type] || ('Network error: ' + (err && (err.type || err.message) || 'unknown'));
  }

  root.Net = { HostSession, GuestSession, peerAvailable };
})(window);
