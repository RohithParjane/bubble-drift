import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from "@mediapipe/tasks-vision";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export async function createLandmarker(): Promise<HandLandmarker> {
  const files = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numHands: 1,
    });
  try {
    return await make("GPU");
  } catch {
    return await make("CPU");
  }
}

/** Approximate palm centre (normalised 0..1): average of wrist + finger base knuckles. */
export function palmCenter(res: HandLandmarkerResult): { x: number; y: number } | null {
  const lm = res.landmarks[0];
  if (!lm) return null;
  const ids = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const i of ids) { x += lm[i].x; y += lm[i].y; }
  return { x: x / ids.length, y: y / ids.length };
}

/** Draws the tracked hand on the small preview canvas (mirrored to match the video). */
export function drawHand(c: HTMLCanvasElement | null, res: HandLandmarkerResult | null) {
  if (!c) return;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  const lm = res?.landmarks[0];
  if (!lm) return;
  const X = (p: { x: number }) => (1 - p.x) * c.width, Y = (p: { y: number }) => p.y * c.height;
  ctx.lineWidth = 2; ctx.strokeStyle = "rgba(200,220,255,0.9)";
  for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
    ctx.beginPath(); ctx.moveTo(X(lm[start]), Y(lm[start])); ctx.lineTo(X(lm[end]), Y(lm[end])); ctx.stroke();
  }
  ctx.fillStyle = "rgba(217,201,255,0.95)";
  for (const p of lm) { ctx.beginPath(); ctx.arc(X(p), Y(p), 3, 0, 6.283); ctx.fill(); }
  const c0 = palmCenter(res!)!;
  ctx.strokeStyle = "#9ff0d2"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(X(c0), Y(c0), 12, 0, 6.283); ctx.stroke();
}
