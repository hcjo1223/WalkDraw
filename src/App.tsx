import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CardView from './components/CardView';
import Gallery from './components/Gallery';
import MapView, { type MapHandle } from './components/MapView';
import {
  formatClock,
  formatDistance,
  formatPace,
  haversine,
  interpolateLatLng,
  pathDistance,
  type LatLng,
  type PathPoint,
  type Walk,
} from './lib/geo';
import {
  GUIDES,
  guideById,
  guideLatLngs,
  guidePerimeterRatio,
  guideSampleWaypoints,
  guideSizeForDistance,
  guideWalkPath,
} from './lib/guides';
import {
  DIST_PRESETS_M,
  PACE_PRESETS,
  TIME_PRESETS_MIN,
  calcDistanceFromMinutes,
  calcMinutesFromDistance,
  formatEstimatedMinutes,
  paceById,
  type GoalMode,
  type PaceId,
} from './lib/pace';
import {
  computeNavProgress,
  fetchWalkableRoute,
  turnIcon,
  type WalkableRoute,
} from './lib/routing';
import { makeLoop, walkAlongPath, type WalkController } from './lib/simulate';
import {
  clearDraft,
  deleteWalk,
  listWalks,
  loadDraft,
  newId,
  saveDraft,
  saveWalk,
  type Draft,
} from './lib/storage';

const DEFAULT_CENTER: LatLng = { lat: 37.3945, lng: 126.9632 };

const COLORS = [
  { v: '#6EF3B6', label: '민트' },
  { v: '#C8FF4D', label: '라임' },
  { v: '#5EC8FF', label: '스카이' },
  { v: '#B79CFF', label: '바이올렛' },
  { v: '#FF8FA3', label: '로즈' },
  { v: '#FFC46B', label: '앰버' },
  { v: '#F2F5F9', label: '화이트' },
];

const WIDTHS = [3, 5, 8, 12, 18];

type Mode = 'idle' | 'recording' | 'paused';
type Page = 'main' | 'guide' | 'goal' | 'style';
type View = 'map' | 'card' | 'gallery';

function defaultTitle(guideName?: string | null) {
  const h = new Date().getHours();
  const slot =
    h < 5 ? '새벽' : h < 11 ? '아침' : h < 14 ? '점심' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤';
  return guideName ? `${slot} ${guideName} 산책` : `${slot} 산책`;
}

