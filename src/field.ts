interface Bubble { x: number; y: number; r: number; vx: number; vy: number; ph: number; w: number; wv: number; s: number; a: number; rise: number; }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; ring: boolean; }
interface Cloud { img: HTMLCanvasElement; x: number; y: number; v: number; o: number; w: number; h: number; }

const TAU = 6.283185;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const cv = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
  return Math.sqrt(ex * ex + ey * ey);
}

const fract = (n: number) => n - Math.floor(n);
const hash = (i: number, seed: number) => fract(Math.sin(i * 127.1 + seed * 311.7) * 43758.5453);
/** Smooth 1-D value noise — cheap, deterministic, and enough to fake a weathered ridgeline. */
function noise1(x: number, seed: number) {
  const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  const a = hash(i, seed), b = hash(i + 1, seed);
  return a + (b - a) * s;
}
function fbm(x: number, seed: number, oct: number) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * noise1(x * f, seed + i * 19); f *= 2; amp *= 0.5; }
  return v; // ~0..0.94
}

/** Scenery only needs to be repainted ~20 times a second; bubbles repaint every frame. */
const BG_INTERVAL = 0.05;

/** Scenery, endless bubble stream, pop effects and hand dot. Lives outside React so frames never re-render the UI. */
export class Field {
  bubbles: Bubble[] = []; sparks: Spark[] = [];
  W = 0; H = 0; calm = false; onPop?: (size: number) => void;
  private nextSpawn = 0;
  private bg: HTMLCanvasElement | null = null; private gb: CanvasRenderingContext2D | null = null;
  private bs = 1; private lastBg = -1;
  private sky: HTMLCanvasElement | null = null; private terrain: HTMLCanvasElement | null = null;
  private clouds: Cloud[] = [];
  private sprites: HTMLCanvasElement[] = []; private hl: HTMLCanvasElement | null = null;
  private target = { x: 0, y: 0, on: false };
  private p = { x: 0, y: 0, vx: 0, vy: 0, on: false, a: 0 };

  private get goal() { return this.W < 600 ? 16 : 24; }

  /**
   * Sky, clouds and hills go to their own opaque canvas underneath the bubbles.
   * Nothing there moves fast, so it is repainted at 20 fps instead of every frame —
   * that removes six full-screen composites per frame (the old main cost).
   */
  attach(bg: HTMLCanvasElement) {
    this.bg = bg;
    this.gb = bg.getContext("2d", { alpha: false });
    this.lastBg = -1;
  }

  private make(initial: boolean): Bubble {
    const sc = Math.min(Math.max(Math.min(this.W, this.H) / 900, 0.6), 1.3);
    const r = (20 + Math.pow(Math.random(), 1.6) * 56) * sc;
    return { x: rnd(r, this.W - r), y: initial ? rnd(this.H * 0.05, this.H * 0.9) : this.H - r - rnd(0, this.H * 0.1), r,
      vx: 0, vy: 0, ph: rnd(0, TAU), w: 0, wv: 0, s: Math.floor(Math.random() * 6), a: initial ? 1 : 0, rise: rnd(14, 32) + 40 / Math.sqrt(r) };
  }

  resize(w: number, h: number, dpr = 1) {
    const bs = Math.max(0.5, Math.min(dpr, 1.25)); // scenery never needs more than 1.25 device pixels
    const pw = Math.ceil(w * bs), ph = Math.ceil(h * bs);
    const moved = w !== this.W || h !== this.H;
    this.W = w; this.H = h; this.bs = bs;
    if (!this.sprites.length) this.buildSprites();
    if (!this.clouds.length) this.buildClouds();
    if (this.bg && this.gb && (!this.sky || this.bg.width !== pw || this.bg.height !== ph)) {
      this.bg.width = pw; this.bg.height = ph; // also clears the canvas
      this.buildScenery(bs);
      this.lastBg = -1;
    }
    if (!this.bubbles.length) for (let i = 0; i < this.goal; i++) this.bubbles.push(this.make(true));
    else if (moved) for (const b of this.bubbles) {
      b.x = Math.min(Math.max(b.x, b.r), Math.max(b.r, w - b.r));
      b.y = Math.min(Math.max(b.y, b.r), Math.max(b.r, h - b.r));
    }
  }

