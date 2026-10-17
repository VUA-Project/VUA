/** Animated 2D interiors of the factory rooms, drawn on canvas in a 400 × 190 scene space.
 * Every draw is a pure function of time and room facts, so a paused scene is one still frame. */
import type { StationKey, StationState } from "./factory-model.ts";

export interface Palette {
  room: string; panel: string; elevated: string; border: string; strong: string; text: string; muted: string;
  success: string; warning: string; error: string; accent: string; skin: string; hair: string;
}
export interface SceneFacts {
  recipes: number; packages: number; image: HTMLImageElement | null;
  stations: readonly { key: StationKey; label: string; state: StationState }[] | null; running: boolean;
}
export const SCENE_WIDTH = 400;
export const SCENE_HEIGHT = 190;
/** Scenes draw in a 400 × 190 space aligned to the room's bottom; `top` is the room's top edge in that space (0 or above). */
type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
function fillRect(ctx: Ctx, color: string, x: number, y: number, w: number, h: number, r = 0) {
  ctx.fillStyle = color; if (r) { rr(ctx, x, y, w, h, r); ctx.fill(); } else ctx.fillRect(x, y, w, h);
}
function alpha(ctx: Ctx, value: number, draw: () => void) { const previous = ctx.globalAlpha; ctx.globalAlpha = previous * value; draw(); ctx.globalAlpha = previous; }
/** Deterministic noise so shelves and sparks keep their shape between frames. */
function hash(n: number) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