export default function App() {
  const mapRef = useRef<MapHandle | null>(null);

  const [mode, setMode] = useState<Mode>('idle');
  const [points, setPoints] = useState<PathPoint[]>([]);
  const [color, setColor] = useState(COLORS[0].v);
  const [width, setWidth] = useState(5);
  const [sim, setSim] = useState(false);

  // 도안 상태
  const [guideId, setGuideId] = useState<string | null>(null);
  const [guideSize, setGuideSize] = useState(240);
  const [guideRot, setGuideRot] = useState(0);
  const [guideCenter, setGuideCenter] = useState<LatLng | null>(null);

  // 도보 목표(시간/거리) + 3단계 속도
  const [goalMode, setGoalMode] = useState<GoalMode>('time');
  const [goalMinutes, setGoalMinutes] = useState(20);
  const [goalDistanceM, setGoalDistanceM] = useState(1500);
  const [paceId, setPaceId] = useState<PaceId>('walk');
  const [autoSizeToGoal, setAutoSizeToGoal] = useState(true);

  // 실제 도보 네비게이션
  const [walkableNavEnabled, setWalkableNavEnabled] = useState(true);
  const [walkableRoute, setWalkableRoute] = useState<WalkableRoute | null>(null);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routeRefreshSeq, setRouteRefreshSeq] = useState(0);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);

  const [mapCenter, setMapCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [myLoc, setMyLoc] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [tile, setTile] = useState<'dark' | 'voyager'>('dark');
  const [page, setPage] = useState<Page>('main');
  const [view, setView] = useState<View>('map');
  const [walk, setWalk] = useState<Walk | null>(null);
  const [walks, setWalks] = useState<Walk[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [autoWalking, setAutoWalking] = useState(false);
  const [justFinished, setJustFinished] = useState(false);

  const startRef = useRef(0);
  const elapsedRef = useRef(0);
  const autoRef = useRef<WalkController | null>(null);
  const toastTimer = useRef(0);
  const titleTimer = useRef(0);
  const transformingRef = useRef(false);
  const navPrevDistRef = useRef(0);
  const lastSpokenStepRef = useRef<number | null>(null);

  const pointsRef = useRef<PathPoint[]>(points);
  const walkRef = useRef<Walk | null>(walk);
  const myLocRef = useRef<LatLng | null>(myLoc);
  pointsRef.current = points;
  walkRef.current = walk;
  myLocRef.current = myLoc;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const refreshWalks = useCallback(async () => {
    setWalks(await listWalks());
  }, []);

  useEffect(() => {
    refreshWalks();
    setDraft(loadDraft());
    return () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(titleTimer.current);
    };
  }, [refreshWalks]);

  /* ---------------- 목표 · 속도 계산 ---------------- */

  const activePace = useMemo(() => paceById(paceId), [paceId]);
  const targetDistanceM = useMemo(
    () => (goalMode === 'time' ? calcDistanceFromMinutes(goalMinutes, paceId) : goalDistanceM),
    [goalMode, goalMinutes, goalDistanceM, paceId],
  );
  const estimatedGoalMinutes = useMemo(
    () => (goalMode === 'time' ? goalMinutes : calcMinutesFromDistance(goalDistanceM, paceId)),
    [goalMode, goalMinutes, goalDistanceM, paceId],
  );

  /* ---------------- 위치 ---------------- */

  const appendPoints = useCallback((list: LatLng[], minDist = 1.0) => {
    setPoints((prev) => {
      const out = prev.slice();
      for (const p of list) {
        const last = out[out.length - 1];
        if (last) {
          const d = haversine(last, p);
          if (d < minDist) continue;
          if (d > 150) {
            out.push({ ...p, t: Date.now(), brk: true });
            continue;
          }
        }
        out.push({ ...p, t: Date.now() });
      }
      return out.length === prev.length ? prev : out;
    });
  }, []);

  const appendRef = useRef(appendPoints);
  appendRef.current = appendPoints;

  // 첫 위치 한 번 잡기
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyLoc(p);
        setAccuracy(pos.coords.accuracy);
        mapRef.current?.flyTo(p, 17);
      },
      () => {
        /* 권한 없음 — 실내 테스트가 바로 가능하도록 시뮬레이션 모드로 안내 */
        setSim(true);
        showToast('위치를 쓸 수 없어 시뮬레이션 모드로 시작했어요. 지도를 눌러 그려 보세요.');
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 },
    );
  }, [showToast]);

  // 실시간 GPS 기록
  useEffect(() => {
    if (sim || mode !== 'recording') return;
    if (!('geolocation' in navigator)) {
      showToast('이 브라우저에서는 위치를 쓸 수 없어요. 시뮬레이션 모드로 테스트해 보세요.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyLoc(p);
        setAccuracy(pos.coords.accuracy);
        if (pos.coords.accuracy <= 80) appendRef.current([p], 1.0);
      },
      (err) => {
        if (err.code === 1) {
          showToast('위치 권한이 거부됐어요. 설정에서 위치를 허용하거나 시뮬레이션을 켜 주세요.');
        } else {
          showToast('위치를 잡지 못했어요. 시뮬레이션 모드로 테스트할 수 있어요.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [sim, mode, showToast]);

  // 기록 중이면 내 위치 따라가기
  useEffect(() => {
    if (mode !== 'recording' || sim || !myLoc) return;
    const c = mapRef.current?.center();
    if (!c || haversine(c, myLoc) > 90) mapRef.current?.flyTo(myLoc, 17);
  }, [myLoc, mode, sim]);

  /* ---------------- 시간 ---------------- */

  useEffect(() => {
    if (mode !== 'recording') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [mode]);

  const elapsed =
    mode === 'recording' ? elapsedRef.current + (now - startRef.current) : elapsedRef.current;
  const distance = useMemo(() => pathDistance(points), [points]);

  /* ---------------- 임시 저장 ---------------- */

  useEffect(() => {
    if (mode === 'idle') return;
    const id = window.setInterval(() => {
      if (pointsRef.current.length >= 2) {
        saveDraft({
          points: pointsRef.current,
          color,
          width,
          guideId,
          startedAt: startRef.current || Date.now(),
        });
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [mode, color, width, guideId]);

  /* ---------------- 도안 & 실제 도보 경로 탐색 ---------------- */

  const activeGuide = useMemo(() => guideById(guideId), [guideId]);
  const effectiveGuideCenter = useMemo(
    () => (guideId ? (guideCenter ?? myLoc ?? mapCenter) : null),
    [guideId, guideCenter, myLoc, mapCenter],
  );

  const guide = useMemo(() => {
    if (!activeGuide || !effectiveGuideCenter) return null;
    return guideLatLngs(activeGuide, effectiveGuideCenter, guideSize, guideRot);
  }, [activeGuide, effectiveGuideCenter, guideSize, guideRot]);

  const estimatedGuideDistanceM = useMemo(() => {
    if (!activeGuide) return 0;
    const detour = walkableNavEnabled ? 1.2 : 1.0;
    return Math.round(guidePerimeterRatio(activeGuide) * guideSize * detour);
  }, [activeGuide, guideSize, walkableNavEnabled]);

  // 도안이 활성화되고 실제 도보 네비가 켜져 있으면 도로 기반 경로 탐색
  useEffect(() => {
    if (!activeGuide || !effectiveGuideCenter || !walkableNavEnabled) {
      setWalkableRoute(null);
      setRoutingBusy(false);
      navPrevDistRef.current = 0;
      return;
    }
    if (transformingRef.current) return;

    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setRoutingBusy(true);
      try {
        const groups = guideSampleWaypoints(activeGuide, effectiveGuideCenter, guideSize, guideRot);
        const route = await fetchWalkableRoute(groups, myLocRef.current, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setWalkableRoute(route);
          navPrevDistRef.current = 0;
          lastSpokenStepRef.current = null;
        }
      } catch {
        /* 취소됨 */
      } finally {
        if (!ctrl.signal.aborted) setRoutingBusy(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [activeGuide, effectiveGuideCenter, guideSize, guideRot, walkableNavEnabled, routeRefreshSeq]);

  const navProgress = useMemo(() => {
    if (!walkableRoute) return null;
    return computeNavProgress(walkableRoute, myLoc, navPrevDistRef.current);
  }, [walkableRoute, myLoc]);

  useEffect(() => {
    if (navProgress && !navProgress.offRoute) {
      navPrevDistRef.current = navProgress.traveledM;
    }
  }, [navProgress]);

  // TTS 음성 안내 (옵션)
  useEffect(() => {
    if (!ttsEnabled || mode !== 'recording' || !navProgress?.currentStep) return;
    const step = navProgress.currentStep;
    if (lastSpokenStepRef.current === step.id) return;
    lastSpokenStepRef.current = step.id;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const text =
          step.turnType === 'arrive'
            ? '도안 완주 지점에 도착했습니다.'
            : `${step.instruction}${step.distanceM >= 20 ? `, ${Math.round(step.distanceM)}미터 직진` : ''}`;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        u.rate = 1.05;
        window.speechSynthesis.speak(u);
      } catch {
        /* 미지원 환경 무시 */
      }
    }
  }, [ttsEnabled, mode, navProgress]);

  const selectGuide = useCallback(
    (id: string) => {
      const g = guideById(id);
      if (!g) return;
      const baseCenter = guideCenter ?? myLoc ?? mapCenter;
      setGuideCenter(baseCenter);
      setGuideId(g.id);
      setGuideRot(0);
      if (autoSizeToGoal) {
        const nextSize = guideSizeForDistance(g, targetDistanceM, walkableNavEnabled ? 1.2 : 1.0);
        setGuideSize(nextSize);
      }
      showToast(`${g.name} 도안을 띄웠어요. 지도에서 드래그해 옮길 수 있어요.`);
    },
    [guideCenter, myLoc, mapCenter, autoSizeToGoal, targetDistanceM, walkableNavEnabled, showToast],
  );

  const syncGuideSizeToGoal = useCallback(
    (distM: number) => {
      if (!activeGuide || !autoSizeToGoal) return;
      setGuideSize(guideSizeForDistance(activeGuide, distM, walkableNavEnabled ? 1.2 : 1.0));
    },
    [activeGuide, autoSizeToGoal, walkableNavEnabled],
  );

  /* ---------------- 동작 ---------------- */

  const startAutoWalk = useCallback(() => {
    if (autoWalking) {
      autoRef.current?.stop();
      setAutoWalking(false);
      showToast('자동 걷기를 멈췄어요.');
      return;
    }
    if (mode !== 'recording') {
      showToast('먼저 산책을 시작해 주세요.');
      return;
    }
    if (!sim) {
      showToast('자동 걷기는 시뮬레이션 모드에서 쓸 수 있어요.');
      return;
    }

    const g = guideById(guideId);
    const center = effectiveGuideCenter ?? myLoc ?? mapRef.current?.center() ?? DEFAULT_CENTER;

    let path: LatLng[];
    if (walkableRoute && walkableRoute.path.length >= 2) {
      path = walkableRoute.path.slice();
      navPrevDistRef.current = 0;
    } else if (g) {
      path = guideWalkPath(g, center, guideSize, guideRot);
    } else {
      path = makeLoop(center, guideSize);
    }

    autoRef.current?.stop();
    autoRef.current = walkAlongPath(path, {
      speed: activePace.simSpeed,
      onPoint: (p) => {
        appendRef.current([p], 0.05);
        setMyLoc(p);
        setAccuracy(5);
      },
      onDone: () => {
        setAutoWalking(false);
        showToast('도보 코스를 다 걸었어요! 완료를 눌러 카드를 만들어 보세요.');
      },
    });
    setAutoWalking(true);
    showToast(
      walkableRoute?.isRealRoad
        ? `${g?.name ?? '도보'} 실제 도로 네비대로 걷는 중… (${activePace.label})`
        : g
          ? `${g.name} 도안을 따라 걷는 중… (${activePace.label})`
          : '자유 데모 루트를 걷는 중…',
    );
  }, [
    autoWalking,
    mode,
    sim,
    guideId,
    effectiveGuideCenter,
    myLoc,
    walkableRoute,
    guideSize,
    guideRot,
    activePace,
    showToast,
  ]);

  const beginWalk = useCallback(() => {
    setPoints([]);
    setNow(Date.now());
    elapsedRef.current = 0;
    startRef.current = Date.now();
    navPrevDistRef.current = 0;
    lastSpokenStepRef.current = null;
    setMode('recording');
    setPage('main');
    setDraft(null);
    clearDraft();
    if (!sim && !window.isSecureContext) {
      showToast('GPS는 HTTPS에서만 동작해요. 지금은 시뮬레이션을 켜서 테스트해 보세요.');
    } else if (sim) {
      showToast('지도를 눌러 점을 찍거나 [자동 걷기]를 눌러 보세요.');
    } else {
      showToast('기록을 시작했어요. 네비 안내를 따라 걸어 보세요.');
    }
  }, [sim, showToast]);

  const pauseWalk = useCallback(() => {
    elapsedRef.current += Date.now() - startRef.current;
    startRef.current = 0;
    autoRef.current?.stop();
    setAutoWalking(false);
    setMode('paused');
    setNow(Date.now());
  }, []);

  const resumeWalk = useCallback(() => {
    startRef.current = Date.now();
    setMode('recording');
    setNow(Date.now());
    showToast(sim ? '이어서 그려 볼까요.' : '이어서 기록합니다.');
  }, [sim, showToast]);

  const finishWalk = useCallback(async () => {
    autoRef.current?.stop();
    setAutoWalking(false);
    const total =
      mode === 'recording' ? elapsedRef.current + (Date.now() - startRef.current) : elapsedRef.current;
    const pts = pointsRef.current;
    const dist = pathDistance(pts);
    if (pts.length < 2 || dist < 3) {
      showToast('아직 그린 선이 거의 없어요. 조금 더 걸어 보세요.');
      return;
    }
    const g = guideById(guideId);
    const w: Walk = {
      id: newId(),
      title: defaultTitle(g?.name),
      createdAt: Date.now(),
      points: pts,
      color,
      width,
      guideId,
      distanceM: dist,
      durationMs: Math.max(total, 1000),
    };
    await saveWalk(w);
    clearDraft();
    setDraft(null);
    setMode('idle');
    setPoints([]);
    elapsedRef.current = 0;
    startRef.current = 0;
    setNow(Date.now());
    setWalk(w);
    setJustFinished(true);
    setView('card');
    refreshWalks();
    showToast('그림 카드가 완성됐어요!');
  }, [mode, color, width, guideId, showToast, refreshWalks]);

  const cancelWalk = useCallback(() => {
    autoRef.current?.stop();
    setAutoWalking(false);
    setMode('idle');
    setPoints([]);
    elapsedRef.current = 0;
    startRef.current = 0;
    setNow(Date.now());
    clearDraft();
    setDraft(null);
    showToast('기록을 취소했어요.');
  }, [showToast]);

  const onMapClick = useCallback(
    (ll: LatLng) => {
      if (mode === 'recording') {
        if (!sim) return;
        const last = pointsRef.current[pointsRef.current.length - 1];
        if (!last) appendRef.current([ll], 0.01);
        else appendRef.current(interpolateLatLng(last, ll, 5), 0.01);
        setMyLoc(ll);
        setAccuracy(6);
        return;
      }
      if (guideId) {
        setGuideCenter(ll);
        showToast('도안을 여기로 옮겼어요.');
      }
    },
    [mode, sim, guideId, showToast],
  );

  const handleGuideMove = useCallback((ll: LatLng) => {
    transformingRef.current = true;
    setGuideCenter(ll);
  }, []);

  const handleGuideRotate = useCallback((deg: number) => {
    transformingRef.current = true;
    setGuideRot(deg);
  }, []);

  const handleGuideTransformEnd = useCallback(() => {
    transformingRef.current = false;
    setRouteRefreshSeq((n) => n + 1);
  }, []);

  const handleTitle = useCallback((id: string, title: string) => {
    const cur = walkRef.current;
    if (!cur || cur.id !== id) return;
    const next = { ...cur, title };
    setWalk(next);
    walkRef.current = next;
    window.clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(() => {
      saveWalk(next);
      setWalks((list) => list.map((x) => (x.id === id ? next : x)));
    }, 500);
  }, []);

  /* ---------------- 렌더 ---------------- */

  const rec = mode === 'recording';
  const paused = mode === 'paused';
  const idle = mode === 'idle';

  // 목표 진행률 (실제 도보 경로가 있으면 경로 길이 기준, 없으면 목표 거리 기준)
  const activeGoalDistM =
    walkableRoute && walkableRoute.totalDistanceM > 0
      ? walkableRoute.totalDistanceM
      : targetDistanceM;
  const goalProgressPct = Math.min(
    100,
    Math.round(((distance || 0) / Math.max(1, activeGoalDistM)) * 100),
  );
  const navRouteEtaMin = walkableRoute
    ? calcMinutesFromDistance(walkableRoute.totalDistanceM, paceId)
    : estimatedGoalMinutes;
  const navRemainEtaMin = navProgress
    ? calcMinutesFromDistance(navProgress.remainingM, paceId)
    : navRouteEtaMin;

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink text-zinc-100">
      <MapView
        ref={mapRef}
        points={points}
        color={color}
        width={width}
        guide={guide}
        guideCenter={effectiveGuideCenter}
        guideRot={guideRot}
        guideInteractive={!rec && Boolean(guideId)}
        walkableRoute={walkableRoute}
        activeNavPoint={rec && navProgress?.nextStep ? navProgress.nextStep.location : null}
        myLoc={myLoc}
        accuracy={accuracy}
        tile={tile}
        onMapClick={onMapClick}
        onCenterChange={setMapCenter}
        onGuideMove={handleGuideMove}
        onGuideRotate={handleGuideRotate}
        onGuideTransformEnd={handleGuideTransformEnd}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-3 pt-[max(0.7rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-[#0B1017]/85 px-3 py-1.5 backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-lime" />
          <span className="text-[12px] font-bold tracking-[0.16em] text-zinc-200">WALK DRAW</span>
          {rec && <span className="text-[10px] font-semibold text-rose">REC</span>}
          {paused && <span className="text-[10px] font-semibold text-amber">PAUSE</span>}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0B1017]/85 backdrop-blur-md">
            <button
              onClick={() => mapRef.current?.zoomIn()}
              className="h-9 w-9 text-lg leading-none text-zinc-300 active:bg-white/10"
              aria-label="확대"
            >
              +
            </button>
            <div className="h-px bg-white/10" />
            <button
              onClick={() => mapRef.current?.zoomOut()}
              className="h-9 w-9 text-lg leading-none text-zinc-300 active:bg-white/10"
              aria-label="축소"
            >
              −
            </button>
          </div>

          <button
            onClick={() => setTile(tile === 'dark' ? 'voyager' : 'dark')}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[#0B1017]/85 text-sm backdrop-blur-md active:scale-95"
            aria-label="지도 스타일"
          >
            {tile === 'dark' ? '🗺' : '🌙'}
          </button>

          <button
            onClick={() => {
              if (myLoc) mapRef.current?.flyTo(myLoc, 17);
              else {
                navigator.geolocation?.getCurrentPosition((pos) => {
                  const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                  setMyLoc(p);
                  setAccuracy(pos.coords.accuracy);
                  mapRef.current?.flyTo(p, 17);
                });
                showToast('내 위치를 찾는 중…');
              }
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[#0B1017]/85 text-sm backdrop-blur-md active:scale-95"
            aria-label="내 위치"
          >
            📍
          </button>

          <button
            onClick={async () => {
              await refreshWalks();
              setView('gallery');
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[#0B1017]/85 text-sm backdrop-blur-md active:scale-95"
            aria-label="갤러리"
          >
            🖼
          </button>
        </div>
      </div>

      {/* 실제 도보 네비게이션 HUD 배너 */}
      {guideId && walkableNavEnabled && (routingBusy || walkableRoute) && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+52px)] z-20 pl-3 pr-14">
          <div className="pointer-events-auto max-w-md rounded-2xl border border-white/12 bg-[#0B1017]/90 px-3 py-2.5 shadow-xl backdrop-blur-md">
            {routingBusy && !walkableRoute ? (
              <div className="flex items-center gap-2 text-[12px] text-sky">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky" />
                실제 도보 길로 네비게이션 경로를 찾는 중…
              </div>
            ) : walkableRoute ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky/15 text-lg font-bold text-sky">
                      {rec && navProgress?.offRoute
                        ? '🧭'
                        : rec && navProgress?.currentStep
                          ? turnIcon(navProgress.currentStep.turnType)
                          : '🚶'}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold text-white">
                        {rec && navProgress?.offRoute
                          ? `경로에서 ${Math.round(navProgress.distFromRouteM)}m 벗어남`
                          : rec && navProgress?.currentStep
                            ? navProgress.currentStep.instruction
                            : walkableRoute.isRealRoad
                              ? `${activeGuide?.name ?? '도안'} 실제 도보 코스`
                              : `${activeGuide?.name ?? '도안'} 직선 안내 코스`}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-400">
                        {rec && navProgress ? (
                          navProgress.isArrived ? (
                            <span className="font-semibold text-lime">완주 지점 도착!</span>
                          ) : (
                            <>
                              <span className="font-semibold text-sky">
                                {navProgress.nextStep
                                  ? `${formatDistance(navProgress.distToNextStepM)} 앞 ${navProgress.nextStep.instruction}`
                                  : `도착까지 ${formatDistance(navProgress.remainingM)}`}
                              </span>
                              <span>· 남음 {formatEstimatedMinutes(navRemainEtaMin)}</span>
                            </>
                          )
                        ) : (
                          <>
                            <span className={walkableRoute.isRealRoad ? 'text-mint' : 'text-amber'}>
                              {walkableRoute.isRealRoad ? '실제 도보길' : '직선 대체'}
                            </span>
                            <span>
                              {formatDistance(walkableRoute.totalDistanceM)} · {activePace.emoji}{' '}
                              {formatEstimatedMinutes(navRouteEtaMin)}
                            </span>
                            {walkableRoute.approachDistanceM && walkableRoute.approachDistanceM > 35 && (
                              <span className="text-sky">
                                · 출발점 {formatDistance(walkableRoute.approachDistanceM)}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => setTtsEnabled((v) => !v)}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs ${
                        ttsEnabled
                          ? 'border-lime/40 bg-lime/15 text-lime'
                          : 'border-white/10 bg-white/[0.04] text-zinc-400'
                      }`}
                      aria-label="음성 안내"
                      title="음성 안내 켜기/끄기"
                    >
                      {ttsEnabled ? '🔊' : '🔇'}
                    </button>
                    <button
                      onClick={() => setRouteRefreshSeq((n) => n + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-xs text-zinc-300 active:scale-95"
                      aria-label="경로 재탐색"
                      title="도보 경로 재탐색"
                    >
                      {routingBusy ? '⏳' : '🔄'}
                    </button>
                    <button
                      onClick={() => setNavCollapsed((c) => !c)}
                      className="flex h-7 w-6 items-center justify-center rounded-lg text-[11px] text-zinc-400"
                      aria-label="네비 접기"
                    >
                      {navCollapsed ? '▾' : '▴'}
                    </button>
                  </div>
                </div>

                {!navCollapsed && (
                  <div className="mt-2">
                    {rec && navProgress ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky to-lime transition-all"
                          style={{ width: `${Math.round(navProgress.progressRatio * 100)}%` }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-[10px] text-zinc-500">
                        <span>✥ 중앙·도안을 드래그해 이동 · ↻ 핸들로 회전</span>
                        <span>경유 안내 {walkableRoute.steps.length}구간</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+128px)] z-50 flex justify-center px-6">
          <div className="fade-up max-w-[92%] rounded-2xl border border-white/10 bg-[#111A24]/95 px-3.5 py-2 text-center text-[12px] leading-snug text-zinc-200 shadow-lg backdrop-blur">
            {toast}
          </div>
        </div>
      )}

      {/* 하단 시트 */}
      <div className="sheet absolute inset-x-0 bottom-0 z-30 rounded-t-[26px] px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-2 no-select">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" />

        {page === 'main' && (
          <>
            {draft && idle && (
              <div className="mb-3 rounded-2xl border border-lime/25 bg-lime/[0.08] p-3">
                <div className="text-[12px] font-semibold text-lime">이어 그릴 산책이 있어요</div>
                <div className="mt-0.5 text-[11px] text-zinc-400">
                  {formatDistance(pathDistance(draft.points))} · 지점 {draft.points.length}개
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => {
                      setPoints(draft.points);
                      setColor(draft.color);
                      setWidth(draft.width);
                      setGuideId(draft.guideId);
                      elapsedRef.current = Math.max(0, Date.now() - draft.startedAt);
                      startRef.current = 0;
                      setMode('paused');
                      setDraft(null);
                      showToast('이어서 그릴 수 있어요. 재개를 눌러 주세요.');
                    }}
                    className="rounded-xl bg-lime px-3 py-1.5 text-[12px] font-bold text-[#0B1015] active:scale-95"
                  >
                    이어 그리기
                  </button>
                  <button
                    onClick={() => {
                      clearDraft();
                      setDraft(null);
                    }}
                    className="rounded-xl border border-white/10 px-3 py-1.5 text-[12px] text-zinc-400 active:scale-95"
                  >
                    버리기
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-end justify-between px-1">
              <Stat label="거리" value={formatDistance(distance)} />
              <Stat label="시간" value={mode === 'idle' ? '00:00' : formatClock(elapsed)} />
              <Stat label="페이스" value={formatPace(distance, elapsed)} suffix="/km" />
            </div>

            {/* 목표 & 속도 요약 바 */}
            <div className="mt-2 px-1">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>
                  {activePace.emoji} {activePace.label} · 목표{' '}
                  <strong className="text-zinc-200">{formatDistance(activeGoalDistM)}</strong> (약{' '}
                  {formatEstimatedMinutes(
                    walkableRoute ? navRouteEtaMin : estimatedGoalMinutes,
                  )}
                  )
                </span>
                {(rec || paused) && (
                  <span className="font-semibold tabular-nums text-lime">{goalProgressPct}%</span>
                )}
              </div>
              {(rec || paused) && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-lime transition-all"
                    style={{ width: `${goalProgressPct}%` }}
                  />
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2 overflow-x-auto scroll-x pb-1">
              <button
                onClick={() => setPage('style')}
                className="chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[12px] text-zinc-200"
              >
                <span className="h-3 w-3 rounded-full" style={{ background: color }} />
                색 · 굵기
              </button>
              <button
                onClick={() => setPage('guide')}
                className={`chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[12px] ${
                  activeGuide ? 'border-lime/40 bg-lime/10 text-lime' : 'text-zinc-200'
                }`}
              >
                {activeGuide ? `${activeGuide.emoji} ${activeGuide.name}` : '✏️ 도안 따라 걷기'}
              </button>
              <button
                onClick={() => setPage('goal')}
                className="chip flex shrink-0 items-center gap-1.5 rounded-full border-mint/30 bg-mint/10 px-3 py-2 text-[12px] text-mint"
              >
                {activePace.emoji}{' '}
                {goalMode === 'time'
                  ? formatEstimatedMinutes(goalMinutes)
                  : formatDistance(goalDistanceM)}
              </button>
              <button
                onClick={() => {
                  setSim((s) => !s);
                  showToast(
                    sim
                      ? '시뮬레이션을 껐어요. 실제 GPS로 기록합니다.'
                      : '시뮬레이션을 켰어요. 지도를 눌러 그려 보세요.',
                  );
                }}
                className={`chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[12px] ${
                  sim ? 'border-sky/50 bg-sky/15 text-sky' : 'text-zinc-300'
                }`}
              >
                🛰 시뮬 {sim ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => {
                  setGuideId(null);
                  setGuideCenter(null);
                  setWalkableRoute(null);
                }}
                className="chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[12px] text-zinc-400"
              >
                ♻︎ 새로
              </button>
            </div>

            {idle && (
              <button
                onClick={beginWalk}
                className="mt-3 w-full rounded-2xl bg-lime py-4 text-[15px] font-extrabold text-[#0B1015] active:scale-[0.99]"
              >
                산책 시작
              </button>
            )}

            {rec && (
              <div className="mt-3 space-y-2">
                {sim && (
                  <button
                    onClick={startAutoWalk}
                    className="w-full rounded-xl border border-sky/40 bg-sky/10 py-2.5 text-[13px] font-semibold text-sky active:scale-[0.99]"
                  >
                    {autoWalking
                      ? '⏹ 자동 걷기 멈추기'
                      : walkableRoute?.isRealRoad
                        ? `${activeGuide?.emoji ?? '🧭'} 실제 도보 경로로 자동 걷기`
                        : activeGuide
                          ? `${activeGuide.emoji} 도안 자동 걷기`
                          : '▶ 자동 걷기 (데모 루트)'}
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={pauseWalk}
                    className="flex-1 rounded-2xl border border-white/12 bg-white/[0.06] py-4 text-[15px] font-bold text-zinc-100 active:scale-[0.99]"
                  >
                    ⏸ 일시정지
                  </button>
                  <button
                    onClick={finishWalk}
                    className="flex-1 rounded-2xl bg-lime py-4 text-[15px] font-extrabold text-[#0B1015] active:scale-[0.99]"
                  >
                    완료 · 카드 만들기
                  </button>
                </div>
              </div>
            )}

            {paused && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={resumeWalk}
                    className="flex-1 rounded-2xl bg-lime py-4 text-[15px] font-extrabold text-[#0B1015] active:scale-[0.99]"
                  >
                    ▶ 재개
                  </button>
                  <button
                    onClick={finishWalk}
                    className="flex-1 rounded-2xl border border-white/12 bg-white/[0.06] py-4 text-[15px] font-bold text-zinc-100 active:scale-[0.99]"
                  >
                    완료
                  </button>
                </div>
                <button onClick={cancelWalk} className="w-full py-1 text-[12px] text-zinc-500">
                  기록 취소
                </button>
              </div>
            )}

            {sim && idle && (
              <p className="mt-2 text-center text-[11px] leading-relaxed text-zinc-500">
                실내 테스트: 산책 시작 → 지도를 콕콕 눌러 선을 긋거나 [자동 걷기] → 완료를 누르면
                타임랩스·PNG까지 모두 확인할 수 있어요.
              </p>
            )}
          </>
        )}

        {page === 'goal' && (
          <div className="pb-1">
            <SheetHeader title="도보 시간 · 거리 · 속도" onBack={() => setPage('main')} />

            {/* 기준 선택: 시간 vs 거리 */}
            <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
              <button
                onClick={() => {
                  setGoalMode('time');
                  syncGuideSizeToGoal(calcDistanceFromMinutes(goalMinutes, paceId));
                }}
                className={`rounded-xl py-2 text-[12px] font-bold transition ${
                  goalMode === 'time' ? 'bg-lime text-[#0B1015]' : 'text-zinc-400'
                }`}
              >
                ⏱ 시간으로 정하기
              </button>
              <button
                onClick={() => {
                  setGoalMode('distance');
                  syncGuideSizeToGoal(goalDistanceM);
                }}
                className={`rounded-xl py-2 text-[12px] font-bold transition ${
                  goalMode === 'distance' ? 'bg-lime text-[#0B1015]' : 'text-zinc-400'
                }`}
              >
                📏 거리로 정하기
              </button>
            </div>

            {/* 프리셋 & 슬라이더 */}
            {goalMode === 'time' ? (
              <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {TIME_PRESETS_MIN.map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setGoalMinutes(m);
                        syncGuideSizeToGoal(calcDistanceFromMinutes(m, paceId));
                      }}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        goalMinutes === m
                          ? 'bg-lime/20 text-lime ring-1 ring-lime/50'
                          : 'bg-white/[0.05] text-zinc-300'
                      }`}
                    >
                      {formatEstimatedMinutes(m)}
                    </button>
                  ))}
                </div>
                <Slider
                  label="목표 시간"
                  value={goalMinutes}
                  min={5}
                  max={120}
                  step={5}
                  display={formatEstimatedMinutes(goalMinutes)}
                  onChange={(m) => {
                    setGoalMinutes(m);
                    syncGuideSizeToGoal(calcDistanceFromMinutes(m, paceId));
                  }}
                />
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {DIST_PRESETS_M.map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setGoalDistanceM(d);
                        syncGuideSizeToGoal(d);
                      }}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        goalDistanceM === d
                          ? 'bg-lime/20 text-lime ring-1 ring-lime/50'
                          : 'bg-white/[0.05] text-zinc-300'
                      }`}
                    >
                      {formatDistance(d)}
                    </button>
                  ))}
                </div>
                <Slider
                  label="목표 거리"
                  value={goalDistanceM}
                  min={200}
                  max={10000}
                  step={100}
                  display={formatDistance(goalDistanceM)}
                  onChange={(d) => {
                    setGoalDistanceM(d);
                    syncGuideSizeToGoal(d);
                  }}
                />
              </div>
            )}

            {/* 3단계 속도 선택 (각 단계별 계산 결과 실시간 표시) */}
            <div className="mt-3 text-[11px] font-semibold text-zinc-400">
              속도 3단계 선택 ({goalMode === 'time' ? '예상 거리 자동 계산' : '예상 시간 자동 계산'})
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {PACE_PRESETS.map((p) => {
                const selected = paceId === p.id;
                const calcDist = calcDistanceFromMinutes(goalMinutes, p.id);
                const calcMin = calcMinutesFromDistance(goalDistanceM, p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPaceId(p.id);
                      if (goalMode === 'time') {
                        syncGuideSizeToGoal(calcDistanceFromMinutes(goalMinutes, p.id));
                      }
                    }}
                    className={`flex flex-col items-start rounded-2xl border p-2.5 text-left transition active:scale-[0.98] ${
                      selected
                        ? 'border-lime/60 bg-lime/12 text-white'
                        : 'border-white/10 bg-white/[0.03] text-zinc-300'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-base leading-none">{p.emoji}</span>
                      <span className="text-[10px] text-zinc-400">{p.kmh} km/h</span>
                    </div>
                    <div className="mt-1.5 text-[12px] font-bold">{p.label}</div>
                    <div className={`mt-0.5 text-[12px] font-extrabold tabular-nums ${selected ? 'text-lime' : 'text-mint'}`}>
                      {goalMode === 'time' ? formatDistance(calcDist) : formatEstimatedMinutes(calcMin)}
                    </div>
                  </button>
                );
              })}
            </div>

            {activeGuide && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                <div>
                  <div className="text-[12px] font-semibold text-zinc-200">
                    도안 크기 자동 맞추기 ({activeGuide.emoji} {activeGuide.name})
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    목표 {formatDistance(targetDistanceM)}에 맞춰 크기 {guideSize} m 적용
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = !autoSizeToGoal;
                    setAutoSizeToGoal(next);
                    if (next) {
                      setGuideSize(
                        guideSizeForDistance(
                          activeGuide,
                          targetDistanceM,
                          walkableNavEnabled ? 1.2 : 1.0,
                        ),
                      );
                    }
                  }}
                  className={`relative h-6 w-11 rounded-full transition ${
                    autoSizeToGoal ? 'bg-lime' : 'bg-white/15'
                  }`}
                  aria-label="도안 크기 자동 맞추기"
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#0B1015] transition-all ${
                      autoSizeToGoal ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            )}

            <button
              onClick={() => setPage('main')}
              className="mt-3 w-full rounded-2xl bg-lime py-3 text-[13px] font-extrabold text-[#0B1015] active:scale-[0.99]"
            >
              적용 ({activePace.emoji} {formatDistance(targetDistanceM)} ·{' '}
              {formatEstimatedMinutes(estimatedGoalMinutes)})
            </button>
          </div>
        )}

        {page === 'guide' && (
          <div className="pb-1">
            <SheetHeader title="도안 따라 걷기" onBack={() => setPage('main')} />
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              지도 위 도안을 <strong className="text-zinc-300">드래그해서 이동</strong>하고{' '}
              <strong className="text-sky">↻ 핸들로 회전</strong>할 수 있어요. 실제 보행자 도로에
              맞춰 네비게이션이 안내합니다.
            </p>
            <div className="mt-2.5 grid grid-cols-4 gap-2">
              {GUIDES.map((g) => (
                <button
                  key={g.id}
                  onClick={() => selectGuide(g.id)}
                  className={`flex flex-col items-center gap-1 rounded-2xl border py-2 text-[11px] active:scale-95 ${
                    guideId === g.id
                      ? 'border-lime/60 bg-lime/12 text-lime'
                      : 'border-white/10 bg-white/[0.03] text-zinc-300'
                  }`}
                >
                  <span className="text-lg leading-none">{g.emoji}</span>
                  {g.name}
                </button>
              ))}
            </div>

            {guideId && (
              <div className="mt-3 space-y-2.5 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[12px] font-semibold text-zinc-200">
                      실제 도보 길 네비게이션
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      건물·벽을 피해 걸을 수 있는 인도/산책로로 경로 생성
                    </div>
                  </div>
                  <button
                    onClick={() => setWalkableNavEnabled((v) => !v)}
                    className={`relative h-6 w-11 rounded-full transition ${
                      walkableNavEnabled ? 'bg-sky' : 'bg-white/15'
                    }`}
                    aria-label="실제 도보 길 네비게이션"
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                        walkableNavEnabled ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>

                <Slider
                  label={`도안 크기 (예상 ${formatDistance(
                    walkableRoute?.totalDistanceM || estimatedGuideDistanceM,
                  )})`}
                  value={guideSize}
                  min={40}
                  max={2500}
                  step={10}
                  display={`${guideSize} m`}
                  onChange={setGuideSize}
                />
                <Slider
                  label="회전"
                  value={guideRot}
                  min={0}
                  max={359}
                  step={1}
                  display={`${guideRot}°`}
                  onChange={setGuideRot}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (myLoc) {
                        setGuideCenter(myLoc);
                        mapRef.current?.flyTo(myLoc, 17);
                      } else {
                        showToast('내 위치를 아직 찾지 못했어요.');
                      }
                    }}
                    className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2 text-[12px] font-semibold text-zinc-200 active:scale-95"
                  >
                    📍 내 위치에 맞추기
                  </button>
                  <button
                    onClick={() => {
                      if (activeGuide) {
                        setGuideSize(
                          guideSizeForDistance(
                            activeGuide,
                            targetDistanceM,
                            walkableNavEnabled ? 1.2 : 1.0,
                          ),
                        );
                        showToast(`목표(${formatDistance(targetDistanceM)})에 크기를 맞췄어요.`);
                      }
                    }}
                    className="flex-1 rounded-xl border border-mint/25 bg-mint/10 py-2 text-[12px] font-semibold text-mint active:scale-95"
                  >
                    🎯 목표 거리 맞추기
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setGuideId(null);
                  setGuideCenter(null);
                  setWalkableRoute(null);
                  setPage('main');
                }}
                className="flex-1 rounded-2xl border border-white/12 bg-white/[0.04] py-3 text-[13px] font-semibold text-zinc-300 active:scale-[0.99]"
              >
                도안 없이
              </button>
              <button
                onClick={() => setPage('main')}
                className="flex-1 rounded-2xl bg-lime py-3 text-[13px] font-extrabold text-[#0B1015] active:scale-[0.99]"
              >
                확인
              </button>
            </div>
          </div>
        )}

        {page === 'style' && (
          <div className="pb-1">
            <SheetHeader title="펜 스타일" onBack={() => setPage('main')} />
            <div className="mt-3 text-[11px] font-semibold tracking-wide text-zinc-500">색상</div>
            <div className="mt-2 flex gap-2.5">
              {COLORS.map((c) => (
                <button
                  key={c.v}
                  onClick={() => setColor(c.v)}
                  style={{ background: c.v }}
                  className={`h-9 w-9 rounded-full transition ${
                    color === c.v ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0B1017]' : 'opacity-80'
                  }`}
                  aria-label={c.label}
                />
              ))}
            </div>

            <div className="mt-4 text-[11px] font-semibold tracking-wide text-zinc-500">굵기</div>
            <div className="mt-2 flex items-center gap-2">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  className={`flex h-11 flex-1 items-center justify-center rounded-xl border ${
                    width === w ? 'border-lime/60 bg-lime/10' : 'border-white/10 bg-white/[0.03]'
                  }`}
                  aria-label={`굵기 ${w}`}
                >
                  <span
                    className="rounded-full"
                    style={{
                      background: color,
                      height: Math.max(3, w * 0.7),
                      width: Math.max(14, w * 1.6),
                    }}
                  />
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div>
                <div className="text-[13px] font-semibold text-zinc-200">지도 스타일</div>
                <div className="text-[11px] text-zinc-500">
                  {tile === 'dark' ? '다크 (경로가 잘 보여요)' : '밝은 지도'}
                </div>
              </div>
              <button
                onClick={() => setTile(tile === 'dark' ? 'voyager' : 'dark')}
                className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-zinc-200"
              >
                {tile === 'dark' ? '밝게' : '어둡게'}
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div>
                <div className="text-[13px] font-semibold text-zinc-200">시뮬레이션 모드</div>
                <div className="text-[11px] text-zinc-500">집 안에서 지도 탭으로 테스트</div>
              </div>
              <button
                onClick={() => setSim((s) => !s)}
                className={`relative h-7 w-12 rounded-full transition ${
                  sim ? 'bg-sky' : 'bg-white/15'
                }`}
                aria-label="시뮬레이션 전환"
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${
                    sim ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            <button
              onClick={() => setPage('main')}
              className="mt-3 w-full rounded-2xl bg-white/[0.06] py-3 text-[13px] font-semibold text-zinc-200 active:scale-[0.99]"
            >
              확인
            </button>
          </div>
        )}
      </div>

      {view === 'card' && walk && (
        <CardView
          walk={walk}
          isFresh={justFinished}
          onClose={() => {
            setView('map');
            setWalk(null);
            setJustFinished(false);
          }}
          onTitleChange={handleTitle}
          onToast={showToast}
        />
      )}

      {view === 'gallery' && (
        <Gallery
          walks={walks}
          onOpen={(w) => {
            setWalk(w);
            setJustFinished(false);
            setView('card');
          }}
          onDelete={async (id) => {
            await deleteWalk(id);
            await refreshWalks();
            showToast('삭제했어요.');
          }}
          onClose={() => setView('map')}
        />
      )}
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="flex-1">
      <div className="text-[10px] font-semibold tracking-[0.14em] text-zinc-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-[22px] font-extrabold leading-none tabular-nums text-white">
          {value}
        </span>
        {suffix && <span className="text-[11px] text-zinc-500">{suffix}</span>}
      </div>
    </div>
  );
}

function SheetHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <button
        onClick={onBack}
        className="flex h-8 items-center gap-1 rounded-full border border-white/10 px-3 text-[12px] text-zinc-300 active:scale-95"
      >
        ‹ 뒤로
      </button>
      <div className="text-[13px] font-bold text-zinc-100">{title}</div>
      <div className="w-16" />
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-300">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