  private buildClouds() {
    for (let i = 0; i < 6; i++) {
      const far = i < 2; // high, small, slow and faint behind the near weather
      const s = far ? rnd(0.3, 0.55) : rnd(0.62, 1.05);
      const w = 560 * s, h = 280 * s;
      this.clouds.push({
        img: this.cloudSprite(),
        x: rnd(-w, this.W),
        y: far ? rnd(-h * 0.25, this.H * 0.18) : rnd(-h * 0.15, this.H * 0.34 - h * 0.4),
        v: far ? rnd(1.2, 2.6) : rnd(3.5, 7.5),
        o: far ? rnd(0.22, 0.38) : rnd(0.45, 0.72),
        w, h,
      });
    }
  }

  /** Cumulus: puffs lit from above, cool grey underside, soft evaporating edges. */
  private cloudSprite() {
    const w = 560, h = 280, c = cv(w, h), g = c.getContext("2d")!;
    const n = 26;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), arch = Math.sin(Math.PI * t);
      const cx = w * (0.14 + 0.72 * t) + rnd(-16, 16);
      const cy = h * (0.70 - 0.30 * arch) + rnd(-9, 9);
      const r = h * (0.13 + 0.20 * arch) * rnd(0.85, 1.2);
      const rg = g.createRadialGradient(cx - r * 0.16, cy - r * 0.42, r * 0.06, cx, cy, r);
      rg.addColorStop(0, "rgba(255,255,255,0.92)");
      rg.addColorStop(0.5, "rgba(250,252,255,0.62)");
      rg.addColorStop(0.82, "rgba(226,236,248,0.24)");
      rg.addColorStop(1, "rgba(214,228,244,0)");
      g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    }
    // shade the belly, warm the crown — only where there is already cloud
    g.globalCompositeOperation = "source-atop";
    const shade = g.createLinearGradient(0, h * 0.4, 0, h * 0.88);
    shade.addColorStop(0, "rgba(255,255,255,0)");
    shade.addColorStop(1, "rgba(142,168,198,0.36)");
    g.fillStyle = shade; g.fillRect(0, 0, w, h);
    const light = g.createLinearGradient(0, 0, 0, h * 0.52);
    light.addColorStop(0, "rgba(255,253,246,0.5)");
    light.addColorStop(1, "rgba(255,253,246,0)");
    g.fillStyle = light; g.fillRect(0, 0, w, h * 0.52);
    g.globalCompositeOperation = "source-over";
    return c;
  }

  /** Bakes sky and terrain once. Hills never move — only the clouds drift. */
  private buildScenery(bs: number) {
    const W = this.W, H = this.H, pw = Math.ceil(W * bs), ph = Math.ceil(H * bs), horizon = H * 0.72;

    const sky = cv(pw, ph), s = sky.getContext("2d")!;
    s.setTransform(bs, 0, 0, bs, 0, 0);
    const grad = s.createLinearGradient(0, 0, 0, horizon);
    grad.addColorStop(0, "#1f63b6"); grad.addColorStop(0.3, "#3d85d0");
    grad.addColorStop(0.62, "#7cb5e3"); grad.addColorStop(0.85, "#b6d8f0"); grad.addColorStop(1, "#dfeefa");
    s.fillStyle = grad; s.fillRect(0, 0, W, H);

    const sx = W * 0.76, sy = H * 0.15;
    const sun = s.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.52);
    sun.addColorStop(0, "rgba(255,252,238,0.95)");
    sun.addColorStop(0.07, "rgba(255,247,219,0.55)");
    sun.addColorStop(0.28, "rgba(255,241,205,0.16)");
    sun.addColorStop(1, "rgba(255,241,205,0)");
    s.fillStyle = sun; s.fillRect(0, 0, W, H);

    const haze = s.createLinearGradient(0, H * 0.55, 0, horizon + H * 0.02);
    haze.addColorStop(0, "rgba(238,248,255,0)");
    haze.addColorStop(1, "rgba(238,248,255,0.38)");
    s.fillStyle = haze; s.fillRect(0, H * 0.55, W, H * 0.2);
    this.sky = sky;

    // three ridgelines; distance is sold with haze, desaturation and smaller trees
    const t = cv(pw, ph), g = t.getContext("2d")!;
    g.setTransform(bs, 0, 0, bs, 0, 0);
    const layers = [
      { base: 0.640, amp: 0.135, freq: 2.1, seed: 3.7,  top: "#7f9fc6", bot: "#b7cee4", trees: 0,  hgt: 0.020, ink: "" },
      { base: 0.745, amp: 0.080, freq: 2.8, seed: 9.3,  top: "#659287", bot: "#a4c5b2", trees: 24, hgt: 0.028, ink: "rgba(38,78,68,0.6)" },
      { base: 0.870, amp: 0.048, freq: 3.3, seed: 17.1, top: "#47895d", bot: "#7fb877", trees: 18, hgt: 0.045, ink: "rgba(28,72,44,0.75)" },
    ];
    for (const l of layers) {
      const ridge = (x: number) => (l.base - l.amp * ((fbm((x / W) * l.freq * 6, l.seed, 4) - 0.47) * 2.2)) * H;
      const shape = new Path2D();
      shape.moveTo(0, H);
      for (let x = 0; x <= W; x += 3) shape.lineTo(x, ridge(x));
      shape.lineTo(W, H); shape.closePath();
      const gr = g.createLinearGradient(0, (l.base - l.amp) * H, 0, H);
      gr.addColorStop(0, l.top); gr.addColorStop(1, l.bot);
      g.fillStyle = gr; g.fill(shape);

      g.strokeStyle = "rgba(255,255,255,0.22)"; g.lineWidth = 1.6;
      g.beginPath();
      for (let x = 0; x <= W; x += 6) { const y = ridge(x); if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();

      for (let i = 0; i < l.trees; i++) {
        const x = rnd(W * 0.015, W * 0.985), y = ridge(x);
        this.conifer(g, x, y + 1.5, H * l.hgt * rnd(0.7, 1.35), l.ink);
      }
    }
    this.terrain = t;
  }

  /** Layered fir silhouette — reads as a tree line at any size. */
  private conifer(g: CanvasRenderingContext2D, x: number, baseY: number, h: number, ink: string) {
    const w = h * 0.46;
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(x, baseY - h);
    g.lineTo(x + w * 0.20, baseY - h * 0.62); g.lineTo(x + w * 0.10, baseY - h * 0.62);
    g.lineTo(x + w * 0.34, baseY - h * 0.30); g.lineTo(x + w * 0.18, baseY - h * 0.30);
    g.lineTo(x + w * 0.50, baseY); g.lineTo(x - w * 0.50, baseY);
    g.lineTo(x - w * 0.18, baseY - h * 0.30); g.lineTo(x - w * 0.34, baseY - h * 0.30);
    g.lineTo(x - w * 0.10, baseY - h * 0.62); g.lineTo(x - w * 0.20, baseY - h * 0.62);
    g.closePath(); g.fill();
  }

  private buildSprites() {
    const R = 96;
    for (let i = 0; i < 6; i++) {
      const c = cv(200, 200), g = c.getContext("2d")!; g.translate(100, 100);
      const hue = i * 60 + 20;
      const body = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
      body.addColorStop(0, "rgba(255,255,255,0.03)"); body.addColorStop(0.8, "rgba(210,225,255,0.10)"); body.addColorStop(1, "rgba(235,215,255,0.32)");
      g.fillStyle = body; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
      g.lineWidth = 4;
      if (typeof g.createConicGradient === "function") {
        const rim = g.createConicGradient(i, 0, 0);
        for (let j = 0; j <= 4; j++) rim.addColorStop(j / 4, `hsla(${(hue + (j % 4) * 75) % 360},85%,${j % 2 ? 82 : 72}%,0.75)`);
        g.strokeStyle = rim;
      } else g.strokeStyle = "rgba(255,255,255,0.7)";
      g.beginPath(); g.arc(0, 0, R - 2, 0, TAU); g.stroke();
      g.strokeStyle = "rgba(40,80,160,0.22)"; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, R * 0.78, 0.35, 1.1); g.stroke();
      this.sprites.push(c);
    }
    const h = cv(200, 200), g = h.getContext("2d")!; g.translate(100, 100);
    const hx = -R * 0.4, hy = -R * 0.45, gr = g.createRadialGradient(hx, hy, 0, hx, hy, R * 0.36);
    gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.beginPath(); g.ellipse(hx, hy, R * 0.3, R * 0.17, -0.7, 0, TAU); g.fill();
    this.hl = h;
  }

  setTarget(x: number, y: number) { this.target = { x, y, on: true }; }
  release() { this.target.on = false; }

  private pop(b: Bubble) {
    this.sparks.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.5, max: 0.5, r: b.r, ring: true });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + rnd(0, 0.4), s = rnd(70, 220);
      this.sparks.push({ x: b.x + Math.cos(a) * b.r * 0.8, y: b.y + Math.sin(a) * b.r * 0.8, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.7, max: 0.7, r: rnd(1.5, 4), ring: false });
    }
    if (this.sparks.length > 260) this.sparks.splice(0, this.sparks.length - 260); // stay bounded on fast swipes
    this.onPop?.(b.r);
  }

  step(dt: number, t: number) {
    const k = this.calm ? 0.35 : 1, p = this.p, tg = this.target;
    const wind = Math.sin(t * 0.07) * 9 * k;
    for (const c of this.clouds) {
      c.x += (c.v + wind * 0.3) * k * dt;
      if (c.x > this.W + 40) c.x = -c.w - 40;
      else if (c.x < -c.w - 40) c.x = this.W + 40;
    }
    // endless stream: new bubbles rise from the meadow whenever the sky has room
    if (this.bubbles.length < this.goal && t >= this.nextSpawn) { this.bubbles.push(this.make(false)); this.nextSpawn = t + rnd(0.35, 0.9); }
    // hand dot: adaptive smoothing (heavy when still = no jitter, light when fast = no lag)
    const wasOn = p.on, ox = p.x, oy = p.y;
    if (tg.on) {
      if (!wasOn) { p.x = tg.x; p.y = tg.y; p.vx = p.vy = 0; }
      const rate = 7 + Math.min(Math.sqrt(p.vx * p.vx + p.vy * p.vy), 1800) * 0.014;
      const a = 1 - Math.exp(-rate * dt), nx = p.x + (tg.x - p.x) * a, ny = p.y + (tg.y - p.y) * a, m = 1 - Math.exp(-8 * dt);
      p.vx += ((nx - p.x) / dt - p.vx) * m; p.vy += ((ny - p.y) / dt - p.vy) * m; p.x = nx; p.y = ny;
    }
    p.on = tg.on; p.a += ((p.on ? 1 : 0) - p.a) * (1 - Math.exp(-9 * dt));
    const relax = 1 - Math.exp(-1.4 * dt), speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.a = Math.min(1, b.a + dt * 0.8);
      if (p.on && b.a > 0.6) {
        // swept test along the hand's path so fast swipes never skip over a bubble
        if (segDist(wasOn ? ox : p.x, wasOn ? oy : p.y, p.x, p.y, b.x, b.y) < b.r * 0.92) { this.pop(b); this.bubbles.splice(i, 1); continue; }
        const bdx = b.x - p.x, bdy = b.y - p.y, d = Math.sqrt(bdx * bdx + bdy * bdy), reach = b.r + 110;
        if (d < reach) {
          const f = 1 - d / reach;
          b.vx += p.vx * f * f * 3 * k * dt; b.vy += p.vy * f * f * 3 * k * dt;
          b.wv += f * Math.min(speed, 1500) * 0.0016 * k;
        }
      }
      // ease back toward a slow, rising drift (natural damping)
      const tvx = wind + Math.sin(t * 0.31 + b.ph) * 10 * k, tvy = -b.rise * k + Math.cos(t * 0.23 + b.ph * 1.7) * 6 * k;
      b.vx += (tvx - b.vx) * relax; b.vy += (tvy - b.vy) * relax;
      b.wv += (-38 * b.w - 3.2 * b.wv) * dt; b.w = Math.max(-0.2, Math.min(0.2, b.w + b.wv * dt));
      const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy); if (v > 500) { b.vx *= 500 / v; b.vy *= 500 / v; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.5; }
      else if (b.x > this.W - b.r) { b.x = this.W - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
      if (b.y > this.H - b.r) { b.y = this.H - b.r; b.vy = -Math.abs(b.vy) * 0.5; }
      else if (b.y < -b.r) this.bubbles.splice(i, 1); // drifted away above the sky
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]; s.life -= dt;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      const d = Math.exp(-3 * dt); s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= d; s.vy *= d;
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const W = this.W, H = this.H;
    // scenery repaints on its own slow clock, not every frame
    if (this.lastBg < 0 || t - this.lastBg >= BG_INTERVAL) { this.drawBackdrop(); this.lastBg = t; }
    ctx.clearRect(0, 0, W, H);
    this.bubbles.sort((a, c) => a.r - c.r); // back to front, in place (no per-frame copy)
    for (let i = 0; i < this.bubbles.length; i++) this.drawBubble(ctx, this.bubbles[i], t);
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i], q = s.life / s.max;
      ctx.globalAlpha = q;
      if (s.ring) { ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (1 + (1 - q) * 0.35), 0, TAU); ctx.stroke(); }
      else { ctx.fillStyle = "rgba(240,248,255,0.95)"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * q + 0.5, 0, TAU); ctx.fill(); }
    }
    const p = this.p;
    if (p.a > 0.02) { // small dot showing where the hand is
      ctx.globalAlpha = p.a; ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, TAU); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(20,60,140,0.7)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Device-pixel pass over the opaque backdrop: sky, drifting clouds, then static terrain on top. */
  private drawBackdrop() {
    const g = this.gb;
    if (!g) return;
    const PW = g.canvas.width, bs = this.bs;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.sky) g.drawImage(this.sky, 0, 0);
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i], x = c.x * bs, y = c.y * bs, w = c.w * bs, h = c.h * bs;
      if (x + w < 0 || x > PW) continue;
      g.globalAlpha = c.o;
      g.drawImage(c.img, x, y, w, h);
    }
    g.globalAlpha = 1;
    if (this.terrain) g.drawImage(this.terrain, 0, 0); // hills occlude cloud bases, which sells the depth
  }

  private drawBubble(ctx: CanvasRenderingContext2D, b: Bubble, t: number) {
    const sc = b.r / 96, top = Math.max(0, Math.min(1, b.y / (this.H * 0.1)));
    ctx.save(); ctx.globalAlpha = b.a * top;
    ctx.translate(b.x, b.y); ctx.scale(sc * (1 + b.w), sc * (1 - b.w));
    ctx.save(); ctx.rotate(b.ph + t * 0.08); ctx.drawImage(this.sprites[b.s], -100, -100); ctx.restore();
    ctx.drawImage(this.hl!, -100, -100);
    ctx.restore();
  }
}
