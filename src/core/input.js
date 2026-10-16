// ============================================================================
//  core/input.js — Pointer-Events gesture layer (Master Prompt §3)
//  One code path for finger / stylus / mouse across Chrome, WebView, desktop.
//  Handles: multitouch pinch/pan, drag aim pad, orbit, tap / double-tap /
//  long-press, cancel zone, UI-vs-game routing, dead zones, haptics.
// ============================================================================
import { clamp, nowMs, vibrate } from './utils.js';

export const GESTURE = { NONE: 0, AIM: 1, ORBIT: 2, PINCH: 3, PAN: 4 };

class InputManager {
  constructor() {
    this.pointers = new Map();       // pointerId -> rec
    this.gesture = GESTURE.NONE;
    this.aimActive = false;
    this.enabled = true;
    this.listeners = {
      aimstart: [], aimmove: [], aimend: [], aimcancel: [],
      orbit: [], zoom: [], pan: [], tap: [], dbltap: [], longpress: [], targetTap: [],
    };
    this.deadZone = 6;
    this.longPressMs = 420;
    this.dblTapMs = 280;
    this.dblTapDist = 34;
    this.lastTap = { t: 0, x: 0, y: 0 };
    this.pinchStart = 0;
    this.pinchMid = null;
    this.viewport = null;
    this._longTimer = null;
    this._longFired = false;
    this._lastDx = 0;
    this._lastDy = 0;
  }

  attach(listenEl, viewportEl) {
    this.viewport = viewportEl;
    const opts = { passive: false };
    listenEl.addEventListener('pointerdown', this._onDown, opts);
    listenEl.addEventListener('pointermove', this._onMove, opts);
    listenEl.addEventListener('pointerup', this._onUp, opts);
    listenEl.addEventListener('pointercancel', this._onCancel, opts);
    listenEl.addEventListener('pointerleave', this._onCancel, opts);
    listenEl.addEventListener('wheel', this._onWheel, { passive: false });
    listenEl.addEventListener('contextmenu', (e) => e.preventDefault());
    // block Safari/WebView double-tap zoom & gestures page-wide
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  on(name, fn) { if (this.listeners[name]) this.listeners[name].push(fn); return this; }
  emit(name, data) {
    (this.listeners[name] || []).forEach((f) => {
      try { f(data); } catch (e) { console.error('[input] ' + name + ' STACK: ' + (e && e.stack || e)); }
    });
  }

  /** touches that start on interactive UI are owned by the UI, not by gestures */
  _isUiTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('button, input, select, textarea, a, label, .switch, .seg, .ammo-chip, .skill-btn, .tool-btn, .modal-bg, .modal, .screen, .tut, .hud-panel, #toasts, #firebtn, .screen-body');
  }

  _pos(e) {
    const r = this.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }

