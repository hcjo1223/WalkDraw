import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haversine, toLatLng, type LatLng } from './geo';
import {
  buildFallbackRoute,
  computeNavProgress,
  computeShapeSimilarity,
  fetchWalkableRoute,
  generateAiCandidates,
  generateSketchCandidates,
  hydrateSavedRoute,
  searchPlaces,
  turnIcon,
  type WalkableRoute,
} from './routing';

const O = { lat: 37.5665, lng: 126.978 };
/** metres east/north of O -> LatLng */
const at = (x: number, y: number): LatLng => toLatLng({ x, y }, O);
const lngLat = (p: LatLng): [number, number] => [p.lng, p.lat];

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // routing.ts uses window.setTimeout; tests run in node.
  vi.stubGlobal('window', globalThis);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** An L-shaped route: 200 m north, then 200 m east. */
function osrmL(extra: Record<string, unknown> = {}) {
  const a = at(0, 0);
  const b = at(0, 200);
  const c = at(200, 200);
  return {
    code: 'Ok',
    routes: [
      {
        distance: 400,
        geometry: { coordinates: [lngLat(a), lngLat(at(0, 100)), lngLat(b), lngLat(at(100, 200)), lngLat(c)] },
        legs: [
          {
            steps: [
              { distance: 200, name: '세종대로', maneuver: { type: 'depart', location: lngLat(a) } },
              { distance: 200, name: '종로', maneuver: { type: 'turn', modifier: 'right', location: lngLat(b) } },
              { distance: 0, name: '', maneuver: { type: 'arrive', location: lngLat(c) } },
            ],
          },
        ],
      },
    ],
    ...extra,
  };
}

describe('turnIcon', () => {
  it('has an icon for every turn type', () => {
    for (const t of [
      'depart',
      'straight',
      'slight-right',
      'right',
      'sharp-right',
      'slight-left',
      'left',
      'sharp-left',
      'uturn',
      'roundabout',
      'arrive',
    ] as const) {
      expect(turnIcon(t)).toBeTruthy();
    }
  });
});

describe('buildFallbackRoute', () => {
  it('draws straight lines and detects a left turn', () => {
    // north 100 m, then west 100 m = left turn
    const r = buildFallbackRoute([[at(0, 0), at(0, 100), at(-100, 100)]]);
    expect(r.isRealRoad).toBe(false);
    expect(r.totalDistanceM).toBeCloseTo(200, 0);
    expect(r.steps.map((s) => s.turnType)).toEqual(['depart', 'left', 'arrive']);
    expect(r.steps[2].startDistM).toBeCloseTo(200, 0);
  });

  it('detects a right turn and merges straight sections into the previous step', () => {
    const r = buildFallbackRoute([[at(0, 0), at(0, 50), at(0, 100), at(100, 100)]]);
    expect(r.steps.map((s) => s.turnType)).toEqual(['depart', 'right', 'arrive']);
    expect(r.steps[0].endDistM).toBeCloseTo(100, 0);
  });

  it('removes points closer than 2 m', () => {
    const r = buildFallbackRoute([[at(0, 0), at(0, 1), at(0, 50)]]);
    expect(r.path).toHaveLength(2);
  });

  it('adds a straight approach line when the user is 25 m..10 km away', () => {
    expect(buildFallbackRoute([[at(0, 0), at(0, 50)]], at(0, -100)).approachDistanceM).toBeCloseTo(100, 0);
    expect(buildFallbackRoute([[at(0, 0), at(0, 50)]], at(0, -10)).approachPath).toBeUndefined();
    expect(buildFallbackRoute([[at(0, 0), at(0, 50)]], at(0, -20000)).approachPath).toBeUndefined();
  });

  it('has no steps for a single point', () => {
    const r = buildFallbackRoute([[at(0, 0)]]);
    expect(r.steps).toEqual([]);
    expect(r.totalDistanceM).toBe(0);
  });

  it('hydrateSavedRoute keeps the isRealRoad flag', () => {
    expect(hydrateSavedRoute([at(0, 0), at(0, 100)], true).isRealRoad).toBe(true);
  });
});

