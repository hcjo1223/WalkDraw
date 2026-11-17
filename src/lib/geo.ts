export type LatLng = { lat: number; lng: number };

/** 기록된 경로의 한 점. brk=true 이면 직전 점과 선으로 잇지 않는다(일시정지/순간이동). */
export type PathPoint = LatLng & { t: number; brk?: boolean };

export type XY = { x: number; y: number };

export type WalkFeedback = {
  rating: 'great' | 'good' | 'meh';
  tags: string[];
  note?: string;
};

export type Walk = {
  id: string;
  title: string;
  createdAt: number;
  points: PathPoint[];
  color: string;
  width: number;
  guideId: string | null;
  distanceM: number;
  durationMs: number;
  paceId?: 'slow' | 'walk' | 'jog';
  partnerId?: string;
  courseKind?: 'free' | 'guide' | 'sketch' | 'ai' | 'pin';
  feedback?: WalkFeedback;
};

const R = 6378137;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLng = (b.lng - a.lng) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 위경도 -> 로컬 평면(m). 도시 규모에서는 등장방형 근사로 충분하다. */
export function toXY(p: LatLng, origin: LatLng): XY {
  return {
    x: (p.lng - origin.lng) * D2R * Math.cos(origin.lat * D2R) * R,
    y: (p.lat - origin.lat) * D2R * R,
  };
}

export function toLatLng(p: XY, origin: LatLng): LatLng {
  return {
    lat: origin.lat + (p.y / R) * R2D,
    lng: origin.lng + (p.x / (R * Math.cos(origin.lat * D2R))) * R2D,
  };
}

export function bboxOf(points: LatLng[]) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function centerOf(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  const b = bboxOf(points);
  return { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 };
}

/** brk 표시를 기준으로 경로를 여러 조각으로 나눈다. */
export function splitSegments(points: PathPoint[]): PathPoint[][] {
  const out: PathPoint[][] = [];
  let cur: PathPoint[] = [];
  for (const p of points) {
    if (p.brk && cur.length) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out.filter((s) => s.length > 0);
}

/** Ramer–Douglas–Peucker 단순화 (평면 좌표) */
export function simplify(points: XY[], tolerance: number): XY[] {
  if (points.length < 3) return points.slice();
  const sq = tolerance * tolerance;
  const first = 0;
  const last = points.length - 1;
  const keep = new Uint8Array(points.length);
  keep[first] = 1;
  keep[last] = 1;
  const stack: [number, number][] = [[first, last]];

  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxDist = -1;
    let idx = -1;
    const ax = points[a].x;
    const ay = points[a].y;
    const bx = points[b].x;
    const by = points[b].y;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    for (let i = a + 1; i < b; i++) {
      const px = points[i].x;
      const py = points[i].y;
      let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > sq && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: XY[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * 꿍은 모서리(집·번개 같은 직선 도형)가 스플라인 때문에 둥그렇게 뭉개지지 않도록,
 * 모서리 바로 앞뒤에 짧은 점을 끼워 넣어 회전을 살린다. 진행 방향 변화가 turnDeg 이상인 점이 대상.
 */
export function sharpenTurns(path: XY[], turnDeg = 35, eps = 0.35): XY[] {
  if (path.length < 3) return path.slice();
  const out: XY[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    const c = path[i + 1];
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 === 0 || l2 === 0) {
      out.push(b);
      continue;
    }
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (turn > turnDeg) {
      const e1 = Math.min(eps, l1 * 0.25);
      const e2 = Math.min(eps, l2 * 0.25);
      out.push({ x: b.x - (v1x / l1) * e1, y: b.y - (v1y / l1) * e1 });
      out.push(b);
      out.push({ x: b.x + (v2x / l2) * e2, y: b.y + (v2y / l2) * e2 });
    } else {
      out.push(b);
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Catmull–Rom 스플라인으로 점 사이를 부드럽게 잇는다. */
export function catmullRom(points: XY[], samplesPerSeg = 8): XY[] {
  if (points.length < 2) return points.slice();
  const out: XY[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    for (let s = 1; s <= samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

/** 기록 점 -> 부드러운 평면 경로 조각들 + 사용한 원점 */
export function smoothGeometry(
  points: PathPoint[],
  origin?: LatLng,
  tolerance = 1.4,
): { segments: XY[][]; origin: LatLng } {
  const org = origin ?? centerOf(points) ?? { lat: 0, lng: 0 };
  const segments: XY[][] = [];
  for (const seg of splitSegments(points)) {
    const xy = seg.map((p) => toXY(p, org));
    const simplified = simplify(xy, tolerance);
    const sharpened = sharpenTurns(simplified);
    const smooth = catmullRom(sharpened, 8);
    if (smooth.length >= 2) segments.push(smooth);
    else if (smooth.length === 1) segments.push([smooth[0], { ...smooth[0] }]);
  }
  return { segments, origin: org };
}

/** 지도 폴리라인용: 부드럽게 만든 경로를 다시 위경도로 */
export function smoothLatLngSegments(points: PathPoint[]): LatLng[][] {
  const { segments, origin } = smoothGeometry(points);
  return segments.map((seg) => seg.map((p) => toLatLng(p, origin)));
}

/** 실시간 표시용 가벼운 3점 이동평균 (brk 경계는 유지) */
export function softenLatLngSegments(points: PathPoint[]): LatLng[][] {
  return splitSegments(points).map((seg) => {
    if (seg.length < 3) return seg.map((p) => ({ lat: p.lat, lng: p.lng }));
    const out: LatLng[] = [{ lat: seg[0].lat, lng: seg[0].lng }];
    for (let i = 1; i < seg.length - 1; i++) {
      out.push({
        lat: seg[i - 1].lat * 0.25 + seg[i].lat * 0.5 + seg[i + 1].lat * 0.25,
        lng: seg[i - 1].lng * 0.25 + seg[i].lng * 0.5 + seg[i + 1].lng * 0.25,
      });
    }
    out.push({ lat: seg[seg.length - 1].lat, lng: seg[seg.length - 1].lng });
    return out;
  });
}

export function distanceOf(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

/** 경로 전체 길이 (m) — brk 구간은 끊는다 */
export function pathDistance(points: PathPoint[]): number {
  return splitSegments(points).reduce((acc, seg) => acc + distanceOf(seg), 0);
}

/** 같은 경로를 일정 간격(m)으로 다시 샘플링 */
export function resample(xy: XY[], spacing: number): XY[] {
  if (xy.length < 2) return xy.slice();
  const out: XY[] = [xy[0]];
  let carry = 0;
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1];
    const b = xy[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    let d = spacing - carry;
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carry = segLen - (d - spacing);
  }
  const last = xy[xy.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > spacing * 0.15) out.push(last);
  return out;
}

/** 두 점 사이를 일정 간격으로 채운다 (시뮬레이션 탭 그리기용) */
export function interpolateLatLng(a: LatLng, b: LatLng, spacing: number): LatLng[] {
  const d = haversine(a, b);
  const n = Math.max(1, Math.round(d / spacing));
  const out: LatLng[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return out;
}

export function formatDistance(m: number): string {
  if (!isFinite(m) || m <= 0) return '0 m';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatPace(distanceM: number, durationMs: number): string {
  if (distanceM < 30 || durationMs < 5000) return '—';
  const secPerKm = durationMs / 1000 / (distanceM / 1000);
  if (!isFinite(secPerKm) || secPerKm > 3600) return '—';
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}'${String(s).padStart(2, '0')}"`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(
    d.getDate(),
  ).padStart(2, '0')} (${days[d.getDay()]})`;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}
