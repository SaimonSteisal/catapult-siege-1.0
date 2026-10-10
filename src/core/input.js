// ============================================================================
//  core/input.js — touch-first gesture layer (Master Prompt §3)
//  Handles: multitouch, dead-zones, drag/pinch/orbit, tap/long-press/dbl-tap,
//  aim-pad drag-release, cancel zone, UI vs viewport routing.
// ============================================================================
import { clamp, nowMs, vibrate } from './utils.js';

export const GESTURE = { NONE: 0, AIM: 1, ORBIT: 2, PINCH: 3, PAN: 4 };

class InputManager {
  constructor() {
    this.pointers = new Map();       // id -> {x,y,sx,sy,t,moved,el}
    this.gesture = GESTURE.NONE;
    this.gestureOwner = null;
    this.aimActive = false;
    this.enabled = true;
    this.listeners = { aimstart: [], aimmove: [], aimend: [], aimcancel: [], orbit: [], zoom: [], pan: [], tap: [], dbltap: [], longpress: [], targetTap: [] };
    this.deadZone = 6;
    this.longPressMs = 420;
    this.dblTapMs = 280;
    this.dblTapDist = 34;
    this.lastTap = { t: 0, x: 0, y: 0 };
    this.pinchStart = 0;
    this.viewport = null;
    this.scale = 1;
    this._raf = 0;
    this._longTimer = null;
    this._longFired = false;
  }

  /**
   * Listens on the WHOLE document (the aim pad lives in the HUD layer, not on the
   * canvas), but ignores touches owned by interactive UI controls.
   */
  attach(listenEl, viewportEl, scale = 1) {
    this.viewport = viewportEl;
    this.scale = scale;
    const opts = { passive: false };
    listenEl.addEventListener('touchstart', this._onDown, opts);
    listenEl.addEventListener('touchmove', this._onMove, opts);
    listenEl.addEventListener('touchend', this._onUp, opts);
    listenEl.addEventListener('touchcancel', this._onUp, opts);
    // Mouse fallback for desktop debugging (build/preview on PC)
    listenEl.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    listenEl.addEventListener('wheel', this._onWheel, { passive: false });
    listenEl.addEventListener('contextmenu', (e) => e.preventDefault());
    // Prevent pinch-zoom / double-tap-zoom of the page itself
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  /** touches that start on interactive UI are owned by the UI, not by gestures */
  _isUiTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('button, input, select, textarea, a, label, .switch, .seg, .ammo-chip, .skill-btn, .tool-btn, .modal-bg, .modal, .screen, .tut, .hud-panel, #toasts, #firebtn');
  }

  on(name, fn) { if (this.listeners[name]) this.listeners[name].push(fn); return this; }
  emit(name, data) { (this.listeners[name] || []).forEach((f) => { try { f(data); } catch (e) { console.error('[input] ' + name + ' STACK: ' + (e && e.stack || e)); } }); }

  _pos(e) {
    const r = this.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }

  // ------------------------------------------------------------- pointers ---
  _onDown = (e) => {
    if (!this.enabled) return;
    if (this._isUiTarget(e.target)) return;
    for (const t of e.changedTouches) {
      const p = this._pos(t);
      const rec = { id: t.identifier, x: p.x, y: p.y, sx: p.x, sy: p.y, t0: nowMs(), moved: 0, lx: p.x, ly: p.y, w: p.w, h: p.h };
      this.pointers.set(t.identifier, rec);
    }
    this._routeGestureStart();
    if (this.gesture !== GESTURE.NONE) e.preventDefault();
  };

  _onMouseDown = (e) => {
    if (!this.enabled) return;
    if (this._isUiTarget(e.target)) return;
    const p = this._pos(e);
    const rec = { id: 'mouse' + e.button, x: p.x, y: p.y, sx: p.x, sy: p.y, t0: nowMs(), moved: 0, lx: p.x, ly: p.y, w: p.w, h: p.h, btn: e.button };
    this.pointers.set(rec.id, rec);
    this._routeGestureStart();
  };

  _onMove = (e) => {
    // only steal the scroll when a game gesture is actually in progress
    if (this.gesture !== GESTURE.NONE) e.preventDefault();
    for (const t of e.changedTouches) {
      const rec = this.pointers.get(t.identifier);
      if (!rec) continue;
      const p = this._pos(t);
      rec.moved += Math.hypot(p.x - rec.x, p.y - rec.y);
      rec.x = p.x; rec.y = p.y; rec.w = p.w; rec.h = p.h;
    }
    this._routeGestureMove();
  };

  _onMouseMove = (e) => {
    let any = false;
    for (const [id, rec] of this.pointers) {
      if (typeof id === 'string' && id.startsWith('mouse')) {
        const p = this._pos(e);
        rec.moved += Math.hypot(p.x - rec.x, p.y - rec.y);
        rec.x = p.x; rec.y = p.y; any = true;
      }
    }
    if (any) this._routeGestureMove();
  };