describe('fetchWalkableRoute (OSRM parsing)', () => {
  it('calls the OSRM foot API with lng,lat pairs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(osrmL()));
    await fetchWalkableRoute([[at(0, 0), at(200, 200)]]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('routing.openstreetmap.de/routed-foot/route/v1/foot/');
    expect(url).toContain(`${O.lng.toFixed(6)},${O.lat.toFixed(6)};`);
    expect(url).toContain('steps=true');
  });

  it('turns an OSRM response into a real-road route with steps', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(osrmL()));
    const r = await fetchWalkableRoute([[at(0, 0), at(200, 200)]]);
    expect(r.isRealRoad).toBe(true);
    expect(r.path).toHaveLength(5);
    expect(r.totalDistanceM).toBeCloseTo(400, 0);
    expect(r.steps.map((s) => s.turnType)).toEqual(['depart', 'right', 'arrive']);
    expect(r.steps[1].instruction).toBe('우회전 · 종로');
    expect(r.steps[1].startDistM).toBeCloseTo(200, 0);
    expect(r.steps[2].endDistM).toBeCloseTo(r.totalDistanceM, 6);
  });

  it('drops the arrive/depart pair between legs and keeps the real turn', async () => {
    const body = osrmL();
    const a = at(0, 0);
    const b = at(0, 200);
    const c = at(200, 200);
    body.routes[0].legs = [
      {
        steps: [
          { distance: 200, name: 'A', maneuver: { type: 'depart', location: lngLat(a) } },
          { distance: 0, name: 'A', maneuver: { type: 'arrive', location: lngLat(b) } },
        ],
      },
      {
        steps: [
          { distance: 200, name: 'B', maneuver: { type: 'depart', modifier: 'left', location: lngLat(b) } },
          { distance: 0, name: '', maneuver: { type: 'arrive', location: lngLat(c) } },
        ],
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    const r = await fetchWalkableRoute([[a, b, c]]);
    expect(r.steps.map((s) => s.turnType)).toEqual(['depart', 'left', 'arrive']);
  });

  it('maps roundabouts', async () => {
    const body = osrmL();
    body.routes[0].legs[0].steps[1].maneuver = { type: 'roundabout', modifier: 'right', location: lngLat(at(0, 200)) };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    const r = await fetchWalkableRoute([[at(0, 0), at(200, 200)]]);
    expect(r.steps[1].turnType).toBe('roundabout');
  });

  it.each([
    ['code is not Ok', { code: 'NoRoute', routes: [] }, true],
    ['geometry is too short', { code: 'Ok', routes: [{ distance: 0, geometry: { coordinates: [[0, 0]] } }] }, true],
    ['HTTP error', {}, false],
  ])('falls back to straight lines when %s', async (_why, body, ok) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(body, ok, ok ? 200 : 503));
    const r = await fetchWalkableRoute([[at(0, 0), at(0, 100)]]);
    expect(r.isRealRoad).toBe(false);
    expect(r.totalDistanceM).toBeCloseTo(100, 0);
  });

  it('falls back when the network fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const r = await fetchWalkableRoute([[at(0, 0), at(0, 100)]]);
    expect(r.isRealRoad).toBe(false);
  });

  it('does not call the network for fewer than 2 waypoints', async () => {
    const r = await fetchWalkableRoute([[at(0, 0)]]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.isRealRoad).toBe(false);
  });

  it('merges waypoints closer than 6 m and caps them at 24', async () => {
    fetchMock.mockResolvedValue(jsonResponse(osrmL()));
    const many = Array.from({ length: 100 }, (_, i) => at(0, i * 10));
    await fetchWalkableRoute([[at(0, 0), at(0, 3), ...many.slice(1)]]);
    const coords = String(fetchMock.mock.calls[0][0]).split('/foot/')[1].split('?')[0].split(';');
    expect(coords).toHaveLength(24);
  });

  it('rethrows when the caller aborts mid-request', async () => {
    const ctrl = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_res, rej) => {
        init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        ctrl.abort();
      });
    });
    await expect(fetchWalkableRoute([[at(0, 0), at(0, 100)]], null, ctrl.signal)).rejects.toThrow();
  });

  it('does not start a request when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.signal?.aborted
        ? Promise.reject(new DOMException('aborted', 'AbortError'))
        : Promise.resolve(jsonResponse(osrmL())),
    );
    await expect(fetchWalkableRoute([[at(0, 0), at(0, 100)]], null, ctrl.signal)).rejects.toThrow();
  });

  describe('approach path from the user to the start', () => {
    it('asks OSRM for a walking approach when the user is 30 m..5 km away', async () => {
      const approach = { code: 'Ok', routes: [{ distance: 130, geometry: { coordinates: [lngLat(at(0, -100)), lngLat(at(0, 0))] } }] };
      fetchMock.mockResolvedValueOnce(jsonResponse(osrmL())).mockResolvedValueOnce(jsonResponse(approach));
      const r = await fetchWalkableRoute([[at(0, 0), at(200, 200)]], at(0, -100));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(r.approachDistanceM).toBe(130);
      expect(r.approachPath).toHaveLength(2);
    });

    it('uses a straight line if the approach request fails', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(osrmL())).mockRejectedValueOnce(new Error('x'));
      const r = await fetchWalkableRoute([[at(0, 0), at(200, 200)]], at(0, -100));
      expect(r.isRealRoad).toBe(true);
      expect(r.approachDistanceM).toBeCloseTo(100, 0);
    });

    it('skips the approach when the user is already at the start', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(osrmL()));
      const r = await fetchWalkableRoute([[at(0, 0), at(200, 200)]], at(0, -10));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(r.approachPath).toBeUndefined();
    });
  });
});

