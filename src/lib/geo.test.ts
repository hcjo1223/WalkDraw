import { describe, expect, it } from 'vitest';
import {
  bboxOf,
  catmullRom,
  centerOf,
  distanceOf,
  formatClock,
  formatDistance,
  formatDuration,
  formatPace,
  haversine,
  interpolateLatLng,
  pathDistance,
  resample,
  sharpenTurns,
  simplify,
  smoothGeometry,
  smoothLatLngSegments,
  softenLatLngSegments,
  splitSegments,
  toLatLng,
  toXY,
  type PathPoint,
} from './geo';

const SEOUL = { lat: 37.5665, lng: 126.978 };
const pt = (lat: number, lng: number, t = 0, brk?: boolean): PathPoint => ({ lat, lng, t, brk });

describe('haversine', () => {
  it('is zero for the same point', () => {
    expect(haversine(SEOUL, SEOUL)).toBe(0);
  });

  it('measures one degree of latitude as about 111.3 km', () => {
    const d = haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('is symmetric', () => {
    const b = { lat: 37.57, lng: 126.99 };
    expect(haversine(SEOUL, b)).toBeCloseTo(haversine(b, SEOUL), 9);
  });
});

describe('toXY / toLatLng', () => {
  it('maps the origin to 0,0', () => {
    expect(toXY(SEOUL, SEOUL)).toEqual({ x: 0, y: 0 });
  });

  it('puts north on +y and east on +x', () => {
    const n = toXY({ lat: SEOUL.lat + 0.001, lng: SEOUL.lng }, SEOUL);
    const e = toXY({ lat: SEOUL.lat, lng: SEOUL.lng + 0.001 }, SEOUL);
    expect(n.y).toBeGreaterThan(0);
    expect(Math.abs(n.x)).toBeLessThan(1e-9);
    expect(e.x).toBeGreaterThan(0);
  });

  it('round-trips within a millimetre', () => {
    const p = { lat: 37.571, lng: 126.985 };
    const back = toLatLng(toXY(p, SEOUL), SEOUL);
    expect(haversine(p, back)).toBeLessThan(0.001);
  });

  it('agrees with haversine at city scale (under 0.5% error at 1 km)', () => {
    const p = toLatLng({ x: 600, y: 800 }, SEOUL);
    expect(haversine(SEOUL, p)).toBeCloseTo(1000, -1);
  });
});

describe('bboxOf / centerOf', () => {
  it('returns the bounding box', () => {
    expect(bboxOf([{ lat: 1, lng: 5 }, { lat: 3, lng: 2 }])).toEqual({
      minLat: 1,
      maxLat: 3,
      minLng: 2,
      maxLng: 5,
    });
  });

  it('centerOf is the bbox centre, or null for no points', () => {
    expect(centerOf([{ lat: 0, lng: 0 }, { lat: 2, lng: 4 }])).toEqual({ lat: 1, lng: 2 });
    expect(centerOf([])).toBeNull();
  });
});

describe('splitSegments', () => {
  it('splits on brk points and keeps the brk point as the start of the new piece', () => {
    const segs = splitSegments([pt(0, 0), pt(0, 1), pt(0, 2, 0, true), pt(0, 3)]);
    expect(segs.map((s) => s.map((p) => p.lng))).toEqual([[0, 1], [2, 3]]);
  });

  it('ignores brk on the very first point', () => {
    expect(splitSegments([pt(0, 0, 0, true), pt(0, 1)])).toHaveLength(1);
  });

  it('returns nothing for an empty path', () => {
    expect(splitSegments([])).toEqual([]);
  });
});

describe('simplify (Ramer-Douglas-Peucker)', () => {
  it('drops points that lie on a straight line', () => {
    const line = [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 }));
    expect(simplify(line, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
  });

  it('keeps a corner that sticks out more than the tolerance', () => {
    const v = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    expect(simplify(v, 1)).toHaveLength(3);
    expect(simplify(v, 10)).toHaveLength(2);
  });

  it('returns a copy for fewer than 3 points', () => {
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const out = simplify(two, 1);
    expect(out).toEqual(two);
    expect(out).not.toBe(two);
  });
});

describe('sharpenTurns', () => {
  it('adds a point before and after a sharp corner', () => {
    const corner = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(sharpenTurns(corner)).toHaveLength(5);
  });

  it('leaves a straight line alone', () => {
    const line = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    expect(sharpenTurns(line)).toEqual(line);
  });
});

describe('catmullRom', () => {
  it('passes through every control point and starts/ends on them', () => {
    const ctrl = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }];
    const out = catmullRom(ctrl, 4);
    expect(out).toHaveLength(1 + 2 * 4);
    expect(out[0]).toEqual(ctrl[0]);
    expect(out[4].x).toBeCloseTo(10);
    expect(out[4].y).toBeCloseTo(5);
    expect(out[8].x).toBeCloseTo(20);
    expect(out[8].y).toBeCloseTo(0);
  });
});

