import { centerOf, haversine, toLatLng, toXY, type LatLng, type XY } from './geo';
import { xyGroupsSampleWaypoints, xyGroupsToLatLngs } from './guides';

export type TurnType =
  | 'depart'
  | 'straight'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'uturn'
  | 'roundabout'
  | 'arrive';

export type NavStep = {
  id: number;
  turnType: TurnType;
  instruction: string;
  streetName: string;
  distanceM: number;
  startDistM: number;
  endDistM: number;
  location: LatLng;
};

export type WalkableRoute = {
  path: LatLng[];
  cumDist: number[];
  steps: NavStep[];
  totalDistanceM: number;
  isRealRoad: boolean;
  approachPath?: LatLng[];
  approachDistanceM?: number;
};

export type NavProgress = {
  traveledM: number;
  remainingM: number;
  progressRatio: number;
  distFromRouteM: number;
  offRoute: boolean;
  currentStep: NavStep | null;
  nextStep: NavStep | null;
  distToNextStepM: number;
  isArrived: boolean;
  approachDistM: number;
};

const OSRM_FOOT_BASE = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

export function turnIcon(t: TurnType): string {
  switch (t) {
    case 'depart':
      return '🚶';
    case 'straight':
      return '↑';
    case 'slight-right':
      return '↗';
    case 'right':
      return '↱';
    case 'sharp-right':
      return '⤵';
    case 'slight-left':
      return '↖';
    case 'left':
      return '↰';
    case 'sharp-left':
      return '⤶';
    case 'uturn':
      return '↺';
    case 'roundabout':
      return '⟳';
    case 'arrive':
      return '🏁';
  }
}

function mapOsrmTurn(type?: string, modifier?: string): TurnType {
  if (type === 'depart') return 'depart';
  if (type === 'arrive') return 'arrive';
  if (type === 'roundabout' || type === 'rotary' || type === 'exit roundabout') return 'roundabout';
  switch (modifier) {
    case 'slight right':
      return 'slight-right';
    case 'right':
      return 'right';
    case 'sharp right':
      return 'sharp-right';
    case 'slight left':
      return 'slight-left';
    case 'left':
      return 'left';
    case 'sharp left':
      return 'sharp-left';
    case 'uturn':
      return 'uturn';
    default:
      return 'straight';
  }
}

function turnLabel(t: TurnType): string {
  switch (t) {
    case 'depart':
      return '도보 출발';
    case 'straight':
      return '직진';
    case 'slight-right':
      return '오른쪽 방향';
    case 'right':
      return '우회전';
    case 'sharp-right':
      return '크게 우회전';
    case 'slight-left':
      return '왼쪽 방향';
    case 'left':
      return '좌회전';
    case 'sharp-left':
      return '크게 좌회전';
    case 'uturn':
      return '유턴';
    case 'roundabout':
      return '회전교차로';
    case 'arrive':
      return '도안 완주 도착!';
  }
}

function angleTurnType(a: LatLng, b: LatLng, c: LatLng): TurnType {
  const p1 = toXY(a, b);
  const p2 = toXY(c, b);
  // 진입 벡터 (-p1) 와 진출 벡터 (p2)
  const v1x = -p1.x;
  const v1y = -p1.y;
  const v2x = p2.x;
  const v2y = p2.y;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  // atan2(cross, dot): +면 반시계(좌회전), -면 시계(우회전)
  const deg = (Math.atan2(cross, dot) * 180) / Math.PI;
  if (Math.abs(deg) < 22) return 'straight';
  if (Math.abs(deg) > 150) return 'uturn';
  if (deg > 0) {
    if (deg < 55) return 'slight-left';
    if (deg < 120) return 'left';
    return 'sharp-left';
  } else {
    const ad = -deg;
    if (ad < 55) return 'slight-right';
    if (ad < 120) return 'right';
    return 'sharp-right';
  }
}

function buildCumDist(path: LatLng[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
  }
  return cum;
}

function dedupePath(pts: LatLng[], minDist = 0.8): LatLng[] {
  const out: LatLng[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || haversine(prev, p) >= minDist) {
      out.push(p);
    }
  }
  return out;
}