describe('computeNavProgress', () => {
  const route: WalkableRoute = buildFallbackRoute([[at(0, 0), at(0, 200), at(200, 200)]]);

  it('reports the start when there is no location', () => {
    const p = computeNavProgress(route, null);
    expect(p.traveledM).toBe(0);
    expect(p.currentStep?.turnType).toBe('depart');
    expect(p.nextStep?.turnType).toBe('right');
  });

  it('projects the location onto the route', () => {
    const p = computeNavProgress(route, at(5, 100));
    expect(p.traveledM).toBeCloseTo(100, 0);
    expect(p.distFromRouteM).toBeCloseTo(5, 0);
    expect(p.offRoute).toBe(false);
    expect(p.progressRatio).toBeCloseTo(0.25, 2);
    expect(p.distToNextStepM).toBeCloseTo(100, 0);
  });

  it('flags off-route beyond 48 m', () => {
    expect(computeNavProgress(route, at(60, 100)).offRoute).toBe(true);
  });

  it('moves to the next step after the turn', () => {
    const p = computeNavProgress(route, at(100, 200), 150);
    expect(p.currentStep?.turnType).toBe('right');
    expect(p.remainingM).toBeCloseTo(100, 0);
  });

  it('arrives within 15 m of the end', () => {
    const p = computeNavProgress(route, at(195, 200), 300);
    expect(p.isArrived).toBe(true);
    expect(p.currentStep?.turnType).toBe('arrive');
    expect(p.nextStep).toBeNull();
  });

  it('does not jump to the end of a loop when standing at the shared start/end point', () => {
    const loop = buildFallbackRoute([[at(0, 0), at(0, 200), at(200, 200), at(200, 0), at(0, 0)]]);
    const p = computeNavProgress(loop, at(0, 0), 0);
    expect(p.traveledM).toBeLessThan(20);
    expect(p.isArrived).toBe(false);
  });

  it('handles an empty route', () => {
    const p = computeNavProgress(buildFallbackRoute([[at(0, 0)]]), at(0, 0));
    expect(p.traveledM).toBe(0);
    expect(p.currentStep).toBeNull();
  });
});

