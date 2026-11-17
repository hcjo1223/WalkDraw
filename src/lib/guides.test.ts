import { describe, expect, it } from 'vitest';
import { haversine, toXY } from './geo';
import {
  GUIDES,
  guideById,
  guideLatLngs,
  guidePerimeterRatio,
  guideSampleWaypoints,
  guideSizeForDistance,
  guideWalkPath,
  xyGroupsPerimeterRatio,
  xyGroupsSizeForDistance,
  xyGroupsToLatLngs,
} from './guides';

const CENTER = { lat: 37.5665, lng: 126.978 };

describe('GUIDES', () => {
  it('has unique ids', () => {
    const ids = GUIDES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(GUIDES.map((g) => [g.id, g] as const))('%s is normalised to fit [-1, 1] and touch it', (_id, g) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const sp of g.subpaths) {
      expect(sp.length).toBeGreaterThanOrEqual(2);
      for (const p of sp) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    for (const v of [minX, maxX, minY, maxY]) {
      expect(v).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
    const span = Math.max(maxX - minX, maxY - minY);
    expect(span).toBeCloseTo(2, 9);
    // centred on 0,0
    expect((minX + maxX) / 2).toBeCloseTo(0, 9);
    expect((minY + maxY) / 2).toBeCloseTo(0, 9);
  });

  it('removes consecutive duplicate points', () => {
    for (const g of GUIDES) {
      for (const sp of g.subpaths) {
        for (let i = 1; i < sp.length; i++) {
          expect(Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y)).toBeGreaterThan(1e-4);
        }
      }
    }
  });
});

describe('guideById', () => {
  it('finds a guide or returns null', () => {
    expect(guideById('heart')?.name).toBe('하트');
    expect(guideById('nope')).toBeNull();
    expect(guideById(null)).toBeNull();
  });
});

describe('xyGroupsToLatLngs', () => {
  const square = [[{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }]];

  it('scales normalised units so the full width equals sizeMeters', () => {
    const [line] = xyGroupsToLatLngs(square, CENTER, 200);
    expect(haversine(line[0], line[1])).toBeCloseTo(200, 0);
  });

  it('rotates clockwise for positive degrees (north becomes east at 90)', () => {
    const [line] = xyGroupsToLatLngs([[{ x: 0, y: 1 }]], CENTER, 200, 90);
    const xy = toXY(line[0], CENTER);
    expect(xy.x).toBeCloseTo(100, 3);
    expect(xy.y).toBeCloseTo(0, 3);
  });

  it('guideLatLngs keeps one line per subpath and guideWalkPath joins them', () => {
    const paw = guideById('paw')!;
    const lines = guideLatLngs(paw, CENTER, 300);
    expect(lines).toHaveLength(paw.subpaths.length);
    const flat = guideWalkPath(paw, CENTER, 300);
    expect(flat).toHaveLength(lines.reduce((n, l) => n + l.length, 0));
  });
});

describe('perimeter and size for distance', () => {
  it('perimeter ratio is metres of outline per metre of size', () => {
    // a 2x2 normalised square outline = 8 units = 4 sizeMeters
    const square = [[{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }]];
    expect(xyGroupsPerimeterRatio(square)).toBeCloseTo(4, 9);
  });

  it('counts the jump between subpaths', () => {
    const two = [[{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 1, y: 1 }, { x: 0, y: 1 }]];
    // 1 + 1 (jump) + 1 = 3 units -> 1.5
    expect(xyGroupsPerimeterRatio(two)).toBeCloseTo(1.5, 9);
  });

  it('circle perimeter ratio is about pi', () => {
    expect(guidePerimeterRatio(guideById('circle')!)).toBeCloseTo(Math.PI, 2);
  });

  it('size for distance rounds to 10 m and clamps to 40..3000', () => {
    const circle = guideById('circle')!;
    const size = guideSizeForDistance(circle, 2000);
    expect(size % 10).toBe(0);
    expect(size).toBeCloseTo(2000 / (Math.PI * 1.2), -1);
    expect(guideSizeForDistance(circle, 1)).toBe(40);
    expect(guideSizeForDistance(circle, 1e9)).toBe(3000);
    expect(xyGroupsSizeForDistance(circle.subpaths, 2000, 1)).toBeGreaterThan(size);
  });
});

describe('guideSampleWaypoints', () => {
  it.each([
    ['paw', 5],
    ['spiral', 16],
    ['star', 11],
    ['heart', 12],
  ])('%s is limited to %i waypoints per subpath', (id, max) => {
    const g = guideById(id)!;
    const groups = guideSampleWaypoints(g, CENTER, 400);
    expect(groups).toHaveLength(g.subpaths.length);
    for (const grp of groups) expect(grp.length).toBeLessThanOrEqual(Math.max(max, 2));
  });

  it('keeps the first and last point of each subpath', () => {
    const heart = guideById('heart')!;
    const [wps] = guideSampleWaypoints(heart, CENTER, 400);
    const [full] = guideLatLngs(heart, CENTER, 400);
    expect(haversine(wps[0], full[0])).toBeLessThan(0.01);
    expect(haversine(wps[wps.length - 1], full[full.length - 1])).toBeLessThan(0.01);
  });
});
