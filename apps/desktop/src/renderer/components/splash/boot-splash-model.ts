/** Geometry and timing of the approved monochrome, 120-degree startup reveal. */
export const SPLASH_REVEAL_MS = 1520;
export const SPLASH_VISIBLE_MS = 1760;
export const SPLASH_FADE_MS = 160;
export const SPLASH_FLATTENED_HOLD_MS = 320;

export interface SplashRay {
  readonly left: number;
  readonly top: number;
  readonly length: number;
  readonly thickness: number;
  readonly delayMs: number;
}

export function buildSplashRays(width: number, height: number): readonly SplashRay[] {
  const normalX = Math.sqrt(3) / 2;
  const spacing = (normalX * width + height * 0.5) / 5;
  const start = -width * 0.7;
  const end = normalX * height + width * 0.2;
  return [3, 2, 4, 1, 0].map((lane, sequence) => {
    const across = (lane + 0.5) * spacing;
    return {
      left: normalX * across - start * 0.5,
      top: across * 0.5 + normalX * start,
      length: end - start,
      thickness: spacing * 0.42,
      delayMs: 300 + sequence * 80,
    };
  });
}

export function splashVisibleMs(flattened: boolean): number {
  return flattened ? SPLASH_FLATTENED_HOLD_MS : SPLASH_VISIBLE_MS;
}