/** A small worker in the factory's colors; bob and arm swing come from time. */
function worker(ctx: Ctx, p: Palette, x: number, y: number, t: number, pose: "stand" | "sit" | "walk" | "type", facing = 1, scale = 1) {
  const bob = pose === "walk" ? Math.abs(Math.sin(t * 8)) * 1.6 : Math.sin(t * 2.2) * 0.6;
  ctx.save(); ctx.translate(x, y - bob); ctx.scale(facing * scale, scale);
  const leg = pose === "walk" ? Math.sin(t * 8) * 3 : 0;
  ctx.strokeStyle = p.strong; ctx.lineWidth = 2.4; ctx.lineCap = "round";
  if (pose !== "sit" && pose !== "type") { ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(-2 - leg, 0); ctx.moveTo(2, -8); ctx.lineTo(2 + leg, 0); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(4, -8); ctx.lineTo(4, -1); ctx.stroke(); }
  fillRect(ctx, p.room, -5, -20, 10, 13, 3);
  const arm = pose === "type" ? Math.sin(t * 14) * 1.2 : pose === "walk" ? -leg * 0.8 : Math.sin(t * 1.5) * 1.5;
  ctx.strokeStyle = p.room; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(3, -17); ctx.lineTo(pose === "type" ? 9 : 5, pose === "type" ? -12 + arm : -9 + arm); ctx.stroke();
  ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(0, -26, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.hair; ctx.beginPath(); ctx.arc(0, -28, 6.4, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  ctx.fillRect(-6.4, -28.5, 3, 5);
  ctx.restore();
}

function floor(ctx: Ctx, p: Palette) {
  fillRect(ctx, p.elevated, 0, 176, SCENE_WIDTH, 14);
  ctx.strokeStyle = p.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 176); ctx.lineTo(SCENE_WIDTH, 176); ctx.stroke();
  alpha(ctx, 0.5, () => { for (let x = 0; x < SCENE_WIDTH; x += 40) { ctx.beginPath(); ctx.moveTo(x, 176); ctx.lineTo(x - 12, 190); ctx.stroke(); } });
}
function ceilingLights(ctx: Ctx, p: Palette, xs: readonly number[], t: number, top: number) {
  fillRect(ctx, p.elevated, 0, top, SCENE_WIDTH, 6);
  for (const [i, x] of xs.entries()) {
    fillRect(ctx, p.border, x - 1, top, 2, 8 - top); fillRect(ctx, p.strong, x - 12, 8, 24, 4, 2);
    alpha(ctx, 0.07 + 0.02 * Math.sin(t * 1.3 + i), () => { ctx.fillStyle = p.room; ctx.beginPath(); ctx.moveTo(x - 12, 12); ctx.lineTo(x + 12, 12); ctx.lineTo(x + 46, 176); ctx.lineTo(x - 46, 176); ctx.fill(); });
  }
}

export function drawControl(ctx: Ctx, p: Palette, f: SceneFacts, t: number, top: number) {
  ceilingLights(ctx, p, [80, 320], t, top);
  // Wall display: the Recipe graph, drifting gently.
  fillRect(ctx, p.border, 108, 14, 184, 86, 4); fillRect(ctx, p.panel, 111, 17, 178, 80, 3);
  const count = Math.max(3, Math.min(9, f.recipes + 3));
  const nodes = Array.from({ length: count }, (_, i) => ({
    x: 200 + Math.cos(i * 2.4 + t * 0.25) * (22 + 46 * hash(i)), y: 57 + Math.sin(i * 1.7 + t * 0.3) * (8 + 22 * hash(i + 9)),
  }));
  ctx.strokeStyle = p.room; ctx.lineWidth = 1;
  alpha(ctx, 0.6, () => { for (let i = 1; i < count; i++) { const a = nodes[i]!; const b = nodes[Math.floor(hash(i + 3) * i)]!; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } });
  for (const [i, n] of nodes.entries()) { ctx.fillStyle = i < Math.min(f.recipes, count) ? p.room : p.muted; ctx.beginPath(); ctx.arc(n.x, n.y, i === 0 ? 5 : 3.5, 0, Math.PI * 2); ctx.fill(); }
  // Server rack with blinking lights.
  fillRect(ctx, p.elevated, 14, 60, 34, 116, 3); ctx.strokeStyle = p.border; ctx.strokeRect(14.5, 60.5, 33, 115);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 3; c++) {
    const on = hash(r * 7 + c + Math.floor(t * 3 + r)) > 0.45;
    fillRect(ctx, on ? (c === 2 ? p.success : p.room) : p.border, 20 + c * 9, 68 + r * 13, 5, 3, 1);
  }
  // Desks, monitors with scrolling text, operators at work.
  for (const [i, x] of [70, 172, 274].entries()) {
    fillRect(ctx, p.strong, x + 22, 116, 4, 12); fillRect(ctx, p.border, x, 98, 48, 30, 3);
    fillRect(ctx, p.panel, x + 2, 100, 44, 26, 2);
    ctx.save(); rr(ctx, x + 2, 100, 44, 26, 2); ctx.clip();
    for (let l = 0; l < 6; l++) { const y = 104 + ((l * 5 - t * 6 * (1 + i * 0.3)) % 30 + 30) % 30; fillRect(ctx, l % 3 === 0 ? p.room : p.muted, x + 6, y, 10 + hash(l + i * 10) * 26, 2, 1); }
    ctx.restore();
    fillRect(ctx, p.text, x - 10, 136, 76, 5, 2); fillRect(ctx, p.border, x - 6, 141, 3, 35); fillRect(ctx, p.border, x + 59, 141, 3, 35);
    worker(ctx, p, x + 28, 160, t + i, "type", -1);
    fillRect(ctx, p.border, x + 20, 156, 20, 4, 2); fillRect(ctx, p.border, x + 28, 160, 3, 16);
  }
  floor(ctx, p);
}

