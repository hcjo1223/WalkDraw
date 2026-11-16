import { toLatLng, type LatLng, type XY } from './geo';

/**
 * 도안은 정규화 좌표(-1..1, y축이 북쪽)로 정의한다.
 * 모듈 로드 시 bbox를 [-1,1]에 맞춰 자동 정규화하므로 대충 찍어도 된다.
 */
export type GuideShape = { id: string; name: string; emoji: string; subpaths: XY[][] };
export type Guide = GuideShape & { subpaths: XY[][] };

const P = (x: number, y: number): XY => ({ x, y });

function heartPath(): XY[] {
  const pts: XY[] = [];
  for (let i = 0; i <= 160; i++) {
    const t = (i / 160) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(P(x, y));
  }
  return pts;
}

function starPath(points = 5, inner = 0.44): XY[] {
  const pts: XY[] = [];
  const step = Math.PI / points;
  for (let i = 0; i <= points * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + i * step;
    pts.push(P(Math.cos(a) * r, Math.sin(a) * r));
  }
  return pts;
}

function spiralPath(turns = 2.2): XY[] {
  const pts: XY[] = [];
  const n = 220;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * Math.PI * 2 * turns;
    const r = 0.08 + t * 0.92;
    pts.push(P(Math.cos(a) * r, Math.sin(a) * r));
  }
  return pts;
}

function circlePath(r = 1, n = 96): XY[] {
  const pts: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(P(Math.cos(a) * r, Math.sin(a) * r));
  }
  return pts;
}

/** 강아지 발바닥: 큰 볼록패드 + 발가락 4개 */
function pawPaths(): XY[][] {
  const pad: XY[] = [];
  const toes: XY[][] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    pad.push(P(Math.cos(a) * 0.58, -0.28 + Math.sin(a) * 0.46));
  }
  const toeDefs: [number, number, number][] = [
    [-0.62, 0.34, 0.19],
    [-0.22, 0.58, 0.2],
    [0.22, 0.58, 0.2],
    [0.62, 0.34, 0.19],
  ];
  for (const [cx, cy, r] of toeDefs) {
    const t: XY[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      t.push(P(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    toes.push(t);
  }
  return [pad, ...toes];
}

const HOUSE: XY[] = [
  P(-0.78, -0.62),
  P(-0.78, 0.1),
  P(0, 0.82),
  P(0.78, 0.1),
  P(0.78, -0.62),
  P(-0.78, -0.62),
];

const MOUNTAIN: XY[] = [
  P(-1, -0.55),
  P(-0.46, 0.16),
  P(-0.18, -0.12),
  P(0.2, 0.52),
  P(0.56, 0.06),
  P(1, 0.42),
];

const BOLT: XY[] = [
  P(0.22, 0.95),
  P(-0.42, 0.02),
  P(-0.02, 0.02),
  P(-0.24, -0.95),
  P(0.46, 0.06),
  P(0.06, 0.06),
  P(0.22, 0.95),
];

function normalize(shape: GuideShape): Guide {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const sp of shape.subpaths) {
    for (const p of sp) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const big = Math.max(w, h) || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const k = 2 / big;
  const subpaths = shape.subpaths
    .map((sp) => sp.map((p) => P((p.x - cx) * k, (p.y - cy) * k)))
    // 화면이든 종이든 0.004m 단위 노이즈는 의미 없음 → 너무 가까운 연속 점 정리
    .map((sp) => sp.filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 1e-4));
  return { ...shape, subpaths };
}

export const GUIDES: Guide[] = [
  { id: 'heart', name: '하트', emoji: '💚', subpaths: [heartPath()] },
  { id: 'star', name: '별', emoji: '⭐', subpaths: [starPath()] },
  { id: 'spiral', name: '나선', emoji: '🌀', subpaths: [spiralPath()] },
  { id: 'paw', name: '강아지 발바닥', emoji: '🐾', subpaths: pawPaths() },
  { id: 'circle', name: '원', emoji: '⭕', subpaths: [circlePath()] },
  { id: 'house', name: '집', emoji: '🏠', subpaths: [HOUSE] },
  { id: 'mountain', name: '산', emoji: '⛰️', subpaths: [MOUNTAIN] },
  { id: 'bolt', name: '번개', emoji: '⚡', subpaths: [BOLT] },
].map(normalize);

export function guideById(id: string | null): Guide | null {
  if (!id) return null;
  return GUIDES.find((g) => g.id === id) ?? null;
}

/**
 * 도안을 현재 위치 중심으로 실제 위경도 라인으로 변환.
 * sizeMeters: 그림 전체 가로/세로 중 큰 쪽 길이(m), rotationDeg: 화면 기준 시계방향 회전
 */
export function guideLatLngs(
  guide: Guide,
  center: LatLng,
  sizeMeters: number,
  rotationDeg = 0,
): LatLng[][] {
  const half = sizeMeters / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return guide.subpaths.map((sp) =>
    sp.map((p) => {
      // 화면 기준 시계방향 회전 (수학 좌표계는 반시계가 +)
      const xr = p.x * cos + p.y * sin;
      const yr = -p.x * sin + p.y * cos;
      return toLatLng({ x: xr * half, y: yr * half }, center);
    }),
  );
}

/** 자동 걷기용: 도안 조각들을 이어 붙인 하나의 경로 */
export function guideWalkPath(guide: Guide, center: LatLng, sizeMeters: number): LatLng[] {
  const lines = guideLatLngs(guide, center, sizeMeters, 0);
  const out: LatLng[] = [];
  for (const line of lines) out.push(...line);
  return out;
}