/** OSRM 응답 없이도 안내가 끊기지 않도록 직선 기반 대체 경로 생성 */
export function buildFallbackRoute(
  waypointGroups: LatLng[][],
  userLoc?: LatLng | null,
): WalkableRoute {
  const flat: LatLng[] = [];
  for (const g of waypointGroups) flat.push(...g);
  const path = dedupePath(flat, 2);
  const cumDist = buildCumDist(path);
  const totalDistanceM = cumDist[cumDist.length - 1] ?? 0;

  const steps: NavStep[] = [];
  if (path.length >= 2) {
    steps.push({
      id: 0,
      turnType: 'depart',
      instruction: '도보 출발',
      streetName: '도안 경로',
      distanceM: cumDist[1] ?? 0,
      startDistM: 0,
      endDistM: cumDist[1] ?? 0,
      location: path[0],
    });
    for (let i = 1; i < path.length - 1; i++) {
      const turnType = angleTurnType(path[i - 1], path[i], path[i + 1]);
      if (turnType === 'straight' && steps.length > 0) {
        const last = steps[steps.length - 1];
        last.endDistM = cumDist[i + 1];
        last.distanceM = last.endDistM - last.startDistM;
        continue;
      }
      steps.push({
        id: steps.length,
        turnType,
        instruction: turnLabel(turnType),
        streetName: '도안 안내',
        distanceM: cumDist[i + 1] - cumDist[i],
        startDistM: cumDist[i],
        endDistM: cumDist[i + 1],
        location: path[i],
      });
    }
    steps.push({
      id: steps.length,
      turnType: 'arrive',
      instruction: '도안 완주 도착!',
      streetName: '',
      distanceM: 0,
      startDistM: totalDistanceM,
      endDistM: totalDistanceM,
      location: path[path.length - 1],
    });
  }

  let approachPath: LatLng[] | undefined;
  let approachDistanceM: number | undefined;
  if (userLoc && path[0]) {
    const d = haversine(userLoc, path[0]);
    if (d > 25 && d < 10000) {
      approachPath = [userLoc, path[0]];
      approachDistanceM = d;
    }
  }

  return {
    path,
    cumDist,
    steps,
    totalDistanceM,
    isRealRoad: false,
    approachPath,
    approachDistanceM,
  };
}

type OsrmStep = {
  distance: number;
  name?: string;
  maneuver?: {
    type?: string;
    modifier?: string;
    location?: [number, number];
    bearing_before?: number;
    bearing_after?: number;
  };
  geometry?: { coordinates?: [number, number][] };
};

type OsrmResponse = {
  code?: string;
  routes?: Array<{
    distance: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: Array<{ steps?: OsrmStep[] }>;
  }>;
};

