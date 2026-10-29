interface Bubble { x: number; y: number; r: number; vx: number; vy: number; ph: number; w: number; wv: number; s: number; a: number; rise: number; }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; ring: boolean; }
interface Cloud { img: HTMLCanvasElement; x: number; y: number; v: number; o: number; s: number; }
interface Land { img: HTMLCanvasElement; v: number; }

const TAU = 6.283185;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const cv = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Scenery, endless bubble stream, pop effects and hand dot. Lives outside React so frames never re-render the UI. */
export class Field {
  bubbles: Bubble[] = []; sparks: Spark[] = [];
  W = 0; H = 0; calm = false; onPop?: (size: number) => void;
  private clock = 0; private nextSpawn = 0;
  private sky: HTMLCanvasElement | null = null; private land: Land[] = []; private clouds: Cloud[] = [];
  private sprites: HTMLCanvasElement[] = []; private hl: HTMLCanvasElement | null = null;
  private target = { x: 0, y: 0, on: false };
  private p = { x: 0, y: 0, vx: 0, vy: 0, on: false, a: 0 };

  private get goal() { return this.W < 600 ? 16 : 24; }

  private make(initial: boolean): Bubble {
    const sc = Math.min(Math.max(Math.min(this.W, this.H) / 900, 0.6), 1.3);
    const r = (20 + Math.pow(Math.random(), 1.6) * 56) * sc;
    return { x: rnd(r, this.W - r), y: initial ? rnd(this.H * 0.05, this.H * 0.9) : this.H - r - rnd(0, this.H * 0.1), r,
      vx: 0, vy: 0, ph: rnd(0, TAU), w: 0, wv: 0, s: Math.floor(Math.random() * 6), a: initial ? 1 : 0, rise: rnd(14, 32) + 40 / Math.sqrt(r) };
  }

  resize(w: number, h: number, dpr = 1) {
    this.W = w; this.H = h;
    if (!this.sprites.length) this.buildSprites();
    if (!this.clouds.length) for (let i = 0; i < 8; i++) {
      const s = rnd(0.5, 1.5);
      this.clouds.push({ img: this.cloudSprite(), x: rnd(0, w), y: rnd(-40, h * 0.55), v: rnd(4, 10) * s, o: 0.3 + s * 0.3, s });
    }
    this.buildScenery(dpr);
    if (!this.bubbles.length) for (let i = 0; i < this.goal; i++) this.bubbles.push(this.make(true));
  }