describe('searchPlaces (Nominatim parsing)', () => {
  it('returns nothing for a blank query without calling the network', async () => {
    expect(await searchPlaces('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses name, address and coordinates', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { place_id: 123, name: '서울시청', display_name: '서울시청, 세종대로, 중구, 서울, 대한민국', lat: '37.5663', lon: '126.9779' },
        { place_id: '9', display_name: '광화문, 종로구, 서울', lat: '37.57', lon: '126.97' },
      ]),
    );
    const r = await searchPlaces(' 시청 ', O);
    expect(r[0]).toEqual({ id: '123', name: '서울시청', address: '세종대로 중구 서울', location: { lat: 37.5663, lng: 126.9779 } });
    expect(r[1].name).toBe('광화문');
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('q')).toBe('시청');
    expect(url.searchParams.get('viewbox')).toBeTruthy();
  });

  it('returns nothing on an HTTP error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([], false, 429));
    expect(await searchPlaces('x')).toEqual([]);
  });
});

describe('computeShapeSimilarity', () => {
  const square = [at(0, 0), at(0, 100), at(100, 100), at(100, 0), at(0, 0)];

  it('scores an identical shape at the 98% cap', () => {
    expect(computeShapeSimilarity(square, square)).toBe(98);
  });

  it('ignores size and position (same shape, other place and scale)', () => {
    const big = square.map((p) => ({ lat: O.lat + (p.lat - O.lat) * 3 + 0.01, lng: O.lng + (p.lng - O.lng) * 3 }));
    expect(computeShapeSimilarity(square, big)).toBeGreaterThanOrEqual(95);
  });

  it('scores a different shape lower than a close one', () => {
    const wobbly = [at(0, 0), at(5, 100), at(100, 95), at(95, 0), at(0, 0)];
    const line = [at(0, 0), at(100, 100)];
    const close = computeShapeSimilarity(square, wobbly);
    const far = computeShapeSimilarity(square, line);
    expect(close).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(48);
  });

  it('returns 75 when there are too few points', () => {
    expect(computeShapeSimilarity([O], square)).toBe(75);
  });

  it('stays inside 48..98', () => {
    const zig = Array.from({ length: 30 }, (_, i) => at(i * 10, i % 2 ? 300 : 0));
    const s = computeShapeSimilarity(square, zig);
    expect(s).toBeGreaterThanOrEqual(48);
    expect(s).toBeLessThanOrEqual(98);
  });
});

describe('candidate generators', () => {
  it('generateSketchCandidates returns 3 variants with similarity', async () => {
    fetchMock.mockResolvedValue(jsonResponse(osrmL()));
    const shape = [[{ x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }]];
    const c = await generateSketchCandidates(shape, O, 300, 350);
    expect(c.map((x) => x.id)).toEqual(['c1', 'c2', 'c3']);
    for (const x of c) {
      expect(x.route.isRealRoad).toBe(true);
      expect(x.similarity).toBeGreaterThanOrEqual(48);
      expect(x.similarity).toBeLessThanOrEqual(98);
    }
  });

  it('generateAiCandidates sorts by closeness to the target distance', async () => {
    fetchMock.mockRejectedValue(new Error('offline')); // straight-line fallback
    const c = await generateAiCandidates({ origin: O, roundTrip: true, targetDistM: 1500 });
    expect(c).toHaveLength(3);
    expect(c[0].label).toBe('추천 산책 코스');
    const gaps = c.map((x) => Math.abs(x.route.totalDistanceM - 1500));
    expect([...gaps].sort((a, b) => a - b)).toEqual(gaps);
  });

  it('generateAiCandidates with a one-way waypoint ends every course at the waypoint', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const wp = at(0, 800);
    const c = await generateAiCandidates({ origin: O, waypoint: wp, roundTrip: false, targetDistM: 1200 });
    for (const x of c) {
      const end = x.route.path[x.route.path.length - 1];
      expect(haversine(end, wp)).toBeLessThan(1);
    }
  });
});
