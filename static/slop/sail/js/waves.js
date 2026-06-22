// waves.js — the shared wave spectrum (one source of truth for the GPU visual
// surface AND the CPU buoyancy). Wind angle drives every wave direction.

export const G = 9.8;

export const WIND_ANGLE = 2.5;   // radians — single source of truth for wind AND wave heading

// dominant swell stays aligned (no crossed bands); the small, low-amplitude chop
// fans out widely to break up the parallel "corduroy" look with organic texture
export const WAVE_DEFS = [
  { L: 26.0, A: 0.46, spread:  0.00 },
  { L: 17.0, A: 0.28, spread:  0.10 },
  { L: 11.0, A: 0.18, spread: -0.28 },
  { L: 7.0,  A: 0.12, spread:  0.40 },
  { L: 4.6,  A: 0.07, spread: -0.52 },
  { L: 3.0,  A: 0.045, spread: 0.66 },
  { L: 2.0,  A: 0.03, spread: -0.80 },
];

export const STEEP = 0.72;

// Build runtime wave params from the defs. Directions derive from windAngle + spread,
// so wind and wave heading are guaranteed coherent.
export function precomputeWaves(defs, windAngle) {
  windAngle = windAngle || 0;
  const n = defs.length;
  return defs.map(d => {
    const a = windAngle + d.spread;
    const dx = Math.cos(a), dz = Math.sin(a);
    const k = (2 * Math.PI) / d.L;
    const w = Math.sqrt(G * k);
    const Q = Math.min(1.0, STEEP / (k * d.A * n));
    const phase = (d.L * 12.9898) % (2 * Math.PI);
    return { dx, dz, A: d.A, k, w, Q, phase };
  });
}

// CPU height sample (vertical only; plenty for buoyancy).
export function waveHeight(waves, x, z, t) {
  let y = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const ph = w.k * (w.dx * x + w.dz * z) - w.w * t + w.phase;
    y += w.A * Math.sin(ph);
  }
  return y;
}
