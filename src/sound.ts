let ac: AudioContext | null = null;
let on = true;
export const setSound = (v: boolean) => { on = v; };
export function unlockSound() {
  try { ac ??= new AudioContext(); void ac.resume(); } catch { /* sound is optional */ }
}
/** Soft synthesized pop. Smaller bubbles pop a little higher. */
export function playPop(size: number) {
  if (!on || !ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(420 + Math.max(0, 80 - size) * 7 + Math.random() * 90, t);
  o.frequency.exponentialRampToValueAtTime(110, t + 0.09);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.11, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.15);
}