export function drawMaterials(ctx: Ctx, p: Palette, f: SceneFacts, t: number, top: number) {
  ceilingLights(ctx, p, [110, 290], t, top);
  const boxes = Math.min(Math.max(f.packages, 0), 30);
  let placed = 0;
  for (const [u, x] of [18, 142, 266].entries()) {
    fillRect(ctx, p.strong, x, Math.min(20, top + 10), 4, 156 - Math.min(0, top - 10)); fillRect(ctx, p.strong, x + 112, Math.min(20, top + 10), 4, 156 - Math.min(0, top - 10));
    for (let s = 0; s < 4; s++) {
      const y = 56 + s * 40; fillRect(ctx, p.text, x, y, 116, 4);
      for (let b = 0; b < 3; b++, placed++) {
        if (placed >= boxes) continue;
        const w = 22 + hash(u * 31 + s * 7 + b) * 10; const h = 16 + hash(u * 11 + s * 3 + b) * 14;
        const bx = x + 10 + b * 34;
        fillRect(ctx, hash(placed) > 0.5 ? p.room : p.elevated, bx, y - h, w, h, 2);
        ctx.strokeStyle = p.border; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y - h + 0.5, w - 1, h - 1);
        fillRect(ctx, p.panel, bx + w / 2 - 4, y - h + 4, 8, 4, 1);
      }
    }
  }
  // A cart rolls along the aisle carrying a crate; a worker restocks a shelf.
  const travel = (Math.sin(t * 0.5) + 1) / 2; const cx = 30 + travel * 300;
  fillRect(ctx, p.elevated, cx, 158, 46, 10, 2); ctx.strokeStyle = p.border; ctx.strokeRect(cx + 0.5, 158.5, 45, 9);
  fillRect(ctx, p.room, cx + 10, 140, 26, 18, 2);
  ctx.fillStyle = p.strong; for (const wx of [cx + 8, cx + 38]) { ctx.beginPath(); ctx.arc(wx, 170, 4, 0, Math.PI * 2); ctx.fill(); }
  worker(ctx, p, cx + 56, 176, t, "walk", Math.cos(t * 0.5) >= 0 ? 1 : -1);
  floor(ctx, p);
}