  _onUp = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) this._release(this.pointers.get(t.identifier));
  };
  _onMouseUp = (e) => {
    for (const id of Array.from(this.pointers.keys())) {
      if (typeof id === 'string' && id.startsWith('mouse')) this._release(this.pointers.get(id));
    }
  };

  _onWheel = (e) => {
    e.preventDefault();
    const d = clamp(e.deltaY, -160, 160);
    this.emit('zoom', { delta: d * 0.06 });
  };

  _release(rec) {
    if (!rec) return;
    this.pointers.delete(rec.id);
    const dur = nowMs() - rec.t0;
    const dist = rec.moved;

    if (this.gesture === GESTURE.AIM) {
      // cancel zone = bottom-left corner circle (Master Prompt §3.3)
      const cz = this.aimCancelCenter;
      const inCancel = cz && Math.hypot(rec.x - cz.x, rec.y - cz.y) < this.aimCancelRadius;
      if (inCancel) { this.emit('aimcancel', { rec }); vibrate(12); }
      else this.emit('aimend', { dx: rec.x - rec.sx, dy: rec.y - rec.sy, dur, rec });
      this.aimActive = false;
      this.gesture = GESTURE.NONE;
      this._clearLong();
      return;
    }

    if (this.gesture === GESTURE.ORBIT || this.gesture === GESTURE.PAN) {
      this.gesture = GESTURE.NONE;
      this._clearLong();
      if (dist < this.deadZone * 2 && dur < this.longPressMs && !this._longFired) this._handleTap(rec);
      return;
    }

    if (this.gesture === GESTURE.PINCH) { if (this.pointers.size < 2) this.gesture = GESTURE.NONE; return; }

    this.gesture = GESTURE.NONE;
    this._clearLong();
    if (dist < this.deadZone * 2 && dur < this.longPressMs && !this._longFired) this._handleTap(rec);
  }

  _handleTap(rec) {
    const now = nowMs();
    const dt = now - this.lastTap.t;
    const dd = Math.hypot(rec.x - this.lastTap.x, rec.y - this.lastTap.y);
    this.lastTap = { t: now, x: rec.x, y: rec.y };
    if (dt < this.dblTapMs && dd < this.dblTapDist) { this.emit('dbltap', { x: rec.x, y: rec.y }); this.lastTap.t = 0; vibrate(8); return; }
    this.emit('tap', { x: rec.x, y: rec.y, w: rec.w, h: rec.h, dur: nowMs() - rec.t0 });
    vibrate(6);
  }

  _clearLong() { if (this._longTimer) { clearTimeout(this._longTimer); this._longTimer = null; } this._longFired = false; }

  // -------------------------------------------------------- gesture routing ---
  _routeGestureStart() {
    const n = this.pointers.size;
    const first = this.pointers.values().next().value;
    if (!first) return;

    if (n >= 2) {
      const arr = Array.from(this.pointers.values());
      this.pinchStart = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      this.pinchMid = { x: (arr[0].x + arr[1].x) / 2, y: (arr[0].y + arr[1].y) / 2 };
      this.gesture = GESTURE.PINCH;
      this.aimActive = false;
      this._clearLong();
      return;
    }

    // Single pointer: is it in the aim pad?
    if (this.aimZone && this._inRect(first, this.aimZone)) {
      this.gesture = GESTURE.AIM;
      this.aimActive = true;
      this.emit('aimstart', { x: first.x, y: first.y, w: first.w, h: first.h });
      vibrate(10);
      return;
    }

    this.gesture = GESTURE.ORBIT;
    this._longFired = false;
    this._clearLong();
    this._longTimer = setTimeout(() => {
      this._longFired = true;
      this.emit('longpress', { x: first.x, y: first.y });
      vibrate([14, 40, 14]);
    }, this.longPressMs);
  }

  _routeGestureMove() {
    const arr = Array.from(this.pointers.values());
    if (!arr.length) return;

    if (this.gesture === GESTURE.PINCH && arr.length >= 2) {
      const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      if (this.pinchStart > 0) this.emit('zoom', { delta: (this.pinchStart - d) * 0.012, dist: d });
      this.pinchStart = d;
      const mid = { x: (arr[0].x + arr[1].x) / 2, y: (arr[0].y + arr[1].y) / 2 };
      if (this.pinchMid) {
        const dx = mid.x - this.pinchMid.x, dy = mid.y - this.pinchMid.y;
        if (Math.abs(dy) > 0 || Math.abs(dx) > 0) this.emit('pan', { dx: dx * 0.02, dy: dy * 0.02 });
      }
      this.pinchMid = mid;
      this._clearLong();
      return;
    }

    if (this.gesture === GESTURE.AIM) {
      const p = arr[0];
      this.emit('aimmove', {
        dx: p.x - p.sx, dy: p.y - p.sy, x: p.x, y: p.y, w: p.w, h: p.h,
        dist: Math.hypot(p.x - p.sx, p.y - p.sy),
      });
      return;
    }

    if (this.gesture === GESTURE.ORBIT) {
      const p = arr[0];
      const dx = p.x - p.lx, dy = p.y - p.ly;
      p.lx = p.x; p.ly = p.y;
      if (p.moved > this.deadZone) { this._clearLong(); this.emit('orbit', { dx, dy, x: p.x, y: p.y, shift: p.btn === 2 }); }
      return;
    }
  }

  _inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

  // Configured by HUD each layout pass
  setAimZone(rect, cancelCenter, cancelRadius) {
    this.aimZone = rect;
    this.aimCancelCenter = cancelCenter;
    this.aimCancelRadius = cancelRadius;
  }
  setEnabled(v) { this.enabled = v; if (!v) { this.pointers.clear(); this.gesture = GESTURE.NONE; this.aimActive = false; } }

  anyTouch() { return this.pointers.size > 0; }
}

export const Input = new InputManager();
