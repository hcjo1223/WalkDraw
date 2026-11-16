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

const CAT: XY[] = [
  P(-0.7, 0.35),
  P(-0.62, 0.92),
  P(-0.25, 0.55),
  P(0.25, 0.55),
  P(0.62, 0.92),
  P(0.7, 0.35),
  P(0.84, -0.2),
  P(0.45, -0.76),
  P(-0.45, -0.76),
  P(-0.84, -0.2),
  P(-0.7, 0.35),
];

const MOON: XY[] = [
  P(0.25, 0.92),
  P(-0.28, 0.72),
  P(-0.6, 0.28),
  P(-0.62, -0.3),
  P(-0.25, -0.76),
  P(0.35, -0.92),
  P(0.05, -0.52),
  P(-0.05, 0.0),
  P(0.08, 0.52),
  P(0.25, 0.92),
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
  { id: 'cat', name: '고양이', emoji: '🐱', subpaths: [CAT] },
  { id: 'star', name: '별', emoji: '⭐', subpaths: [starPath()] },
  { id: 'moon', name: '달', emoji: '🌙', subpaths: [MOON] },
  { id: 'spiral', name: '나선', emoji: '🌀', subpaths: [spiralPath()] },
  { id: 'paw', name: '발바닥', emoji: '🐾', subpaths: pawPaths() },
  { id: 'circle', name: '원', emoji: '⭕', subpaths: [circlePath()] },
  { id: 'house', name: '집', emoji: '🏠', subpaths: [HOUSE] },
  { id: 'mountain', name: '산', emoji: '⛰️', subpaths: [MOUNTAIN] },
  { id: 'bolt', name: '번개', emoji: '⚡', subpaths: [BOLT] },
].map(normalize);

export function guideById(id: string | null): Guide | null {
  if (!id) return null;
  return GUIDES.find((g) => g.id === id) ?? null;
}

/** 정규화 XY[][] 도형을 위경도 라인으로 변환 */
export function xyGroupsToLatLngs(
  subpaths: XY[][],
  center: LatLng,
  sizeMeters: number,
  rotationDeg = 0,
): LatLng[][] {
  const half = sizeMeters / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return subpaths.map((sp) =>
    sp.map((p) => {
      const xr = p.x * cos + p.y * sin;
      const yr = -p.x * sin + p.y * cos;
      return toLatLng({ x: xr * half, y: yr * half }, center);
    }),
  );
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
  return xyGroupsToLatLngs(guide.subpaths, center, sizeMeters, rotationDeg);
}

/** 자동 걷기용: 도안 조각들을 이어 붙인 하나의 경로 */
export function guideWalkPath(
  guide: Guide,
  center: LatLng,
  sizeMeters: number,
  rotationDeg = 0,
): LatLng[] {
  const lines = guideLatLngs(guide, center, sizeMeters, rotationDeg);
  const out: LatLng[] = [];
  for (const line of lines) out.push(...line);
  return out;
}

export function xyGroupsPerimeterRatio(subpaths: XY[][]): number {
  let sum = 0;
  for (let s = 0; s < subpaths.length; s++) {
    const sp = subpaths[s];
    for (let i = 1; i < sp.length; i++) {
      sum += Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y);
    }
    if (s > 0) {
      const prevEnd = subpaths[s - 1][subpaths[s - 1].length - 1];
      const curStart = sp[0];
      if (prevEnd && curStart) {
        sum += Math.hypot(curStart.x - prevEnd.x, curStart.y - prevEnd.y);
      }
    }
  }
  return Math.max(1, sum * 0.5);
}

/** sizeMeters = 1 일 때 도안 전체 예상 둘레(m) */
export function guidePerimeterRatio(guide: Guide): number {
  return xyGroupsPerimeterRatio(guide.subpaths);
}

export function xyGroupsSizeForDistance(
  subpaths: XY[][],
  targetDistanceM: number,
  detourFactor = 1.2,
): number {
  const ratio = xyGroupsPerimeterRatio(subpaths);
  const raw = targetDistanceM / (ratio * detourFactor);
  const rounded = Math.round(raw / 10) * 10;
  return Math.max(40, Math.min(3000, rounded));
}

/** 목표 도보 거리(m)에 맞춘 도안 크기(m) 계산 */
export function guideSizeForDistance(
  guide: Guide,
  targetDistanceM: number,
  detourFactor = 1.2,
): number {
  return xyGroupsSizeForDistance(guide.subpaths, targetDistanceM, detourFactor);
}

function sampleSubpath(sp: XY[], maxPts: number): XY[] {
  if (sp.length <= maxPts) return sp;
  const cum: number[] = [0];
  for (let i = 1; i < sp.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y));
  }
  const total = cum[cum.length - 1] || 1;
  const out: XY[] = [sp[0]];
  let j = 0;
  for (let k = 1; k < maxPts - 1; k++) {
    const target = (k / (maxPts - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const span = cum[j + 1] - cum[j];
    const t = span > 0 ? (target - cum[j]) / span : 0;
    out.push({
      x: sp[j].x + (sp[j + 1].x - sp[j].x) * t,
      y: sp[j].y + (sp[j + 1].y - sp[j].y) * t,
    });
  }
  out.push(sp[sp.length - 1]);
  return out;
}

export function xyGroupsSampleWaypoints(
  subpaths: XY[][],
  center: LatLng,
  sizeMeters: number,
  rotationDeg = 0,
  perSubpathMax = 12,
): LatLng[][] {
  const half = sizeMeters / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return subpaths.map((sp) => {
    const sampled = sampleSubpath(sp, perSubpathMax);
    return sampled.map((p) => {
      const xr = p.x * cos + p.y * sin;
      const yr = -p.x * sin + p.y * cos;
      return toLatLng({ x: xr * half, y: yr * half }, center);
    });
  });
}

/** 실제 도보 경로 탐색(OSRM)에 넘길 도안 대표 경유지 생성 */
export function guideSampleWaypoints(
  guide: Guide,
  center: LatLng,
  sizeMeters: number,
  rotationDeg = 0,
): LatLng[][] {
  const perSubpathMax =
    guide.id === 'paw'
      ? 5
      : guide.id === 'spiral'
        ? 16
        : guide.id === 'star'
          ? 11
          : guide.id === 'house' || guide.id === 'mountain' || guide.id === 'bolt' || guide.id === 'cat'
            ? 11
            : 12;

  return xyGroupsSampleWaypoints(guide.subpaths, center, sizeMeters, rotationDeg, perSubpathMax);
}