  private cloudSprite() {
    const c = cv(520, 220), g = c.getContext("2d")!;
    for (let i = 0; i < 11; i++) {
      const cx = 520 * rnd(0.18, 0.82), cy = 220 * rnd(0.46, 0.74), r = 220 * rnd(0.22, 0.52);
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, "rgba(255,255,255,0.95)"); rg.addColorStop(0.55, "rgba(255,255,255,0.55)"); rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    }
    return c;
  }

  private buildScenery(dpr: number) {
    const W = Math.round(this.W * dpr), H = Math.round(this.H * dpr);
    const c = cv(W, H), g = c.getContext("2d")!;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#2a74cf"); sky.addColorStop(0.5, "#6fb2ec"); sky.addColorStop(0.75, "#cfe8fa"); sky.addColorStop(1, "#e6f3fb");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const sun = g.createRadialGradient(W * 0.8, H * 0.15, 0, W * 0.8, H * 0.15, Math.max(W, H) * 0.55);
    sun.addColorStop(0, "rgba(255,250,228,0.95)"); sun.addColorStop(0.12, "rgba(255,244,210,0.5)"); sun.addColorStop(1, "rgba(255,244,210,0)");
    g.fillStyle = sun; g.fillRect(0, 0, W, H);
    this.sky = c;
    // three seamless hill layers (integer sine periods tile perfectly); trees on the nearer two
    const cfg = [
      { base: 0.70, amp: 0.06, v: 5, top: "#a7c3e3", bot: "#d3e4f2", k: [2, 5], trees: 0 },
      { base: 0.79, amp: 0.05, v: 12, top: "#7fb0a8", bot: "#b8d9c9", k: [3, 7], trees: 14 },
      { base: 0.89, amp: 0.045, v: 26, top: "#58986b", bot: "#8cc488", k: [4, 9], trees: 10 },
    ];
    this.land = cfg.map((l) => {
      const img = cv(W, H), x = img.getContext("2d")!;
      const p0 = rnd(0, TAU), p1 = rnd(0, TAU);
      const yAt = (px: number) => (l.base + l.amp * (0.6 * Math.sin((TAU * l.k[0] * px) / W + p0) + 0.4 * Math.sin((TAU * l.k[1] * px) / W + p1))) * H;
      const gr = x.createLinearGradient(0, (l.base - l.amp) * H, 0, H);
      gr.addColorStop(0, l.top); gr.addColorStop(1, l.bot);
      x.fillStyle = gr; x.beginPath(); x.moveTo(0, H);
      for (let px = 0; px <= W; px += 4) x.lineTo(px, yAt(px));
      x.lineTo(W, H); x.closePath(); x.fill();
      x.fillStyle = "rgba(30,90,60,0.55)";
      for (let i = 0; i < l.trees; i++) {
        const tx = rnd(W * 0.03, W * 0.97), ty = yAt(tx), th = H * rnd(0.03, 0.05) * (l.v > 20 ? 1.3 : 0.9);
        x.beginPath(); x.ellipse(tx, ty - th * 0.6, th * 0.38, th * 0.62, 0, 0, TAU); x.fill();
      }
      return { img, v: l.v };
    });
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
    this.onPop?.(b.r);
  }

  step(dt: number, t: number) {
    this.clock = t;
    const k = this.calm ? 0.35 : 1, p = this.p, tg = this.target;
    const wind = Math.sin(t * 0.07) * 9 * k;
    for (const c of this.clouds) { c.x += (c.v + wind * 0.3) * k * dt; if (c.x > this.W + 40) c.x = -520 * c.s; if (c.x < -520 * c.s - 40) c.x = this.W; }
    // endless stream: new bubbles rise from the meadow whenever the sky has room
    if (this.bubbles.length < this.goal && t >= this.nextSpawn) { this.bubbles.push(this.make(false)); this.nextSpawn = t + rnd(0.35, 0.9); }
    // hand dot: adaptive smoothing (heavy when still = no jitter, light when fast = no lag)
    const wasOn = p.on, ox = p.x, oy = p.y;
    if (tg.on) {
      if (!wasOn) { p.x = tg.x; p.y = tg.y; p.vx = p.vy = 0; }
      const rate = 7 + Math.min(Math.hypot(p.vx, p.vy), 1800) * 0.014;
      const a = 1 - Math.exp(-rate * dt), nx = p.x + (tg.x - p.x) * a, ny = p.y + (tg.y - p.y) * a, m = 1 - Math.exp(-8 * dt);
      p.vx += ((nx - p.x) / dt - p.vx) * m; p.vy += ((ny - p.y) / dt - p.vy) * m; p.x = nx; p.y = ny;
    }
    p.on = tg.on; p.a += ((p.on ? 1 : 0) - p.a) * (1 - Math.exp(-9 * dt));
    const relax = 1 - Math.exp(-1.4 * dt);
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.a = Math.min(1, b.a + dt * 0.8);
      if (p.on && b.a > 0.6) {
        // swept test along the hand's path so fast swipes never skip over a bubble
        if (segDist(wasOn ? ox : p.x, wasOn ? oy : p.y, p.x, p.y, b.x, b.y) < b.r * 0.92) { this.pop(b); this.bubbles.splice(i, 1); continue; }
        const d = Math.hypot(b.x - p.x, b.y - p.y), reach = b.r + 110;
        if (d < reach) {
          const f = 1 - d / reach;
          b.vx += p.vx * f * f * 3 * k * dt; b.vy += p.vy * f * f * 3 * k * dt;
          b.wv += f * Math.min(Math.hypot(p.vx, p.vy), 1500) * 0.0016 * k;
        }
      }
      // ease back toward a slow, rising drift (natural damping)
      const tvx = wind + Math.sin(t * 0.31 + b.ph) * 10 * k, tvy = -b.rise * k + Math.cos(t * 0.23 + b.ph * 1.7) * 6 * k;
      b.vx += (tvx - b.vx) * relax; b.vy += (tvy - b.vy) * relax;
      b.wv += (-38 * b.w - 3.2 * b.wv) * dt; b.w = Math.max(-0.2, Math.min(0.2, b.w + b.wv * dt));
      const v = Math.hypot(b.vx, b.vy); if (v > 500) { b.vx *= 500 / v; b.vy *= 500 / v; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.5; }
      if (b.x > this.W - b.r) { b.x = this.W - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
      if (b.y > this.H - b.r) { b.y = this.H - b.r; b.vy = -Math.abs(b.vy) * 0.5; }
      if (b.y < -b.r) this.bubbles.splice(i, 1); // drifted away above the sky
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]; s.life -= dt;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      const d = Math.exp(-3 * dt); s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= d; s.vy *= d;
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const W = this.W, H = this.H, k = this.calm ? 0.35 : 1;
    if (this.sky) ctx.drawImage(this.sky, 0, 0, W, H); else ctx.clearRect(0, 0, W, H);
    for (const c of this.clouds) { ctx.globalAlpha = c.o; ctx.drawImage(c.img, c.x, c.y, 520 * c.s, 220 * c.s); }
    ctx.globalAlpha = 1;
    for (const l of this.land) { // parallax: nearer hills scroll faster; wrap seamlessly
      const off = (t * l.v * k) % W;
      ctx.drawImage(l.img, -off, 0, W, H); ctx.drawImage(l.img, W - off, 0, W, H);
    }
    for (const b of [...this.bubbles].sort((a, c) => a.r - c.r)) this.drawBubble(ctx, b, t);
    for (const s of this.sparks) {
      const q = s.life / s.max; ctx.globalAlpha = q;
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

  private drawBubble(ctx: CanvasRenderingContext2D, b: Bubble, t: number) {
    const sc = b.r / 96, top = Math.max(0, Math.min(1, b.y / (this.H * 0.1)));
    ctx.save(); ctx.globalAlpha = b.a * top;
    ctx.translate(b.x, b.y); ctx.scale(sc * (1 + b.w), sc * (1 - b.w));
    ctx.save(); ctx.rotate(b.ph + t * 0.08); ctx.drawImage(this.sprites[b.s], -100, -100); ctx.restore();
    ctx.drawImage(this.hl!, -100, -100);
    ctx.restore();
  }
}