describe('smoothGeometry / smoothLatLngSegments / softenLatLngSegments', () => {
  const path = [pt(37.5665, 126.978), pt(37.567, 126.978), pt(37.567, 126.979, 0, true), pt(37.5675, 126.979)];

  it('produces one smooth piece per brk segment', () => {
    const { segments, origin } = smoothGeometry(path);
    expect(segments).toHaveLength(2);
    expect(origin).toEqual(centerOf(path));
  });

  it('turns a single-point segment into a zero-length line so it can still be drawn', () => {
    const { segments } = smoothGeometry([pt(1, 1)]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(2);
  });

  it('smoothLatLngSegments keeps the end points', () => {
    const segs = smoothLatLngSegments(path);
    expect(haversine(segs[0][0], path[0])).toBeLessThan(0.01);
  });

  it('softenLatLngSegments keeps ends and averages the middle', () => {
    const segs = softenLatLngSegments([pt(0, 0), pt(1, 0), pt(0, 0)]);
    expect(segs[0]).toEqual([{ lat: 0, lng: 0 }, { lat: 0.5, lng: 0 }, { lat: 0, lng: 0 }]);
  });
});

describe('distanceOf / pathDistance', () => {
  it('adds up leg lengths', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0.001, lng: 0 };
    const c = { lat: 0.002, lng: 0 };
    expect(distanceOf([a, b, c])).toBeCloseTo(haversine(a, c), 6);
    expect(distanceOf([a])).toBe(0);
  });

  it('does not count the jump across a brk', () => {
    const p = [pt(0, 0), pt(0.001, 0), pt(1, 0, 0, true), pt(1.001, 0)];
    const legs = haversine(p[0], p[1]) + haversine(p[2], p[3]);
    expect(pathDistance(p)).toBeCloseTo(legs, 6);
  });
});

describe('resample', () => {
  it('places points at an even spacing along the line', () => {
    const out = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2.5);
    expect(out.map((p) => p.x)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it('carries leftover distance across corners', () => {
    const out = resample([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }], 2);
    expect(out.map((p) => [p.x, p.y])).toEqual([[0, 0], [2, 0], [3, 1], [3, 3]]);
  });

  it('skips zero-length segments', () => {
    const out = resample([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }], 2);
    expect(out.map((p) => p.x)).toEqual([0, 2, 4]);
  });
});

describe('interpolateLatLng', () => {
  it('fills points up to and including b, but not a', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0.001, lng: 0 }; // ~111 m
    const out = interpolateLatLng(a, b, 20);
    expect(out).toHaveLength(6);
    expect(out[out.length - 1]).toEqual(b);
  });

  it('returns at least one point even for very close points', () => {
    expect(interpolateLatLng(SEOUL, SEOUL, 10)).toHaveLength(1);
  });
});

describe('formatters', () => {
  it('formatDistance', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(-3)).toBe('0 m');
    expect(formatDistance(NaN)).toBe('0 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(1234)).toBe('1.23 km');
  });

  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0초');
    expect(formatDuration(59_000)).toBe('59초');
    expect(formatDuration(61_000)).toBe('1분 1초');
    expect(formatDuration(3_660_000)).toBe('1시간 1분');
    expect(formatDuration(-5000)).toBe('0초');
  });

  it('formatClock', () => {
    expect(formatClock(5_999)).toBe('00:05');
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });

  it('formatPace returns a dash for too-short walks', () => {
    expect(formatPace(20, 60_000)).toBe('—');
    expect(formatPace(1000, 4_000)).toBe('—');
    expect(formatPace(100, 3_700_000)).toBe('—');
  });

  it('formatPace formats minutes and seconds per km', () => {
    expect(formatPace(1000, 750_000)).toBe(`12'30"`);
    expect(formatPace(2000, 960_000)).toBe(`8'00"`);
  });

  it('formatPace never shows 60 seconds (rounds up to the next minute)', () => {
    // 359.6 s/km -> should read 6'00", not 5'60"
    expect(formatPace(1000, 359_600)).toBe(`6'00"`);
  });
});