function flattenWaypoints(groups: LatLng[][], maxPts = 24): LatLng[] {
  const flat: LatLng[] = [];
  for (const g of groups) {
    for (const p of g) {
      const prev = flat[flat.length - 1];
      if (!prev || haversine(prev, p) >= 6) {
        flat.push(p);
      }
    }
  }
  if (flat.length <= maxPts) return flat;
  const out: LatLng[] = [flat[0]];
  const step = (flat.length - 1) / (maxPts - 1);
  for (let i = 1; i < maxPts - 1; i++) {
    out.push(flat[Math.round(i * step)]);
  }
  out.push(flat[flat.length - 1]);
  return out;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number, outer?: AbortSignal) {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (outer?.aborted) ctrl.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as OsrmResponse;
  } finally {
    window.clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

export async function fetchWalkableRoute(
  waypointGroups: LatLng[][],
  userLoc?: LatLng | null,
  signal?: AbortSignal,
): Promise<WalkableRoute> {
  const waypoints = flattenWaypoints(waypointGroups, 24);
  if (waypoints.length < 2) {
    return buildFallbackRoute(waypointGroups, userLoc);
  }

  const coordsParam = waypoints.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${OSRM_FOOT_BASE}/${coordsParam}?overview=full&geometries=geojson&steps=true&continue_straight=true`;

  try {
    const data = await fetchJsonWithTimeout(url, 8500, signal);
    const route = data.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (data.code !== 'Ok' || !route || !coords || coords.length < 2) {
      return buildFallbackRoute(waypointGroups, userLoc);
    }

    const rawPath: LatLng[] = coords.map(([lng, lat]) => ({ lat, lng }));
    const path = dedupePath(rawPath, 0.8);
    const cumDist = buildCumDist(path);
    const totalDistanceM = cumDist[cumDist.length - 1] ?? route.distance;

    // 다중 leg의 steps를 하나의 연속적인 네비 안내 목록으로 정리
    const rawSteps: Array<{
      turnType: TurnType;
      streetName: string;
      distanceM: number;
      location: LatLng;
    }> = [];

    const legs = route.legs ?? [];
    for (let li = 0; li < legs.length; li++) {
      const legSteps = legs[li].steps ?? [];
      for (let si = 0; si < legSteps.length; si++) {
        const st = legSteps[si];
        const mType = st.maneuver?.type;
        const mMod = st.maneuver?.modifier;
        const isLastLeg = li === legs.length - 1;

        // 중간 leg 경계의 arrive는 건너뛰고, 중간 depart는 직진과 합치거나 실제 방향 전환만 남긴다
        if (mType === 'arrive' && !isLastLeg) continue;
        let turnType = mapOsrmTurn(mType, mMod);
        if (mType === 'depart' && li > 0) {
          turnType = mapOsrmTurn('turn', mMod);
        }

        const locArr = st.maneuver?.location;
        const location: LatLng = locArr ? { lat: locArr[1], lng: locArr[0] } : path[0];
        const streetName = (st.name ?? '').trim();

        const prev = rawSteps[rawSteps.length - 1];
        if (
          prev &&
          prev.turnType !== 'depart' &&
          turnType === 'straight' &&
          (streetName === prev.streetName || !streetName)
        ) {
          prev.distanceM += st.distance;
          continue;
        }
        if (prev && st.distance < 5 && turnType !== 'arrive') {
          prev.distanceM += st.distance;
          continue;
        }

        rawSteps.push({
          turnType,
          streetName,
          distanceM: st.distance,
          location,
        });
      }
    }

    // step 누적 거리 보정
    const steps: NavStep[] = [];
    let cursor = 0;
    const rawSum = rawSteps.reduce((acc, s) => acc + s.distanceM, 0) || totalDistanceM || 1;
    const scale = totalDistanceM > 0 ? totalDistanceM / rawSum : 1;

    for (let i = 0; i < rawSteps.length; i++) {
      const s = rawSteps[i];
      const d = s.turnType === 'arrive' ? 0 : s.distanceM * scale;
      const startDistM = Math.min(totalDistanceM, cursor);
      const endDistM = s.turnType === 'arrive' ? totalDistanceM : Math.min(totalDistanceM, cursor + d);
      cursor = endDistM;
      const label = turnLabel(s.turnType);
      const instruction = s.streetName ? `${label} · ${s.streetName}` : label;
      steps.push({
        id: i,
        turnType: s.turnType,
        instruction,
        streetName: s.streetName,
        distanceM: Math.max(0, endDistM - startDistM),
        startDistM,
        endDistM,
        location: s.location,
      });
    }

    // 현재 위치 -> 도안 출발점 접근 경로(30m 이상 떨어져 있을 때)
    let approachPath: LatLng[] | undefined;
    let approachDistanceM: number | undefined;
    if (userLoc && path[0]) {
      const directD = haversine(userLoc, path[0]);
      if (directD > 30 && directD < 5000) {
        try {
          const appUrl = `${OSRM_FOOT_BASE}/${userLoc.lng.toFixed(6)},${userLoc.lat.toFixed(6)};${path[0].lng.toFixed(6)},${path[0].lat.toFixed(6)}?overview=full&geometries=geojson`;
          const appData = await fetchJsonWithTimeout(appUrl, 4500, signal);
          const appCoords = appData.routes?.[0]?.geometry?.coordinates;
          if (appData.code === 'Ok' && appCoords && appCoords.length >= 2) {
            approachPath = appCoords.map(([lng, lat]) => ({ lat, lng }));
            approachDistanceM = appData.routes![0].distance;
          } else {
            approachPath = [userLoc, path[0]];
            approachDistanceM = directD;
          }
        } catch {
          if (!signal?.aborted) {
            approachPath = [userLoc, path[0]];
            approachDistanceM = directD;
          }
        }
      }
    }

    return {
      path,
      cumDist,
      steps,
      totalDistanceM,
      isRealRoad: true,
      approachPath,
      approachDistanceM,
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return buildFallbackRoute(waypointGroups, userLoc);
  }
}

/** 현재 위치를 경로 위에 투영해 진행률과 다음 안내를 계산한다. */
export function computeNavProgress(
  route: WalkableRoute,
  myLoc: LatLng | null,
  prevTraveledM = 0,
): NavProgress {
  const { path, cumDist, steps, totalDistanceM } = route;
  if (path.length < 2 || totalDistanceM <= 0) {
    return {
      traveledM: 0,
      remainingM: totalDistanceM,
      progressRatio: 0,
      distFromRouteM: 0,
      offRoute: false,
      currentStep: steps[0] ?? null,
      nextStep: steps[1] ?? null,
      distToNextStepM: 0,
      isArrived: false,
      approachDistM: 0,
    };
  }

  if (!myLoc) {
    return {
      traveledM: 0,
      remainingM: totalDistanceM,
      progressRatio: 0,
      distFromRouteM: 0,
      offRoute: false,
      currentStep: steps[0] ?? null,
      nextStep: steps[1] ?? null,
      distToNextStepM: steps[0]?.distanceM ?? 0,
      isArrived: false,
      approachDistM: 0,
    };
  }

  const findClosest = (minDist: number, maxDist: number) => {
    let bestDist = Infinity;
    let bestTraveled = prevTraveledM;
    for (let i = 0; i < path.length - 1; i++) {
      const s0 = cumDist[i];
      const s1 = cumDist[i + 1];
      if (s1 < minDist || s0 > maxDist) continue;
      const a = path[i];
      const b = path[i + 1];
      const ax = toXY(a, myLoc);
      const bx = toXY(b, myLoc);
      const dx = bx.x - ax.x;
      const dy = bx.y - ax.y;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : -(ax.x * dx + ax.y * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = ax.x + t * dx;
      const py = ax.y + t * dy;
      const d = Math.hypot(px, py);
      if (d < bestDist) {
        bestDist = d;
        bestTraveled = s0 + (s1 - s0) * t;
      }
    }
    return { dist: bestDist, traveled: bestTraveled };
  };

  // 루프/교차 도안에서 끝점으로 바로 점프하지 않도록 직전 진행 위치 주변 윈도우를 우선 탐색
  const windowSpan = Math.max(220, totalDistanceM * 0.25);
  const win = findClosest(Math.max(0, prevTraveledM - 35), prevTraveledM + windowSpan);
  let chosen = win;
  if (win.dist > 55) {
    const global = findClosest(0, totalDistanceM);
    if (global.dist < win.dist) chosen = global;
  }

  const traveledM = Math.max(0, Math.min(totalDistanceM, chosen.traveled));
  const remainingM = Math.max(0, totalDistanceM - traveledM);
  const progressRatio = totalDistanceM > 0 ? traveledM / totalDistanceM : 0;
  const offRoute = chosen.dist > 48;
  const isArrived = remainingM < 15 && progressRatio > 0.85;

  let stepIdx = 0;
  for (let i = 0; i < steps.length; i++) {
    if (traveledM >= steps[i].startDistM) stepIdx = i;
  }
  const currentStep = isArrived ? (steps[steps.length - 1] ?? null) : (steps[stepIdx] ?? null);
  const nextStep = isArrived ? null : (steps[stepIdx + 1] ?? null);
  const distToNextStepM =
    currentStep && !isArrived ? Math.max(0, currentStep.endDistM - traveledM) : 0;
  const approachDistM = path[0] ? haversine(myLoc, path[0]) : 0;

  return {
    traveledM,
    remainingM,
    progressRatio,
    distFromRouteM: chosen.dist,
    offRoute,
    currentStep,
    nextStep,
    distToNextStepM,
    isArrived,
    approachDistM,
  };
}

/* ---------------- 장소 검색 (Nominatim 무료 API) ---------------- */

export type PlaceResult = {
  id: string;
  name: string;
  address: string;
  location: LatLng;
};

export async function searchPlaces(
  query: string,
  near?: LatLng | null,
  signal?: AbortSignal,
): Promise<PlaceResult[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({
    format: 'json',
    q,
    limit: '6',
    'accept-language': 'ko',
    addressdetails: '1',
  });
  if (near) {
    const d = 0.08;
    params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
  }
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const arr = (await res.json()) as Array<{
    place_id: number | string;
    name?: string;
    display_name: string;
    lat: string;
    lon: string;
  }>;
  return arr.map((item) => {
    const parts = item.display_name.split(',').map((s) => s.trim());
    const name = item.name || parts[0] || q;
    const address = parts.slice(1, 4).join(' ');
    return {
      id: String(item.place_id),
      name,
      address,
      location: { lat: Number(item.lat), lng: Number(item.lon) },
    };
  });
}

/* ---------------- 닮은 정도 (%) 계산 & 3코스 후보 생성 ---------------- */

export type RouteCandidate = {
  id: string;
  label: string;
  tag: string;
  route: WalkableRoute;
  similarity?: number;
};

function normalizeLatLngs(pts: LatLng[]): XY[] {
  if (pts.length === 0) return [];
  const org = centerOf(pts) ?? pts[0];
  const xy = pts.map((p) => toXY(p, org));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of xy) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const k = 2 / span;
  return xy.map((p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k }));
}

function subsampleXY(pts: XY[], maxPts = 48): XY[] {
  if (pts.length <= maxPts) return pts;
  const out: XY[] = [];
  const step = (pts.length - 1) / (maxPts - 1);
  for (let i = 0; i < maxPts; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

/** 원래 그린 도형과 실제 보행로 경로의 닮은 정도(0~99%) 계산 */
export function computeShapeSimilarity(targetPts: LatLng[], routedPts: LatLng[]): number {
  const a = subsampleXY(normalizeLatLngs(targetPts), 42);
  const b = subsampleXY(normalizeLatLngs(routedPts), 56);
  if (a.length < 2 || b.length < 2) return 75;

  const avgMinDist = (src: XY[], dst: XY[]) => {
    let sum = 0;
    for (const p of src) {
      let best = Infinity;
      for (const q of dst) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < best) best = d;
      }
      sum += best;
    }
    return sum / src.length;
  };

  const err = (avgMinDist(a, b) + avgMinDist(b, a)) / 2;
  const score = Math.round(Math.max(48, Math.min(98, 100 - err * 78)));
  return score;
}

/** 손그림/도안 1개를 3가지 변형(기본, +각도/크기, -각도/크기)으로 실제 길 후보 3개 생성 */
export async function generateSketchCandidates(
  subpaths: XY[][],
  center: LatLng,
  baseSizeM: number,
  baseRotDeg: number,
  userLoc?: LatLng | null,
  signal?: AbortSignal,
): Promise<RouteCandidate[]> {
  const variants = [
    { id: 'c1', label: '추천 그림 코스', tag: '기본 맞춤', scale: 1.0, rotOffset: 0 },
    { id: 'c2', label: '대안 그림 코스 1', tag: '여유 동선', scale: 1.14, rotOffset: 8 },
    { id: 'c3', label: '대안 그림 코스 2', tag: '컴팩트', scale: 0.88, rotOffset: -8 },
  ];

  return Promise.all(
    variants.map(async (v) => {
      const sz = Math.max(40, Math.round((baseSizeM * v.scale) / 10) * 10);
      const rot = ((baseRotDeg + v.rotOffset) % 360 + 360) % 360;
      const wps = xyGroupsSampleWaypoints(subpaths, center, sz, rot, 12);
      const shapePts = xyGroupsToLatLngs(subpaths, center, sz, rot).flat();
      const route = await fetchWalkableRoute(wps, userLoc, signal);
      const similarity = route.isRealRoad
        ? computeShapeSimilarity(shapePts, route.path)
        : 96;
      return {
        id: v.id,
        label: v.label,
        tag: v.tag,
        route,
        similarity,
      };
    }),
  );
}

/** AI 코스 추천: 출발지(+선택 경유지) 기준 목표 거리에 맞는 3개 보행 코스 생성 */
export async function generateAiCandidates(
  opts: {
    origin: LatLng;
    waypoint?: LatLng | null;
    roundTrip: boolean;
    targetDistM: number;
  },
  signal?: AbortSignal,
): Promise<RouteCandidate[]> {
  const { origin, waypoint, roundTrip, targetDistM } = opts;

  const makeLoopWaypoints = (bearingDeg: number, distM: number, scale = 1): LatLng[] => {
    const side = Math.max(55, (distM * scale) / 4.9);
    const b0 = (bearingDeg * Math.PI) / 180;
    const b1 = ((bearingDeg + 54) * Math.PI) / 180;
    const p1 = toLatLng({ x: Math.sin(b0) * side, y: Math.cos(b0) * side }, origin);
    const p2 = toLatLng({ x: Math.sin(b1) * side * 0.94, y: Math.cos(b1) * side * 0.94 }, origin);
    return [origin, p1, p2, origin];
  };

  const makeWaypointCandidates = (): Array<{ id: string; tag: string; wps: LatLng[] }> => {
    if (!waypoint) {
      return [
        { id: 'ai1', tag: '북동 순환', wps: makeLoopWaypoints(25, targetDistM, 1.0) },
        { id: 'ai2', tag: '남동 순환', wps: makeLoopWaypoints(145, targetDistM, 0.92) },
        { id: 'ai3', tag: '서쪽 순환', wps: makeLoopWaypoints(265, targetDistM, 1.08) },
      ];
    }

    const wpXY = toXY(waypoint, origin);
    const baseDist = Math.hypot(wpXY.x, wpXY.y) || 200;
    const ux = wpXY.x / baseDist;
    const uy = wpXY.y / baseDist;
    const px = -uy;
    const py = ux;
    const mid = { x: wpXY.x * 0.5, y: wpXY.y * 0.5 };
    const lateral = Math.max(70, Math.min(baseDist * 0.45, (targetDistM - baseDist * 2) * 0.25));

    if (roundTrip) {
      const leftDetour = toLatLng({ x: mid.x + px * lateral, y: mid.y + py * lateral }, origin);
      const rightDetour = toLatLng({ x: mid.x - px * lateral, y: mid.y - py * lateral }, origin);
      return [
        { id: 'ai1', tag: '왕복 순환', wps: [origin, waypoint, leftDetour, origin] },
        { id: 'ai2', tag: '반대 순환', wps: [origin, rightDetour, waypoint, origin] },
        { id: 'ai3', tag: '직통 왕복', wps: [origin, waypoint, origin] },
      ];
    }

    const detourL = toLatLng({ x: mid.x + px * lateral, y: mid.y + py * lateral }, origin);
    const detourR = toLatLng({ x: mid.x - px * lateral, y: mid.y - py * lateral }, origin);
    return [
      { id: 'ai1', tag: '직통 편도', wps: [origin, waypoint] },
      { id: 'ai2', tag: '여유 경유', wps: [origin, detourL, waypoint] },
      { id: 'ai3', tag: '우회 경유', wps: [origin, detourR, waypoint] },
    ];
  };

  const defs = makeWaypointCandidates();
  const routes = await Promise.all(
    defs.map(async (d) => ({
      id: d.id,
      tag: d.tag,
      route: await fetchWalkableRoute([d.wps], null, signal),
    })),
  );
  routes.sort(
    (a, b) =>
      Math.abs(a.route.totalDistanceM - targetDistM) -
      Math.abs(b.route.totalDistanceM - targetDistM),
  );
  return routes.map((r, idx) => ({
    ...r,
    label: idx === 0 ? '추천 산책 코스' : `대안 산책 코스 ${idx}`,
  }));
}

/** 찜한 코스 경로를 네비게이션 가능한 WalkableRoute로 복원 */
export function hydrateSavedRoute(
  pts: LatLng[],
  isRealRoad: boolean,
  userLoc?: LatLng | null,
): WalkableRoute {
  const r = buildFallbackRoute([pts], userLoc);
  return { ...r, isRealRoad };
}