export function drawRelease(ctx: Ctx, p: Palette, f: SceneFacts, t: number, top: number) {
  // Backdrop and curtains that sway, hung from the room's ceiling.
  fillRect(ctx, p.panel, 0, top, SCENE_WIDTH, 176 - top);
  for (const side of [-1, 1]) {
    ctx.save(); if (side === 1) { ctx.translate(SCENE_WIDTH, 0); ctx.scale(-1, 1); }
    ctx.fillStyle = p.room; alpha(ctx, 0.55, () => {
      ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(64, top);
      for (let y = top; y <= 176; y += 22) ctx.quadraticCurveTo(52 + Math.sin(t * 1.2 + y * 0.05) * 3, y + 11, 56 + Math.sin(y * 0.2) * 4, y + 22);
      ctx.lineTo(0, 176); ctx.fill();
    });
    ctx.restore();
  }
  fillRect(ctx, p.room, 0, top, SCENE_WIDTH, 10);
  // Sweeping spotlights.
  for (const [i, origin] of [120, 280].entries()) {
    const sweep = Math.sin(t * 0.8 + i * 1.6) * 40;
    alpha(ctx, 0.16, () => { ctx.fillStyle = p.room; ctx.beginPath(); ctx.moveTo(origin - 6, top + 10); ctx.lineTo(origin + 6, top + 10); ctx.lineTo(200 + sweep + 52, 158); ctx.lineTo(200 + sweep - 52, 158); ctx.fill(); });
  }
  // Turntable and the finished Avatar.
  const spin = t * 0.9;
  ctx.fillStyle = p.border; ctx.beginPath(); ctx.ellipse(200, 160, 58, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = p.room; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(200, 158, 54, 8.5, 0, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 8; i++) { const a = spin + (i * Math.PI) / 4; ctx.fillStyle = p.room; ctx.beginPath(); ctx.arc(200 + Math.cos(a) * 50, 158 + Math.sin(a) * 7.5, 1.4, 0, Math.PI * 2); ctx.fill(); }
  if (f.image) {
    const h = 132; const w = h * (f.image.naturalWidth / Math.max(1, f.image.naturalHeight));
    const crop = Math.min(f.image.naturalWidth, f.image.naturalHeight * 0.62);
    const sx = (f.image.naturalWidth - crop) / 2;
    ctx.drawImage(f.image, sx, 0, crop, f.image.naturalHeight, 200 - (w * (crop / f.image.naturalWidth)) / 2, 158 - h, w * (crop / f.image.naturalWidth), h);
  } else {
    alpha(ctx, 0.75, () => worker(ctx, p, 200, 158, t * 0.6, "stand", Math.cos(spin) >= 0 ? 1 : -1, 2.6));
  }
  // Sparkles drift up from the stage.
  for (let i = 0; i < 14; i++) {
    const life = (t * 0.35 + hash(i)) % 1; const x = 150 + hash(i + 20) * 100 + Math.sin(t + i) * 6; const y = 158 - life * 130;
    alpha(ctx, (1 - life) * 0.9, () => { ctx.fillStyle = i % 3 === 0 ? p.warning : p.room; ctx.fillRect(x, y, 2, 2); });
  }
  // Stage front.
  ctx.fillStyle = p.elevated; ctx.beginPath(); ctx.moveTo(70, 164); ctx.lineTo(330, 164); ctx.lineTo(356, 190); ctx.lineTo(44, 190); ctx.fill();
  ctx.strokeStyle = p.room; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(70, 164); ctx.lineTo(330, 164); ctx.stroke();
}

export function drawWorkshop(ctx: Ctx, p: Palette, f: SceneFacts, t: number, top: number) {
  ceilingLights(ctx, p, [60, 200, 340], t, top);
  const stations = f.stations ?? [];
  const at = Math.max(0, stations.findIndex(s => ["running", "waiting", "failed"].includes(s.state)));
  const lamp = (state: StationState) => state === "done" ? p.success : state === "running" ? p.accent : state === "waiting" ? p.warning : state === "failed" ? p.error : p.border;
  // Machines with status lamps and a robot arm at the active station.
  for (const [i, s] of stations.entries()) {
    const x = 16 + i * 76;
    fillRect(ctx, s.state === "running" ? p.room : p.border, x, 32, 64, 66, 4); fillRect(ctx, p.elevated, x + 2, 34, 60, 62, 3);
    const blink = s.state === "running" ? 0.55 + 0.45 * Math.sin(t * 6) : 1;
    alpha(ctx, blink, () => fillRect(ctx, lamp(s.state), x + 24, 40, 16, 6, 3));
    ctx.fillStyle = p.text; ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.fillText(s.label, x + 32, 70, 58);
    fillRect(ctx, p.border, x + 28, 98, 8, 40);
    if (i === at && s.state === "running") {
      const swing = Math.sin(t * 3) * 0.5;
      ctx.save(); ctx.translate(x + 32, 98); ctx.rotate(swing); ctx.strokeStyle = p.room; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 22); ctx.lineTo(10, 34); ctx.stroke(); ctx.restore();
      for (let k = 0; k < 6; k++) { const life = (t * 2 + hash(k)) % 1; alpha(ctx, 1 - life, () => { ctx.fillStyle = p.warning; ctx.fillRect(x + 36 + Math.cos(k * 1.3) * life * 16, 132 - life * 14 + Math.sin(k) * 4, 2, 2); }); }
    }
  }
  // Conveyor belt with rollers; crates move while a line runs.
  fillRect(ctx, p.border, 6, 144, 388, 16, 8); fillRect(ctx, p.elevated, 8, 146, 384, 12, 6);
  const shift = f.running ? (t * 22) % 24 : 0;
  ctx.fillStyle = p.muted; for (let x = 14 - shift + 24; x < 390; x += 24) ctx.fillRect(x, 151, 10, 2);
  ctx.fillStyle = p.strong; for (let x = 20; x < 390; x += 40) { ctx.beginPath(); ctx.arc(x, 164, 3, 0, Math.PI * 2); ctx.fill(); }
  if (stations.length) {
    const target = 34 + at * 76; const drift = f.running ? Math.sin(t * 1.5) * 3 : 0;
    fillRect(ctx, p.room, target + drift, 124, 26, 20, 2); ctx.strokeStyle = p.border; ctx.strokeRect(target + drift + 0.5, 124.5, 25, 19);
    for (let i = 0; i < at; i++) { const x = 30 + i * 76; alpha(ctx, 0.35, () => fillRect(ctx, p.room, x, 130, 16, 14, 2)); }
  }
  worker(ctx, p, 350, 176, t, f.running ? "walk" : "stand", -1);
  floor(ctx, p);
}

export const SCENES = { control: drawControl, materials: drawMaterials, release: drawRelease, workshop: drawWorkshop } as const;
