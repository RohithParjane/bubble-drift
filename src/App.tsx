import { useCallback, useEffect, useRef, useState } from "react";
import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { Field } from "./field";
import { playPop, setSound, unlockSound } from "./sound";
import { createLandmarker, drawHand, palmCenter } from "./hand";

type Status = "idle" | "loading" | "active";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const field = useRef(new Field());
  const stream = useRef<MediaStream | null>(null);
  const landmarker = useRef<HandLandmarker | null>(null);
  const timer = useRef(0);
  const running = useRef(false);
  const handNow = useRef(false);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [tracking, setTracking] = useState(false);
  const [message, setMessage] = useState("");
  const [sound, setSoundOn] = useState(true);

  // render loop (no React state touched per frame)
  useEffect(() => {
    const canvas = canvasRef.current!;
    const bg = bgRef.current!;
    const ctx = canvas.getContext("2d")!;
    const f = field.current;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => { f.calm = mq.matches; };
    f.onPop = playPop;
    f.attach(bg);
    applyMotion(); mq.addEventListener("change", applyMotion);
    // DPR is capped at 1.5: past that the extra pixels cost far more than they show
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      f.resize(innerWidth, innerHeight, dpr);
    };
    // rebuilding the scenery on every resize event is expensive (mobile address bars fire it constantly)
    let rt = 0;
    const resize = () => { clearTimeout(rt); rt = window.setTimeout(fit, 160); };
    fit(); addEventListener("resize", resize);
    let raf = 0, last = performance.now(), sdt = 1 / 60;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) { last = now; return; }
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      sdt += (dt - sdt) * 0.15; // smoothed frame time removes micro-jitter
      const t = now / 1000;
      f.step(sdt, t); f.draw(ctx, t);
    };
    const wake = () => { last = performance.now(); };
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(rt); removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", wake);
      mq.removeEventListener("change", applyMotion);
    };
  }, []);

  const stopCamera = useCallback((note = "") => {
    running.current = false; clearTimeout(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    landmarker.current?.close(); landmarker.current = null;
    handNow.current = false; field.current.release(); drawHand(overlayRef.current, null);
    setTracking(false); setStatus("idle"); setMessage(note);
  }, []);

  const startCamera = useCallback(async () => {
    if (status !== "idle") return;
    setStatus("loading"); setMessage("Allow camera access to move bubbles with your hand.");
    if (!navigator.mediaDevices?.getUserMedia) {
      stopCamera("Camera isn't available in this browser. Mouse and touch still work."); return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 } }, audio: false,
      });
    } catch (e) {
      const n = (e as DOMException).name;
      stopCamera(n === "NotAllowedError" || n === "SecurityError"
        ? "Camera access was blocked. Allow it in your browser settings, or use mouse and touch."
        : n === "NotFoundError" || n === "OverconstrainedError"
        ? "No camera found. Mouse and touch still work."
        : "The camera couldn't start. Another app may be using it. Mouse and touch still work.");
      return;
    }
    try {
      const video = videoRef.current!;
      video.srcObject = stream.current; await video.play();
      setMessage("Loading hand tracking…");
      landmarker.current = await createLandmarker();
    } catch {
      stopCamera("Hand tracking couldn't load. Check your connection, or use mouse and touch."); return;
    }
    if (!stream.current) return; // stopped while loading
    running.current = true; setStatus("active"); setMessage("");
    let lastTime = -1, lastSeen = 0, ema = 12;
    const tick = () => {
      if (!running.current) return;
      const v = videoRef.current!, lm = landmarker.current!;
      const now = performance.now();
      if (!document.hidden && v.readyState >= 2 && v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        const t0 = performance.now();
        let res: HandLandmarkerResult | null = null;
        try { res = lm.detectForVideo(v, now); } catch { /* skip a bad frame; keep the loop alive */ }
        ema += (performance.now() - t0 - ema) * 0.2; // real inference cost, smoothed
        const pt = res ? palmCenter(res) : null;
        drawHand(overlayRef.current, pt ? res : null);
        if (pt) {
          lastSeen = now; handNow.current = true;
          // mirrored; the central 70% of the camera view covers the whole screen so edges are easy to reach
          const k = (n: number) => Math.min(1, Math.max(0, (n - 0.5) * 1.4 + 0.5));
          field.current.setTarget(k(1 - pt.x) * innerWidth, k(pt.y) * innerHeight);
        } else if (now - lastSeen > 350) { handNow.current = false; field.current.release(); }
        setTracking((s) => (s === handNow.current ? s : handNow.current));
      }
      // infer less often when a frame is expensive — the scene stays at 60 fps instead of stalling behind the model
      timer.current = window.setTimeout(tick, Math.max(48, Math.min(140, Math.round(ema * 3))));
    };
    tick();
  }, [status, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const onMove = (e: React.PointerEvent) => {
    if (!started || handNow.current) return;
    field.current.setTarget(e.clientX, e.clientY);
  };
  const onLeave = () => { if (!handNow.current) field.current.release(); };

  const begin = () => { unlockSound(); setStarted(true); void startCamera(); };

  return (
    <main className="stage" onPointerMove={onMove} onPointerDown={onMove}
      onPointerUp={(e) => e.pointerType === "touch" && onLeave()} onPointerLeave={onLeave}>
      <canvas ref={bgRef} className="bg" aria-hidden="true" />
      <canvas ref={canvasRef} aria-label="Floating soap bubbles" role="img" />
      <div className={status === "idle" ? "preview hidden" : "preview"} aria-label="Live camera preview">
        <video ref={videoRef} playsInline muted />
        <canvas ref={overlayRef} width={240} height={180} />
      </div>

      {!started && (
        <section className="intro">
          <h1>Bubble Drift</h1>
          <p className="sub">Move gently. Let everything flow.</p>
          <button className="primary" onClick={begin}>Start Experience</button>
          <button className="quiet" onClick={() => { unlockSound(); setStarted(true); }}>Continue with mouse or touch</button>
          <p className="note">Touch a bubble with the dot to pop it. Your camera is only used when you press Start. Frames are processed
            on this device — nothing is recorded, saved or uploaded.</p>
        </section>
      )}

      {started && (
        <footer className="bar">
          {status === "active" && (
            <span className="live" aria-live="polite">
              <i className={tracking ? "dot on" : "dot"} />
              {tracking ? "Camera on · hand found" : "Camera on · show your palm"}
            </span>
          )}
          {status === "loading" && <span className="live">Starting camera…</span>}
          <div className="btns">
            <button className="quiet" aria-pressed={sound} onClick={() => { setSoundOn(!sound); setSound(!sound); }}>
              Sound {sound ? "on" : "off"}
            </button>
            {status === "active" || status === "loading"
              ? <button className="quiet" onClick={() => stopCamera("Camera stopped.")}>Stop Camera</button>
              : <button className="quiet" onClick={startCamera}>Use camera</button>}
          </div>
        </footer>
      )}
      {message && <p className="toast" role="status">{message}</p>}
    </main>
  );
}