  // ------------------------------------------------------------- pointers ---
  _onDown = (e) => {
    if (!this.enabled) return;
    if (this._isUiTarget(e.target)) return;
    const p = this._pos(e);
    const rec = {
      id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y,
      lx: p.x, ly: p.y, t0: nowMs(), moved: 0, w: p.w, h: p.h, btn: e.button,
      type: e.pointerType,
    };
    this.pointers.set(e.pointerId, rec);
    this._routeGestureStart();
    if (this.gesture !== GESTURE.NONE) {
      e.preventDefault();
      // keep receiving moves even if the finger slides off the element
      try { this.viewport.setPointerCapture && this.viewport.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
  };

  _onMove = (e) => {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    if (this.gesture !== GESTURE.NONE) e.preventDefault();
    const p = this._pos(e);
    rec.moved += Math.hypot(p.x - rec.x, p.y - rec.y);
    rec.x = p.x; rec.y = p.y; rec.w = p.w; rec.h = p.h;
    this._routeGestureMove();
  };

  _onUp = (e) => {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    this._release(rec);
  };

  _onCancel = (e) => {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    // system stole the gesture (notification shade, back-swipe…): drop silently
    this.pointers.delete(rec.id);
    if (this.gesture === GESTURE.AIM) { this.aimActive = false; this.emit('aimcancel', { rec }); }
    if (this.pointers.size === 0) this.gesture = GESTURE.NONE;
    else if (this.gesture === GESTURE.PINCH && this.pointers.size < 2) this.gesture = GESTURE.ORBIT;
    this._clearLong();
  };

  _onWheel = (e) => {
    e.preventDefault();
    this.emit('zoom', { delta: clamp(e.deltaY, -160, 160) * 0.06 });
  };

  _release(rec) {
    this.pointers.delete(rec.id);
    const dur = nowMs() - rec.t0;
    const dist = rec.moved;

    if (this.gesture === GESTURE.AIM) {
      const cz = this.aimCancelCenter;
      const inCancel = cz && Math.hypot(rec.x - cz.x, rec.y - cz.y) < this.aimCancelRadius;
      if (inCancel) { this.emit('aimcancel', { rec }); vibrate(12); }
      else this.emit('aimend', { dx: rec.x - rec.sx, dy: rec.y - rec.sy, dur, rec });
      this.aimActive = false;
      this.gesture = GESTURE.NONE;
      this._clearLong();
      this._lastDx = this._lastDy = 0;
      return;
    }

    if (this.gesture === GESTURE.ORBIT || this.gesture === GESTURE.PAN) {
      this.gesture = GESTURE.NONE;
      this._clearLong();
      if (dist < this.deadZone * 2 && dur < this.longPressMs && !this._longFired) this._handleTap(rec);
      return;
    }

    if (this.gesture === GESTURE.PINCH) {
      if (this.pointers.size < 2) this.gesture = this.pointers.size ? GESTURE.ORBIT : GESTURE.NONE;
      this._clearLong();
      return;
    }

    this.gesture = GESTURE.NONE;
    this._clearLong();
    if (dist < this.deadZone * 2 && dur < this.longPressMs && !this._longFired) this._handleTap(rec);
  }

  _handleTap(rec) {
    const now = nowMs();
    const dt = now - this.lastTap.t;
    const dd = Math.hypot(rec.x - this.lastTap.x, rec.y - this.lastTap.y);
    this.lastTap = { t: now, x: rec.x, y: rec.y };
    if (dt < this.dblTapMs && dd < this.dblTapDist) {
      this.emit('dbltap', { x: rec.x, y: rec.y });
      this.lastTap.t = 0;
      vibrate(8);
      return;
    }
    this.emit('tap', { x: rec.x, y: rec.y, w: rec.w, h: rec.h, dur: nowMs() - rec.t0 });
    vibrate(6);
  }

  _clearLong() { if (this._longTimer) { clearTimeout(this._longTimer); this._longTimer = null; } this._longFired = false; }

  // -------------------------------------------------------- gesture routing ---
  _routeGestureStart() {
    const n = this.pointers.size;
    const first = this.pointers.values().next().value;
    if (!first) return;

    if (n >= 2 && this.gesture !== GESTURE.AIM) {
      const arr = Array.from(this.pointers.values());
      this.pinchStart = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      this.pinchMid = { x: (arr[0].x + arr[1].x) / 2, y: (arr[0].y + arr[1].y) / 2 };
      this.gesture = GESTURE.PINCH;
      this.aimActive = false;
      this._clearLong();
      return;
    }

    if (this.aimZone && this._inRect(first, this.aimZone)) {
      this.gesture = GESTURE.AIM;
      this.aimActive = true;
      this._lastDx = this._lastDy = 0;
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
      if (this.pinchMid) this.emit('pan', { dx: (mid.x - this.pinchMid.x) * 0.02, dy: (mid.y - this.pinchMid.y) * 0.02 });
      this.pinchMid = mid;
      this._clearLong();
      return;
    }

    if (this.gesture === GESTURE.AIM) {
      const p = arr[0];
      this.emit('aimmove', {
        dx: p.x - p.sx, dy: p.y - p.sy, x: p.x, y: p.y, w: p.w, h: p.h,
        dist: Math.hypot(p.x - p.sx, p.y - p.sy),
        fine: this.pointers.size >= 2,   // second finger = fine mode (×0.25)
      });
      return;
    }

    if (this.gesture === GESTURE.ORBIT) {
      const p = arr[0];
      const dx = p.x - p.lx, dy = p.y - p.ly;
      p.lx = p.x; p.ly = p.y;
      if (p.moved > this.deadZone) {
        this._clearLong();
        this.emit('orbit', { dx, dy, x: p.x, y: p.y, shift: p.btn === 2 });
      }
      return;
    }
  }

  _inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

  setAimZone(rect, cancelCenter, cancelRadius) {
    this.aimZone = rect;
    this.aimCancelCenter = cancelCenter;
    this.aimCancelRadius = cancelRadius;
  }
  setEnabled(v) {
    this.enabled = v;
    if (!v) { this.pointers.clear(); this.gesture = GESTURE.NONE; this.aimActive = false; this._clearLong(); }
  }
  anyTouch() { return this.pointers.size > 0; }
}

export const Input = new InputManager();
