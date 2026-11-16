import { haversine, toLatLng, type LatLng } from './geo';

export type WalkController = { stop: () => void };

/**
 * 주어진 경로를 따라 걸은 것처럼 점을 찍는다.
 * speed: m/s (실제 보행 1.4m/s, 데모는 배속)
 */
export function walkAlongPath(
  path: LatLng[],
  opts: { speed: number; onPoint: (p: LatLng) => void; onDone?: () => void },
): WalkController {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
  const total = cum[cum.length - 1] ?? 0;

  let raf = 0;
  let travelled = 0;
  let last = performance.now();
  let stopped = false;
  let idx = 0;

  const tick = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.12, (now - last) / 1000);
    last = now;
    travelled += opts.speed * dt;

    while (idx < path.length - 1 && cum[idx + 1] <= travelled) idx++;
    const segStart = cum[Math.min(idx, cum.length - 1)];
    const segEnd = cum[Math.min(idx + 1, cum.length - 1)] ?? segStart;
    const span = segEnd - segStart;
    const t = span > 0 ? Math.min(1, (travelled - segStart) / span) : 0;
    const a = path[Math.min(idx, path.length - 1)];
    const b = path[Math.min(idx + 1, path.length - 1)] ?? a;
    opts.onPoint({
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
    });

    if (travelled >= total || idx >= path.length - 1) {
      stopped = true;
      cancelAnimationFrame(raf);
      opts.onDone?.();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}

/** 실내 데모용: 중심 주변을 한 바퀴 도는 자연스러운 루프 경로 */
export function makeLoop(center: LatLng, spanMeters: number): LatLng[] {
  const n = 240;
  const r0 = Math.max(40, spanMeters) / 2;
  const p1 = Math.random() * Math.PI * 2;
  const p2 = Math.random() * Math.PI * 2;
  const p3 = Math.random() * Math.PI * 2;
  const pts: LatLng[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r =
      r0 *
      (0.8 +
        0.14 * Math.sin(3 * a + p1) +
        0.09 * Math.cos(5 * a + p2) +
        0.06 * Math.sin(2 * a + p3));
    pts.push(toLatLng({ x: Math.cos(a) * r, y: Math.sin(a) * r }, center));
  }
  return pts;
}
