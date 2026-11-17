import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CardView from './components/CardView';
import MapView, { type CandidatePreview, type MapHandle } from './components/MapView';
import PartnersView from './components/PartnersView';
import RecordsView from './components/RecordsView';
import SketchPad from './components/SketchPad';
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatPace,
  haversine,
  interpolateLatLng,
  pathDistance,
  type LatLng,
  type PathPoint,
  type Walk,
  type WalkFeedback,
  type XY,
} from './lib/geo';
import {
  GUIDES,
  guideById,
  xyGroupsPerimeterRatio,
  xyGroupsSampleWaypoints,
  xyGroupsSizeForDistance,
  xyGroupsToLatLngs,
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
  GRADE_LABELS,
  partnerById,
  partnerSvgDataUrl,
  pickRewardPartner,
  type PartnerDef,
} from './lib/partners';
import {
  computeNavProgress,
  fetchWalkableRoute,
  generateAiCandidates,
  generateSketchCandidates,
  fetchRouteForDistance,
  roundGuideSize,
  hydrateSavedRoute,
  searchPlaces,
  turnIcon,
  type PlaceResult,
  type RouteCandidate,
  type WalkableRoute,
} from './lib/routing';
import { makeLoop, walkAlongPath, type WalkController } from './lib/simulate';
import {
  clearDraft,
  deleteSavedRoute,
  deleteWalk,
  listSavedRoutes,
  listWalks,
  loadDraft,
  loadPartnerState,
  newId,
  saveDraft,
  saveFavoriteRoute,
  savePartnerState,
  saveWalk,
  type Draft,
  type PartnerState,
  type SavedRoute,
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

const FEEDBACK_TAGS = [
  '🌳 가로수 그늘',
  '🚶 보행로 쾌적',
  '💡 야간 밝음',
  '🚦 횡단보도 많음',
  '⛰️ 오르막 있음',
];

type Mode = 'idle' | 'recording' | 'paused';
type AppTab = 'walk' | 'records' | 'partners';
type CourseTab = 'sketch' | 'ai' | 'pin' | 'free';
type Page = 'main' | 'guide' | 'goal' | 'style';
type View = 'map' | 'card';
type SheetSnap = 'peek' | 'half' | 'full';

type FinishDraft = {
  walk: Walk;
  reward: PartnerDef;
  isNewReward: boolean;
};

function defaultTitle(label?: string | null) {
  const h = new Date().getHours();
  const slot =
    h < 5 ? '새벽' : h < 11 ? '아침' : h < 14 ? '점심' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤';
  return label ? `${slot} ${label} 산책` : `${slot} 산책`;
}

export default function App() {
  const mapRef = useRef<MapHandle | null>(null);

  const [appTab, setAppTab] = useState<AppTab>('walk');
  const [courseTab, setCourseTab] = useState<CourseTab>('sketch');
  const [mode, setMode] = useState<Mode>('idle');
  const [points, setPoints] = useState<PathPoint[]>([]);
  const [color, setColor] = useState(COLORS[0].v);
  const [width, setWidth] = useState(5);
  const [sim, setSim] = useState(false);

  // 그림/도안 상태 (프리셋 guideId 또는 사용자 손그림 customStrokes)
  const [guideId, setGuideId] = useState<string | null>(null);
  const [customStrokes, setCustomStrokes] = useState<XY[][] | null>(null);
  const [customTitle, setCustomTitle] = useState('자유 스케치');
  const [guideSize, setGuideSize] = useState(240);
  const [guideRot, setGuideRot] = useState(0);
  const [guideCenter, setGuideCenter] = useState<LatLng | null>(null);
  const [showSketchPad, setShowSketchPad] = useState(false);
  const [mapDrawMode, setMapDrawMode] = useState(false);

  // AI 추천 상태
  const [aiQuery, setAiQuery] = useState('');
  const [aiResults, setAiResults] = useState<PlaceResult[]>([]);
  const [aiSearching, setAiSearching] = useState(false);
  const [aiWaypoint, setAiWaypoint] = useState<PlaceResult | null>(null);
  const [aiRoundTrip, setAiRoundTrip] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFormOpen, setAiFormOpen] = useState(true);

  // 점 찍기 코스 상태
  const [pinPoints, setPinPoints] = useState<LatLng[]>([]);

  // 3코스 후보 비교 상태 (그림/AI 공용)
  const [candidates, setCandidates] = useState<RouteCandidate[]>([]);
  const [selectedCandId, setSelectedCandId] = useState<string | null>(null);
  const [candBusy, setCandBusy] = useState(false);

  // 도보 목표(시간/거리) + 3단계 속도
  const [goalMode, setGoalMode] = useState<GoalMode>('time');
  const [goalMinutes, setGoalMinutes] = useState(20);
  const [goalDistanceM, setGoalDistanceM] = useState(1500);
  const [paceId, setPaceId] = useState<PaceId>('walk');
  const [autoSizeToGoal, setAutoSizeToGoal] = useState(true);

  // 실제 도보 네비게이션
  const [walkableNavEnabled, setWalkableNavEnabled] = useState(true);
  const [walkableRoute, setWalkableRoute] = useState<WalkableRoute | null>(null);
  const [routeLocked, setRouteLocked] = useState(false);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routeRefreshSeq, setRouteRefreshSeq] = useState(0);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [screenLocked, setScreenLocked] = useState(false);

  // 하단 시트 접기/중간/펼침 + 드래그 제스처
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');
  const [sheetDragY, setSheetDragY] = useState(0);
  const [sheetDragging, setSheetDragging] = useState(false);
  const sheetDragRef = useRef<{ pointerId: number; startY: number } | null>(null);

  // 지도 · 데이터 상태
  const [mapCenter, setMapCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [myLoc, setMyLoc] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [tile, setTile] = useState<'dark' | 'voyager'>('dark');
  const [page, setPage] = useState<Page>('main');
  const [view, setView] = useState<View>('map');
  const [walk, setWalk] = useState<Walk | null>(null);
  const [walks, setWalks] = useState<Walk[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [partnerState, setPartnerState] = useState<PartnerState>(() => loadPartnerState());
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [autoWalking, setAutoWalking] = useState(false);
  const [justFinished, setJustFinished] = useState(false);

  // 완료 후 피드백 & 파트너 획득 모달
  const [finishDraft, setFinishDraft] = useState<FinishDraft | null>(null);
  const [fbRating, setFbRating] = useState<WalkFeedback['rating']>('great');
  const [fbTags, setFbTags] = useState<string[]>([]);

  const startRef = useRef(0);
  const elapsedRef = useRef(0);
  /** 산책을 처음 시작한 시각 (일시정지·재개와 무관) */
  const walkStartedAtRef = useRef(0);
  const autoRef = useRef<WalkController | null>(null);
  const toastTimer = useRef(0);
  const titleTimer = useRef(0);
  const transformingRef = useRef(false);
  const navPrevDistRef = useRef(0);
  /** 길이 보정으로 바꾼 도안 크기: 이 크기로 인한 경로 재탐색은 건너뛴다 */
  const calibratedSizeRef = useRef<number | null>(null);
  const lastSpokenStepRef = useRef<number | null>(null);
  const lastKmSpokenRef = useRef(0);

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
    setSavedRoutes(listSavedRoutes());
  }, []);

  useEffect(() => {
    refreshWalks();
    setDraft(loadDraft());
    return () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(titleTimer.current);
    };
  }, [refreshWalks]);

  /* ---------------- 파트너 상태 ---------------- */

  const activePartner = useMemo(() => partnerById(partnerState.activeId), [partnerState.activeId]);
  const activePartnerUrl = useMemo(
    () => (activePartner ? partnerSvgDataUrl(activePartner, false) : null),
    [activePartner],
  );

  const claimStarterPartner = useCallback(() => {
    setPartnerState((prev) => {
      if (prev.starterClaimed) return prev;
      const next: PartnerState = {
        activeId: prev.activeId ?? 'corgi',
        counts: { ...prev.counts, corgi: (prev.counts.corgi ?? 0) + 1 },
        starterClaimed: true,
      };
      savePartnerState(next);
      return next;
    });
    showToast('🎁 첫 파트너 [산책코기]가 합류했어요! 지도 위에서 함께 걸어요.');
  }, [showToast]);

  const selectActivePartner = useCallback(
    (id: string) => {
      setPartnerState((prev) => {
        const next: PartnerState = { ...prev, activeId: id };
        savePartnerState(next);
        return next;
      });
      const p = partnerById(id);
      if (p) showToast(`${p.name}와(과) 함께 산책해요!`);
    },
    [showToast],
  );

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
        setSim(true);
        showToast('위치를 쓸 수 없어 시뮬레이션 모드로 시작했어요. 지도를 눌러 그려 보세요.');
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 },
    );
  }, [showToast]);

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

  // 임시 저장에 함께 넣을 계획 코스 (interval을 다시 만들지 않도록 ref로 최신값 유지)
  const courseRef = useRef<NonNullable<Draft['course']> | null>(null);
  courseRef.current = {
    courseTab,
    customStrokes,
    customTitle,
    guideSize,
    guideRot,
    guideCenter,
    pinPoints,
    walkableRoute,
    routeLocked,
  };

  useEffect(() => {
    if (mode === 'idle') return;
    const id = window.setInterval(() => {
      if (pointsRef.current.length >= 2) {
        saveDraft({
          points: pointsRef.current,
          color,
          width,
          guideId,
          startedAt: walkStartedAtRef.current || Date.now(),
          elapsedMs: elapsedRef.current + (startRef.current ? Date.now() - startRef.current : 0),
          course: courseRef.current ?? undefined,
        });
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [mode, color, width, guideId]);

  /* ---------------- 도안 / 자유 스케치 + 실제 도보 경로 탐색 ---------------- */

  const activeGuide = useMemo(() => guideById(guideId), [guideId]);
  const effectiveSubpaths = useMemo(
    () => customStrokes ?? activeGuide?.subpaths ?? null,
    [customStrokes, activeGuide],
  );
  const effectiveShapeName = useMemo(
    () => (customStrokes ? customTitle : (activeGuide?.name ?? null)),
    [customStrokes, customTitle, activeGuide],
  );
  const hasShape = Boolean(effectiveSubpaths && effectiveSubpaths.length > 0);
  const effectiveGuideCenter = useMemo(
    () => (hasShape ? (guideCenter ?? myLoc ?? mapCenter) : null),
    [hasShape, guideCenter, myLoc, mapCenter],
  );

  const guide = useMemo(() => {
    if (!effectiveSubpaths || !effectiveGuideCenter) return null;
    return xyGroupsToLatLngs(effectiveSubpaths, effectiveGuideCenter, guideSize, guideRot);
  }, [effectiveSubpaths, effectiveGuideCenter, guideSize, guideRot]);

  const estimatedGuideDistanceM = useMemo(() => {
    if (!effectiveSubpaths) return 0;
    const detour = walkableNavEnabled ? 1.2 : 1.0;
    return Math.round(xyGroupsPerimeterRatio(effectiveSubpaths) * guideSize * detour);
  }, [effectiveSubpaths, guideSize, walkableNavEnabled]);

  // 도안(프리셋/손그림) 기본 자동 경로 탐색 (후보 선택이나 점찍기/저장코스 고정이 아닐 때만)
  useEffect(() => {
    if (courseTab !== 'sketch' || routeLocked) return;
    if (!effectiveSubpaths || !effectiveGuideCenter || !walkableNavEnabled) {
      if (!routeLocked) setWalkableRoute(null);
      setRoutingBusy(false);
      navPrevDistRef.current = 0;
      return;
    }
    if (transformingRef.current) return;
    if (calibratedSizeRef.current === guideSize) {
      // 바로 앞 탐색이 목표 거리에 맞춰 크기를 고친 것: 경로는 이미 그 크기로 받아 둠
      calibratedSizeRef.current = null;
      return;
    }
    calibratedSizeRef.current = null;

    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setRoutingBusy(true);
      try {
        const groupsFor = (sz: number) =>
          xyGroupsSampleWaypoints(effectiveSubpaths, effectiveGuideCenter, sz, guideRot, 12);
        let route: WalkableRoute;
        let nextSize = guideSize;
        if (autoSizeToGoal) {
          // 실제 보행로 길이가 목표 거리(±10%)에 오도록 도안 크기를 보정
          const r = await fetchRouteForDistance(
            (s) => groupsFor(roundGuideSize(guideSize * s)),
            targetDistanceM,
            myLocRef.current,
            ctrl.signal,
          );
          route = r.route;
          nextSize = roundGuideSize(guideSize * r.scale);
        } else {
          route = await fetchWalkableRoute(groupsFor(guideSize), myLocRef.current, ctrl.signal);
        }
        if (!ctrl.signal.aborted) {
          setWalkableRoute(route);
          navPrevDistRef.current = 0;
          lastSpokenStepRef.current = null;
          if (nextSize !== guideSize) {
            calibratedSizeRef.current = nextSize;
            setGuideSize(nextSize);
          }
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
  }, [
    courseTab,
    routeLocked,
    effectiveSubpaths,
    effectiveGuideCenter,
    guideSize,
    guideRot,
    walkableNavEnabled,
    routeRefreshSeq,
    autoSizeToGoal,
    targetDistanceM,
  ]);

  // 점 찍기 모드 자동 연결
  useEffect(() => {
    if (courseTab !== 'pin') return;
    if (pinPoints.length < 2) {
      setWalkableRoute(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setRoutingBusy(true);
      try {
        const route = await fetchWalkableRoute([pinPoints], myLocRef.current, ctrl.signal);
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
    }, 180);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [courseTab, pinPoints, routeRefreshSeq]);

  const navProgress = useMemo(() => {
    if (!walkableRoute) return null;
    return computeNavProgress(walkableRoute, myLoc, navPrevDistRef.current);
  }, [walkableRoute, myLoc]);

  useEffect(() => {
    if (navProgress && !navProgress.offRoute) {
      navPrevDistRef.current = navProgress.traveledM;
    }
  }, [navProgress]);

  const speakText = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch {
      /* 미지원 환경 무시 */
    }
  }, []);

  // TTS 턴바이턴 + 1km 마일스톤 안내
  useEffect(() => {
    if (!ttsEnabled || mode !== 'recording') return;
    const kmFloor = Math.floor(distance / 1000);
    if (kmFloor >= 1 && kmFloor > lastKmSpokenRef.current) {
      lastKmSpokenRef.current = kmFloor;
      speakText(`${kmFloor}킬로미터를 돌파했어요. 좋은 페이스예요!`);
      return;
    }
    if (!navProgress?.currentStep) return;
    const step = navProgress.currentStep;
    if (lastSpokenStepRef.current === step.id) return;
    lastSpokenStepRef.current = step.id;
    const text =
      step.turnType === 'arrive'
        ? '목표 코스를 완주했습니다.'
        : `${step.instruction}${step.distanceM >= 20 ? `, ${Math.round(step.distanceM)}미터 직진` : ''}`;
    speakText(text);
  }, [ttsEnabled, mode, distance, navProgress, speakText]);

  const selectGuide = useCallback(
    (id: string) => {
      const g = guideById(id);
      if (!g) return;
      const baseCenter = guideCenter ?? myLoc ?? mapCenter;
      setCustomStrokes(null);
      setGuideCenter(baseCenter);
      setGuideId(g.id);
      setGuideRot(0);
      setCandidates([]);
      setSelectedCandId(null);
      setRouteLocked(false);
      setMapDrawMode(false);
      if (autoSizeToGoal) {
        const nextSize = xyGroupsSizeForDistance(
          g.subpaths,
          targetDistanceM,
          walkableNavEnabled ? 1.2 : 1.0,
        );
        setGuideSize(nextSize);
      }
      showToast(`${g.name} 도안을 띄웠어요. 지도에서 드래그해 옮길 수 있어요.`);
    },
    [guideCenter, myLoc, mapCenter, autoSizeToGoal, targetDistanceM, walkableNavEnabled, showToast],
  );

  const applyCustomStrokes = useCallback(
    (normStrokes: XY[][], center: LatLng | null, rawSizeM: number | null, label: string) => {
      const c = center ?? guideCenter ?? myLoc ?? mapCenter;
      const sz =
        rawSizeM ??
        (autoSizeToGoal
          ? xyGroupsSizeForDistance(normStrokes, targetDistanceM, walkableNavEnabled ? 1.2 : 1.0)
          : guideSize);
      setGuideId(null);
      setCustomStrokes(normStrokes);
      setCustomTitle(label);
      setGuideCenter(c);
      setGuideRot(0);
      setGuideSize(sz);
      setCandidates([]);
      setSelectedCandId(null);
      setRouteLocked(false);
      setCourseTab('sketch');
      setSheetSnap('half');
      showToast(`${label} 도안을 지도에 올렸어요. [코스 3개 찾기]로 길에 맞춰보세요!`);
    },
    [
      guideCenter,
      myLoc,
      mapCenter,
      autoSizeToGoal,
      targetDistanceM,
      walkableNavEnabled,
      guideSize,
      showToast,
    ],
  );

  const syncGuideSizeToGoal = useCallback(
    (distM: number) => {
      if (!effectiveSubpaths || !autoSizeToGoal) return;
      setGuideSize(
        xyGroupsSizeForDistance(effectiveSubpaths, distM, walkableNavEnabled ? 1.2 : 1.0),
      );
      setRouteLocked(false);
      setCandidates([]);
      setSelectedCandId(null);
    },
    [effectiveSubpaths, autoSizeToGoal, walkableNavEnabled],
  );

  const fitRouteInView = useCallback(
    (path: LatLng[], snap: SheetSnap = sheetSnap) => {
      if (path.length < 2) return;
      const topPad = mode === 'idle' ? 108 : 136;
      const bottomPad = snap === 'peek' ? 190 : snap === 'full' ? 460 : 370;
      mapRef.current?.fit(path, { top: topPad, bottom: bottomPad });
    },
    [mode, sheetSnap],
  );

  /* ---------------- 3코스 후보 생성 (그림 / AI) ---------------- */

  const handleFindSketchCandidates = useCallback(async () => {
    if (!effectiveSubpaths || !effectiveGuideCenter) {
      showToast('먼저 밑그림을 그리거나 도안을 선택해 주세요.');
      return;
    }
    setCandBusy(true);
    try {
      const list = await generateSketchCandidates(
        effectiveSubpaths,
        effectiveGuideCenter,
        guideSize,
        guideRot,
        myLocRef.current,
        undefined,
        autoSizeToGoal ? targetDistanceM : undefined,
      );
      setCandidates(list);
      if (list[0]) {
        if (list[0].sizeM) setGuideSize(list[0].sizeM);
        setSelectedCandId(list[0].id);
        setWalkableRoute(list[0].route);
        setRouteLocked(true);
        navPrevDistRef.current = 0;
        lastSpokenStepRef.current = null;
        setSheetSnap('half');
        fitRouteInView(list[0].route.path, 'half');
      }
      showToast('그림과 닮은 실제 보행 코스 3개를 찾았어요!');
    } catch {
      showToast('코스 생성에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setCandBusy(false);
    }
  }, [
    effectiveSubpaths,
    effectiveGuideCenter,
    guideSize,
    guideRot,
    autoSizeToGoal,
    targetDistanceM,
    fitRouteInView,
    showToast,
  ]);

  const handleSearchPlaces = useCallback(async () => {
    const q = aiQuery.trim();
    if (!q) return;
    setAiSearching(true);
    try {
      const res = await searchPlaces(q, myLocRef.current ?? mapCenter);
      setAiResults(res);
      if (res.length === 0) showToast('검색 결과가 없어요. 다른 이름으로 검색해 보세요.');
    } catch {
      showToast('장소 검색에 실패했어요.');
    } finally {
      setAiSearching(false);
    }
  }, [aiQuery, mapCenter, showToast]);

  const handleGenerateAiCourses = useCallback(async () => {
    const origin = myLocRef.current ?? mapCenter;
    setAiBusy(true);
    try {
      const list = await generateAiCandidates({
        origin,
        waypoint: aiWaypoint?.location ?? null,
        roundTrip: aiRoundTrip,
        targetDistM: targetDistanceM,
      });
      setCandidates(list);
      if (list[0]) {
        setSelectedCandId(list[0].id);
        setWalkableRoute(list[0].route);
        setRouteLocked(true);
        navPrevDistRef.current = 0;
        lastSpokenStepRef.current = null;
        setAiFormOpen(false);
        setSheetSnap('half');
        fitRouteInView(list[0].route.path, 'half');
      }
      showToast('AI가 3가지 추천 산책 코스를 만들었어요!');
    } catch {
      showToast('AI 코스 생성에 실패했어요.');
    } finally {
      setAiBusy(false);
    }
  }, [mapCenter, aiWaypoint, aiRoundTrip, targetDistanceM, fitRouteInView, showToast]);

  const selectCandidate = useCallback(
    (c: RouteCandidate) => {
      setSelectedCandId(c.id);
      setWalkableRoute(c.route);
      setRouteLocked(true);
      // 그림 후보: 지도 위 도안도 이 후보의 크기·회전으로 맞춘다
      if (c.sizeM) setGuideSize(c.sizeM);
      if (c.rotDeg !== undefined) setGuideRot(c.rotDeg);
      navPrevDistRef.current = 0;
      lastSpokenStepRef.current = null;
      fitRouteInView(c.route.path);
    },
    [fitRouteInView],
  );

  const bookmarkCurrentRoute = useCallback(
    (route: WalkableRoute, title: string, kind: SavedRoute['kind'], similarity?: number) => {
      const saved: SavedRoute = {
        id: newId(),
        title,
        createdAt: Date.now(),
        path: route.path,
        totalDistanceM: route.totalDistanceM,
        similarity,
        kind,
        isRealRoad: route.isRealRoad,
      };
      const list = saveFavoriteRoute(saved);
      setSavedRoutes(list);
      showToast(`🔖 [${title}] 코스를 찜했어요! [나의 기록 > 찜한 코스]에서 언제든 다시 걸을 수 있어요.`);
    },
    [showToast],
  );

  /* ---------------- 산책 동작 ---------------- */

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

    const center = effectiveGuideCenter ?? myLoc ?? mapRef.current?.center() ?? DEFAULT_CENTER;

    let path: LatLng[];
    if (walkableRoute && walkableRoute.path.length >= 2) {
      // 일시정지·재개 후에는 지금까지 걸은 지점부터 이어서 걷는다 (처음으로 되돌아가지 않음)
      const traveled = navPrevDistRef.current;
      const last = pointsRef.current[pointsRef.current.length - 1];
      const nextIdx = walkableRoute.cumDist.findIndex((d) => d > traveled);
      if (traveled > 0 && last && nextIdx > 0) {
        path = [{ lat: last.lat, lng: last.lng }, ...walkableRoute.path.slice(nextIdx)];
      } else {
        path = walkableRoute.path.slice();
        navPrevDistRef.current = 0;
      }
    } else if (effectiveSubpaths) {
      path = xyGroupsToLatLngs(effectiveSubpaths, center, guideSize, guideRot).flat();
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
        showToast('도보 코스를 다 걸었어요! 완료를 눌러 기록과 파트너를 확인해 보세요.');
      },
    });
    setAutoWalking(true);
    showToast(
      walkableRoute?.isRealRoad
        ? `${effectiveShapeName ?? '추천'} 실제 도보 길대로 걷는 중… (${activePace.label})`
        : effectiveShapeName
          ? `${effectiveShapeName} 도안을 따라 걷는 중… (${activePace.label})`
          : '자유 데모 루트를 걷는 중…',
    );
  }, [
    autoWalking,
    mode,
    sim,
    effectiveGuideCenter,
    myLoc,
    walkableRoute,
    effectiveSubpaths,
    guideSize,
    guideRot,
    activePace,
    effectiveShapeName,
    showToast,
  ]);

  const openSheetPage = useCallback((next: Page) => {
    setPage(next);
    setSheetSnap(next === 'main' ? 'half' : 'full');
  }, []);

  const toggleSheetPeek = useCallback(() => {
    if (page !== 'main') {
      setPage('main');
      setSheetSnap('half');
      return;
    }
    setSheetSnap((prev) => (prev === 'peek' ? 'half' : 'peek'));
  }, [page]);

  const effectiveSnap: SheetSnap = page !== 'main' ? 'full' : sheetSnap;

  const onSheetHandleDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    sheetDragRef.current = { pointerId: e.pointerId, startY: e.clientY };
    setSheetDragging(true);
    setSheetDragY(0);
  }, []);

  const onSheetHandleMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = sheetDragRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      const dy = e.clientY - st.startY;
      const resist =
        (effectiveSnap === 'peek' && dy > 0) || (effectiveSnap === 'full' && dy < 0) ? 0.24 : 1;
      setSheetDragY(Math.max(-220, Math.min(220, dy * resist)));
    },
    [effectiveSnap],
  );

  const onSheetHandleUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = sheetDragRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      sheetDragRef.current = null;
      const dy = e.clientY - st.startY;
      setSheetDragging(false);
      setSheetDragY(0);

      if (Math.abs(dy) < 8) {
        toggleSheetPeek();
        return;
      }
      if (page !== 'main') {
        if (dy > 64) {
          setPage('main');
          setSheetSnap('half');
        }
        return;
      }
      if (dy > 44) {
        setSheetSnap((prev) => (prev === 'full' ? 'half' : 'peek'));
      } else if (dy < -44) {
        setSheetSnap((prev) => (prev === 'peek' ? 'half' : 'full'));
      }
    },
    [page, toggleSheetPeek],
  );

  const beginWalk = useCallback(() => {
    setPoints([]);
    setNow(Date.now());
    elapsedRef.current = 0;
    startRef.current = Date.now();
    walkStartedAtRef.current = startRef.current;
    navPrevDistRef.current = 0;
    lastSpokenStepRef.current = null;
    lastKmSpokenRef.current = 0;
    setMapDrawMode(false);
    setScreenLocked(false);
    setMode('recording');
    setPage('main');
    setSheetSnap('half');
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
    setScreenLocked(false);
    setMode('paused');
    setNow(Date.now());
  }, []);

  const resumeWalk = useCallback(() => {
    startRef.current = Date.now();
    setMode('recording');
    setNow(Date.now());
    showToast(sim ? '이어서 그려 볼까요.' : '이어서 기록합니다.');
  }, [sim, showToast]);

  const finishWalk = useCallback(() => {
    autoRef.current?.stop();
    setAutoWalking(false);
    setScreenLocked(false);
    const total =
      mode === 'recording' ? elapsedRef.current + (Date.now() - startRef.current) : elapsedRef.current;
    const pts = pointsRef.current;
    const dist = pathDistance(pts);
    if (pts.length < 2 || dist < 3) {
      showToast('아직 그린 선이 거의 없어요. 조금 더 걸어 보세요.');
      return;
    }

    const courseKind: Walk['courseKind'] =
      courseTab === 'free'
        ? 'free'
        : courseTab === 'ai'
          ? 'ai'
          : courseTab === 'pin'
            ? 'pin'
            : guideId
              ? 'guide'
              : 'sketch';

    const w: Walk = {
      id: newId(),
      title: defaultTitle(effectiveShapeName ?? (courseTab === 'ai' ? 'AI 코스' : null)),
      createdAt: Date.now(),
      points: pts,
      color,
      width,
      guideId,
      distanceM: dist,
      durationMs: Math.max(total, 1000),
      paceId,
      courseKind,
    };

    const prevTotalDist = walks.reduce((acc, item) => acc + item.distanceM, 0);
    const reward = pickRewardPartner(dist, prevTotalDist + dist, partnerState.counts);
    const isNewReward = (partnerState.counts[reward.id] ?? 0) === 0;

    setFbRating('great');
    setFbTags([]);
    setFinishDraft({ walk: w, reward, isNewReward });
  }, [
    mode,
    courseTab,
    guideId,
    effectiveShapeName,
    color,
    width,
    paceId,
    walks,
    partnerState.counts,
    showToast,
  ]);

  const finalizeWalkSave = useCallback(
    async (openCard: boolean, includeFeedback: boolean) => {
      if (!finishDraft) return;
      const { walk: baseWalk, reward } = finishDraft;

      const nextCounts = {
        ...partnerState.counts,
        [reward.id]: (partnerState.counts[reward.id] ?? 0) + 1,
      };
      const nextPartnerState: PartnerState = {
        activeId: partnerState.activeId ?? reward.id,
        counts: nextCounts,
        starterClaimed: partnerState.starterClaimed,
      };
      savePartnerState(nextPartnerState);
      setPartnerState(nextPartnerState);

      const finalWalk: Walk = {
        ...baseWalk,
        partnerId: nextPartnerState.activeId ?? reward.id,
        ...(includeFeedback ? { feedback: { rating: fbRating, tags: fbTags } } : {}),
      };

      await saveWalk(finalWalk);
      clearDraft();
      setDraft(null);
      setFinishDraft(null);
      setMode('idle');
      setPoints([]);
      elapsedRef.current = 0;
      startRef.current = 0;
      setNow(Date.now());
      await refreshWalks();

      if (openCard) {
        setWalk(finalWalk);
        setJustFinished(true);
        setView('card');
        showToast('그림 카드와 타임랩스가 완성됐어요!');
      } else {
        showToast(`${reward.name}와(과) 함께 산책 기록을 저장했어요!`);
      }
    },
    [finishDraft, partnerState, fbRating, fbTags, refreshWalks, showToast],
  );

  const cancelWalk = useCallback(() => {
    autoRef.current?.stop();
    setAutoWalking(false);
    setScreenLocked(false);
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
      if (courseTab === 'pin') {
        setRouteLocked(false);
        setPinPoints((prev) => [...prev, ll]);
        return;
      }
      if (courseTab === 'ai') {
        setAiWaypoint({
          id: `pin_${Date.now()}`,
          name: '지정한 경유지',
          address: `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}`,
          location: ll,
        });
        showToast('지도에 AI 추천 경유지를 찍었어요.');
        return;
      }
      if (hasShape && courseTab === 'sketch') {
        setGuideCenter(ll);
        setRouteLocked(false);
        setCandidates([]);
        setSelectedCandId(null);
        showToast('도안을 여기로 옮겼어요.');
      }
    },
    [mode, sim, courseTab, hasShape, showToast],
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
    setRouteLocked(false);
    setCandidates([]);
    setSelectedCandId(null);
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

  const switchCourseTab = useCallback(
    (next: CourseTab) => {
      setCourseTab(next);
      setPage('main');
      setSheetSnap('half');
      setMapDrawMode(false);
      setCandidates([]);
      setSelectedCandId(null);
      setRouteLocked(false);
      if (next === 'free') {
        setGuideId(null);
        setCustomStrokes(null);
        setWalkableRoute(null);
      } else if (next === 'pin') {
        setGuideId(null);
        setCustomStrokes(null);
        if (pinPoints.length < 2) setWalkableRoute(null);
      } else if (next === 'ai') {
        setGuideId(null);
        setCustomStrokes(null);
        setWalkableRoute(null);
        setAiFormOpen(true);
      }
    },
    [pinPoints.length],
  );

  /* ---------------- 파생 값 ---------------- */

  const rec = mode === 'recording';
  const paused = mode === 'paused';
  const idle = mode === 'idle';
  const showBottomTabs = idle && view === 'map' && !showSketchPad && !finishDraft;

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

  const candidatePreviews: CandidatePreview[] = useMemo(
    () =>
      candidates.map((c) => ({
        id: c.id,
        path: c.route.path,
        active: c.id === selectedCandId,
      })),
    [candidates, selectedCandId],
  );

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.id === selectedCandId) ?? null,
    [candidates, selectedCandId],
  );

  const showWalkMap = appTab === 'walk' && view === 'map';

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink text-zinc-100">
      {/* 지도 뷰 (산책하기 탭) */}
      <div className={showWalkMap ? 'absolute inset-0' : 'pointer-events-none invisible absolute inset-0'}>
        <MapView
          ref={mapRef}
          points={points}
          color={color}
          width={width}
          guide={courseTab === 'sketch' ? guide : null}
          guideCenter={effectiveGuideCenter}
          guideRot={guideRot}
          guideInteractive={!rec && courseTab === 'sketch' && hasShape && !mapDrawMode}
          walkableRoute={walkableRoute}
          candidateRoutes={candidatePreviews}
          pinPoints={courseTab === 'pin' ? pinPoints : undefined}
          mapDrawMode={mapDrawMode && idle}
          activeNavPoint={rec && navProgress?.nextStep ? navProgress.nextStep.location : null}
          myLoc={myLoc}
          accuracy={accuracy}
          partnerIconUrl={activePartnerUrl}
          tile={tile}
          onMapClick={onMapClick}
          onCenterChange={setMapCenter}
          onMapDragStart={() => {
            if (idle && page === 'main') {
              setSheetSnap((prev) => (prev === 'full' ? 'half' : prev === 'half' ? 'peek' : prev));
            }
          }}
          onGuideMove={handleGuideMove}
          onGuideRotate={handleGuideRotate}
          onGuideTransformEnd={handleGuideTransformEnd}
          onMapFreehandStroke={(norm, center, sizeM) => {
            setMapDrawMode(false);
            applyCustomStrokes(norm, center, sizeM, '지도 손그림');
          }}
        />

        {/* 상단 헤더 + 우측 지도 컨트롤 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-3 pt-[max(0.7rem,env(safe-area-inset-top))]">
          <div className="pointer-events-auto flex flex-col gap-1.5">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#0B1017]/85 px-3 py-1.5 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-lime" />
              <span className="text-[12px] font-bold tracking-[0.16em] text-zinc-200">WALK DRAW</span>
              {rec && <span className="text-[10px] font-semibold text-rose">REC</span>}
              {paused && <span className="text-[10px] font-semibold text-amber">PAUSE</span>}
              {activePartnerUrl && idle && (
                <button
                  onClick={() => setAppTab('partners')}
                  className="ml-0.5 flex items-center gap-1 rounded-full border border-lime/30 bg-lime/10 px-1.5 py-0.5 text-[10px] font-bold text-lime"
                  title="동행 파트너 변경"
                >
                  <img
                    src={activePartnerUrl}
                    alt=""
                    className="h-3.5 w-3.5"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  {activePartner?.name}
                </button>
              )}
            </div>

            {/* 코스 모드 세그먼트 (산책 시작 전) */}
            {idle && page === 'main' && (
              <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-[#0B1017]/85 p-1 backdrop-blur-md">
                {(
                  [
                    ['sketch', '✏️ 그림'],
                    ['ai', '✨ AI 추천'],
                    ['pin', '📍 점 찍기'],
                    ['free', '🏃 자유'],
                  ] as [CourseTab, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => switchCourseTab(k)}
                    className={`rounded-xl px-2.5 py-1.5 text-[11px] font-bold transition ${
                      courseTab === k ? 'bg-lime text-[#0B1015]' : 'text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
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

            {(rec || paused) && (
              <button
                onClick={() => setScreenLocked(true)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[#0B1017]/85 text-sm backdrop-blur-md active:scale-95"
                aria-label="화면 잠금"
                title="오터치 방지 화면 잠금"
              >
                🔒
              </button>
            )}
          </div>
        </div>

        {/* 지도 위 직접 그리기 안내 배너 */}
        {mapDrawMode && idle && (
          <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+92px)] z-20 flex justify-center px-4">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-lime/40 bg-[#0B1017]/95 px-4 py-2 text-xs font-bold text-lime shadow-lg">
              <span>✍️ 지도 위에 한 번에 쓱 그려보세요</span>
              <button
                onClick={() => {
                  setMapDrawMode(false);
                  setSheetSnap('half');
                }}
                className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-zinc-200"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* 대기 중 길 탐색 로딩 뱃지 (지도를 가리지 않는 슬림 필) */}
        {idle && !mapDrawMode && routingBusy && (
          <div className="pointer-events-none absolute left-3 top-[calc(env(safe-area-inset-top)+92px)] z-20">
            <div className="flex items-center gap-1.5 rounded-full border border-sky/30 bg-[#0B1017]/90 px-3 py-1 text-[11px] font-semibold text-sky shadow backdrop-blur-md">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky" />
              ⏳ 도보 길 탐색 중…
            </div>
          </div>
        )}

        {/* Eyes-Free 실제 도보 네비게이션 HUD 배너 (산책 중/일시정지 전용) */}
        {(rec || paused) && !mapDrawMode && (walkableRoute || routingBusy) && (
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
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky/15 text-xl font-bold text-sky">
                        {rec && navProgress?.offRoute
                          ? '🧭'
                          : rec && navProgress?.currentStep
                            ? turnIcon(navProgress.currentStep.turnType)
                            : '🚶'}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-extrabold text-white">
                          {rec && navProgress?.offRoute
                            ? `경로에서 ${Math.round(navProgress.distFromRouteM)}m 벗어남`
                            : rec && navProgress?.currentStep
                              ? navProgress.currentStep.instruction
                              : selectedCandidate
                                ? `${selectedCandidate.label}${selectedCandidate.similarity ? ` · 닮음 ${selectedCandidate.similarity}%` : ''}`
                                : walkableRoute.isRealRoad
                                  ? `${effectiveShapeName ?? '도보'} 실제 길 안내`
                                  : `${effectiveShapeName ?? '도보'} 직선 안내 코스`}
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
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => {
                          setTtsEnabled((v) => !v);
                          showToast(ttsEnabled ? '음성 안내를 껐어요.' : '음성 안내(턴+1km)를 켰어요.');
                        }}
                        className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs ${
                          ttsEnabled
                            ? 'border-lime/40 bg-lime/15 text-lime'
                            : 'border-white/10 bg-white/[0.04] text-zinc-400'
                        }`}
                        aria-label="음성 안내"
                      >
                        {ttsEnabled ? '🔊' : '🔇'}
                      </button>
                      <button
                        onClick={() => {
                          setRouteLocked(false);
                          setRouteRefreshSeq((n) => n + 1);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-xs text-zinc-300 active:scale-95"
                        aria-label="경로 재탐색"
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
                          <span>선택한 코스 안내</span>
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

        {/* 하단 컨트롤 시트 (드래그 + 3단계 접기/펼치기 지원) */}
        <div
          style={{
            transform: sheetDragY ? `translateY(${Math.round(sheetDragY)}px)` : undefined,
            transition: sheetDragging
              ? 'none'
              : 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          className={`sheet no-select absolute inset-x-0 z-30 flex flex-col rounded-t-[26px] px-4 pt-1.5 ${
            showBottomTabs
              ? 'bottom-[calc(64px+env(safe-area-inset-bottom))] pb-2.5'
              : 'bottom-0 pb-[max(0.85rem,env(safe-area-inset-bottom))]'
          }`}
        >
          {/* 드래그 핸들 + 요약/접기 토글 헤더 */}
          <div
            onPointerDown={onSheetHandleDown}
            onPointerMove={onSheetHandleMove}
            onPointerUp={onSheetHandleUp}
            onPointerCancel={onSheetHandleUp}
            className="touch-none cursor-grab pb-1.5 pt-0.5 active:cursor-grabbing"
          >
            <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-white/25" />
            {page === 'main' && (
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
                  {idle ? (
                    walkableRoute ? (
                      <>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            walkableRoute.isRealRoad
                              ? 'bg-mint/15 text-mint'
                              : 'bg-amber/15 text-amber'
                          }`}
                        >
                          {walkableRoute.isRealRoad ? '실제 도보길' : '직선 안내'}
                        </span>
                        <span className="truncate font-bold text-white">
                          {selectedCandidate
                            ? selectedCandidate.label
                            : (effectiveShapeName ?? '선택 코스')}
                        </span>
                        <span className="shrink-0 font-extrabold tabular-nums text-lime">
                          {formatDistance(walkableRoute.totalDistanceM)}
                        </span>
                        <span className="shrink-0 text-zinc-400">
                          · {activePace.emoji} {formatEstimatedMinutes(navRouteEtaMin)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setRouteLocked(false);
                            setRouteRefreshSeq((n) => n + 1);
                          }}
                          className="ml-0.5 shrink-0 text-[11px] text-zinc-400 active:scale-90"
                          aria-label="경로 재탐색"
                          title="경로 재탐색"
                        >
                          {routingBusy ? '⏳' : '🔄'}
                        </button>
                      </>
                    ) : (
                      <span className="truncate text-zinc-300">
                        {activePace.emoji} {activePace.label} · 목표{' '}
                        <strong className="text-white">{formatDistance(targetDistanceM)}</strong>{' '}
                        <span className="text-zinc-400">
                          (약 {formatEstimatedMinutes(estimatedGoalMinutes)})
                        </span>
                      </span>
                    )
                  ) : (
                    <span className="truncate font-bold text-zinc-200">
                      {rec ? '🟢 산책 기록 중' : '⏸ 일시정지'} ·{' '}
                      <span className="tabular-nums text-lime">{formatDistance(distance)}</span> ·{' '}
                      <span className="tabular-nums">{formatClock(elapsed)}</span>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={toggleSheetPeek}
                  aria-label={effectiveSnap === 'peek' ? '코스 메뉴 펼치기' : '지도 넓게 보기'}
                  className="shrink-0 rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold text-zinc-200 active:scale-95"
                >
                  {effectiveSnap === 'peek' ? '▴ 코스 메뉴' : '▾ 지도 넓게'}
                </button>
              </div>
            )}
          </div>

          {page === 'main' && effectiveSnap === 'peek' && (
            <div className="mt-1 flex items-center justify-between gap-2">
              {idle && (
                <>
                  <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto scroll-x">
                    <button
                      onClick={() => openSheetPage('goal')}
                      className="chip flex shrink-0 items-center gap-1 rounded-full border-mint/30 bg-mint/10 px-2.5 py-1.5 text-[11px] font-semibold text-mint"
                    >
                      {activePace.emoji}{' '}
                      {goalMode === 'time'
                        ? formatEstimatedMinutes(goalMinutes)
                        : formatDistance(goalDistanceM)}
                    </button>
                    <button
                      onClick={toggleSheetPeek}
                      className="chip shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300"
                    >
                      {courseTab === 'ai'
                        ? candidates.length > 0
                          ? `코스 ${candidates.length}개`
                          : 'AI 설정'
                        : courseTab === 'pin'
                          ? `점 ${pinPoints.length}개`
                          : courseTab === 'sketch'
                            ? hasShape
                              ? effectiveShapeName ?? '도안'
                              : '도안 선택'
                            : '자유 산책'}
                    </button>
                  </div>
                  <button
                    onClick={beginWalk}
                    className="shrink-0 rounded-xl bg-lime px-5 py-2.5 text-[13px] font-extrabold text-[#0B1015] active:scale-[0.98]"
                  >
                    산책 시작
                  </button>
                </>
              )}

              {rec && (
                <div className="flex w-full items-center gap-2">
                  {sim && (
                    <button
                      onClick={startAutoWalk}
                      className="rounded-xl border border-sky/40 bg-sky/10 px-3 py-2.5 text-[12px] font-bold text-sky active:scale-[0.98]"
                    >
                      {autoWalking ? '⏹ 멈춤' : '▶ 자동 걷기'}
                    </button>
                  )}
                  <button
                    onClick={pauseWalk}
                    className="flex-1 rounded-xl border border-white/12 bg-white/[0.06] py-2.5 text-[13px] font-bold text-zinc-100 active:scale-[0.98]"
                  >
                    ⏸ 일시정지
                  </button>
                  <button
                    onClick={finishWalk}
                    className="flex-1 rounded-xl bg-lime py-2.5 text-[13px] font-extrabold text-[#0B1015] active:scale-[0.98]"
                  >
                    완료 · 카드 만들기
                  </button>
                </div>
              )}

              {paused && (
                <div className="flex w-full items-center gap-2">
                  <button
                    onClick={resumeWalk}
                    className="flex-1 rounded-xl bg-lime py-2.5 text-[13px] font-extrabold text-[#0B1015] active:scale-[0.98]"
                  >
                    ▶ 재개
                  </button>
                  <button
                    onClick={finishWalk}
                    className="flex-1 rounded-xl border border-white/12 bg-white/[0.06] py-2.5 text-[13px] font-bold text-zinc-100 active:scale-[0.98]"
                  >
                    완료
                  </button>
                </div>
              )}
            </div>
          )}

          {page === 'main' && effectiveSnap !== 'peek' && (
            <>
              <div
                className={`overflow-y-auto overscroll-contain pr-0.5 ${
                  effectiveSnap === 'full' ? 'max-h-[54dvh]' : 'max-h-[34dvh]'
                }`}
              >
                {/* 이어 그리기 배너 */}
                {draft && idle && (
                  <div className="mb-2 rounded-2xl border border-lime/25 bg-lime/[0.08] p-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[12px] font-semibold text-lime">이어 그릴 산책이 있어요</div>
                        <div className="text-[11px] text-zinc-400">
                          {formatDistance(pathDistance(draft.points))} · 지점 {draft.points.length}개
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => {
                            setPoints(draft.points);
                            setColor(draft.color);
                            setWidth(draft.width);
                            setGuideId(draft.guideId);
                            if (draft.course) {
                              const c = draft.course;
                              setCourseTab(c.courseTab);
                              setCustomStrokes(c.customStrokes);
                              setCustomTitle(c.customTitle);
                              setGuideSize(c.guideSize);
                              setGuideRot(c.guideRot);
                              setGuideCenter(c.guideCenter);
                              setPinPoints(c.pinPoints);
                              setWalkableRoute(c.walkableRoute);
                              setRouteLocked(c.routeLocked);
                              navPrevDistRef.current = 0;
                              lastSpokenStepRef.current = null;
                            }
                            walkStartedAtRef.current = draft.startedAt;
                            elapsedRef.current =
                              draft.elapsedMs ?? Math.max(0, Date.now() - draft.startedAt);
                            startRef.current = 0;
                            setMode('paused');
                            setDraft(null);
                            showToast('이어서 그릴 수 있어요. 재개를 눌러 주세요.');
                          }}
                          className="rounded-xl bg-lime px-3 py-1.5 text-[11px] font-bold text-[#0B1015]"
                        >
                          이어서
                        </button>
                        <button
                          onClick={() => {
                            clearDraft();
                            setDraft(null);
                          }}
                          className="rounded-xl border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-400"
                        >
                          버리기
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3코스 후보 카드 비교 (그림·AI 추천 시) */}
                {idle && candidates.length > 0 && (
                  <div className="mb-2 flex gap-2 overflow-x-auto scroll-x pb-0.5">
                    {candidates.map((c) => {
                      const active = c.id === selectedCandId;
                      return (
                        <div
                          key={c.id}
                          onClick={() => selectCandidate(c)}
                          className={`min-w-[152px] shrink-0 cursor-pointer rounded-2xl border p-2 transition ${
                            active
                              ? 'border-lime/70 bg-lime/[0.11]'
                              : 'border-white/10 bg-white/[0.03]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-[11px] font-extrabold text-white">
                              {c.label}
                            </span>
                            {c.similarity !== undefined ? (
                              <span className="shrink-0 rounded-full bg-mint/15 px-1.5 py-0.5 text-[9px] font-bold text-mint">
                                닮음 {c.similarity}%
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full bg-sky/15 px-1.5 py-0.5 text-[9px] font-bold text-sky">
                                {c.tag}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-300">
                            <span className="font-bold tabular-nums">
                              {formatDistance(c.route.totalDistanceM)}
                            </span>
                            <span className="text-[10px] text-zinc-400">
                              {activePace.emoji}{' '}
                              {formatEstimatedMinutes(
                                calcMinutesFromDistance(c.route.totalDistanceM, paceId),
                              )}
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-1.5">
                            <span className="text-[10px] text-zinc-500">
                              {c.route.isRealRoad ? '보행로' : '직선'}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                bookmarkCurrentRoute(
                                  c.route,
                                  `${effectiveShapeName ?? c.label} (${formatDistance(c.route.totalDistanceM)})`,
                                  courseTab === 'ai' ? 'ai' : 'sketch',
                                  c.similarity,
                                );
                              }}
                              className="rounded-lg border border-white/12 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-200 active:scale-95"
                            >
                              🔖 찜
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 코스 탭별 전용 액션 영역 (idle 시) */}
                {idle && courseTab === 'sketch' && (
                  <div className="mb-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 overflow-x-auto scroll-x">
                      <button
                        onClick={() => setShowSketchPad(true)}
                        className="chip shrink-0 rounded-full border-lime/35 bg-lime/10 px-3 py-1.5 text-[11px] font-bold text-lime"
                      >
                        🎨 캔버스 그리기
                      </button>
                      <button
                        onClick={() =>
                          setMapDrawMode((v) => {
                            const next = !v;
                            if (next) setSheetSnap('peek');
                            return next;
                          })
                        }
                        className={`chip shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                          mapDrawMode ? 'border-sky bg-sky/20 text-sky' : 'text-zinc-200'
                        }`}
                      >
                        ✍️ 지도 위 그리기
                      </button>
                      <button
                        onClick={() => openSheetPage('guide')}
                        className="chip shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold text-zinc-200"
                      >
                        {activeGuide ? `${activeGuide.emoji} ${activeGuide.name}` : '📐 도안 10종'}
                      </button>
                      {hasShape && (
                        <button
                          onClick={handleFindSketchCandidates}
                          disabled={candBusy}
                          className="shrink-0 rounded-full bg-sky px-3 py-1.5 text-[11px] font-extrabold text-[#070A0F] disabled:opacity-60 active:scale-95"
                        >
                          {candBusy ? '찾는 중…' : '🔍 코스 3개 찾기'}
                        </button>
                      )}
                    </div>
                    {hasShape && (
                      <div className="px-1 text-[10px] text-zinc-500">
                        ✥ 지도 위 핸들로 도안 이동 · ↻ 회전
                      </div>
                    )}
                  </div>
                )}

                {idle && courseTab === 'ai' && (
                  aiFormOpen || candidates.length === 0 ? (
                    <div className="mb-2 space-y-2 rounded-2xl border border-white/8 bg-white/[0.03] p-2.5">
                      <div className="flex gap-1.5">
                        <input
                          value={aiQuery}
                          onChange={(e) => setAiQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSearchPlaces();
                          }}
                          placeholder="경유지 검색 (예: 호수공원, 역, 또는 지도 탭)"
                          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0B1017] px-3 py-1.5 text-xs text-white outline-none placeholder:text-zinc-500 focus:border-lime/50"
                        />
                        <button
                          onClick={handleSearchPlaces}
                          disabled={aiSearching}
                          className="shrink-0 rounded-xl border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-bold text-zinc-200"
                        >
                          {aiSearching ? '…' : '검색'}
                        </button>
                      </div>

                      {aiResults.length > 0 && (
                        <div className="flex gap-1.5 overflow-x-auto scroll-x">
                          {aiResults.map((pl) => (
                            <button
                              key={pl.id}
                              onClick={() => {
                                setAiWaypoint(pl);
                                setAiResults([]);
                                mapRef.current?.flyTo(pl.location, 15);
                              }}
                              className="shrink-0 rounded-xl border border-sky/30 bg-sky/10 px-2.5 py-1 text-left text-[11px] text-sky"
                            >
                              <div className="font-bold">{pl.name}</div>
                              {pl.address && (
                                <div className="max-w-[140px] truncate text-[9px] text-zinc-400">
                                  {pl.address}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          {aiWaypoint ? (
                            <span className="flex items-center gap-1 rounded-full bg-mint/15 px-2.5 py-1 font-semibold text-mint">
                              📍 {aiWaypoint.name}
                              <button
                                onClick={() => setAiWaypoint(null)}
                                className="ml-0.5 text-zinc-400"
                              >
                                ✕
                              </button>
                            </span>
                          ) : (
                            <span className="text-zinc-400">지도 탭 또는 검색으로 경유지 선택</span>
                          )}
                        </div>
                        <div className="flex gap-1 rounded-full border border-white/10 bg-white/[0.03] p-0.5">
                          <button
                            onClick={() => setAiRoundTrip(true)}
                            className={`rounded-full px-2 py-0.5 font-bold ${
                              aiRoundTrip ? 'bg-lime text-[#0B1015]' : 'text-zinc-400'
                            }`}
                          >
                            왕복 순환
                          </button>
                          <button
                            onClick={() => setAiRoundTrip(false)}
                            className={`rounded-full px-2 py-0.5 font-bold ${
                              !aiRoundTrip ? 'bg-lime text-[#0B1015]' : 'text-zinc-400'
                            }`}
                          >
                            편도
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-1.5">
                        <button
                          onClick={handleGenerateAiCourses}
                          disabled={aiBusy}
                          className="flex-1 rounded-xl bg-sky py-2 text-xs font-extrabold text-[#070A0F] disabled:opacity-60 active:scale-[0.99]"
                        >
                          {aiBusy
                            ? 'AI가 도보 코스를 계산하는 중…'
                            : `✨ AI 코스 3개 추천 (${activePace.emoji} ${formatDistance(targetDistanceM)})`}
                        </button>
                        {candidates.length > 0 && (
                          <button
                            onClick={() => setAiFormOpen(false)}
                            className="shrink-0 rounded-xl border border-white/12 px-3 py-2 text-[11px] font-semibold text-zinc-300"
                          >
                            닫기
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-[11px]">
                      <span className="truncate text-zinc-300">
                        📍 {aiWaypoint ? aiWaypoint.name : '현위치 주변'} ·{' '}
                        {aiRoundTrip ? '왕복 순환' : '편도'}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => setAiFormOpen(true)}
                          className="rounded-lg border border-white/12 bg-white/[0.05] px-2 py-1 text-[10px] font-semibold text-zinc-200"
                        >
                          조건 변경
                        </button>
                        <button
                          onClick={handleGenerateAiCourses}
                          disabled={aiBusy}
                          className="rounded-lg bg-sky/20 px-2 py-1 text-[10px] font-bold text-sky disabled:opacity-50"
                        >
                          {aiBusy ? '계산 중…' : '🔄 다시 추천'}
                        </button>
                      </div>
                    </div>
                  )
                )}

                {idle && courseTab === 'pin' && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <div className="text-[11px] text-zinc-300">
                      {pinPoints.length === 0
                        ? '지도를 콕콕 눌러 원하는 길을 이어보세요.'
                        : `점 ${pinPoints.length}개 선택됨`}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => setPinPoints((p) => p.slice(0, -1))}
                        disabled={pinPoints.length === 0}
                        className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-300 disabled:opacity-40"
                      >
                        ↩ 되돌리기
                      </button>
                      <button
                        onClick={() => {
                          if (pinPoints.length >= 2) {
                            setPinPoints((p) => [...p, p[0]]);
                          }
                        }}
                        disabled={pinPoints.length < 2}
                        className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-sky disabled:opacity-40"
                      >
                        🔄 닫기
                      </button>
                      <button
                        onClick={() => {
                          setPinPoints([]);
                          setWalkableRoute(null);
                        }}
                        disabled={pinPoints.length === 0}
                        className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-400 disabled:opacity-40"
                      >
                        지우기
                      </button>
                      {walkableRoute && (
                        <button
                          onClick={() =>
                            bookmarkCurrentRoute(
                              walkableRoute,
                              `내 맘대로 코스 (${formatDistance(walkableRoute.totalDistanceM)})`,
                              'pin',
                            )
                          }
                          className="rounded-lg border border-lime/35 bg-lime/10 px-2 py-1 text-[11px] font-bold text-lime"
                        >
                          🔖 찜
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* 거리 · 시간 · 페이스 (기록/일시정지 시에만 표시) */}
                {(rec || paused) && (
                  <div className="mb-2">
                    <div className="flex items-end justify-between px-1">
                      <Stat label="거리" value={formatDistance(distance)} />
                      <Stat label="시간" value={formatClock(elapsed)} />
                      <Stat label="페이스" value={formatPace(distance, elapsed)} suffix="/km" />
                    </div>
                    <div className="mt-1.5 px-1">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span>
                          {activePace.emoji} {activePace.label} · 목표{' '}
                          <strong className="text-zinc-200">{formatDistance(activeGoalDistM)}</strong>{' '}
                          (약{' '}
                          {formatEstimatedMinutes(
                            walkableRoute ? navRouteEtaMin : estimatedGoalMinutes,
                          )}
                          )
                        </span>
                        <span className="font-semibold tabular-nums text-lime">{goalProgressPct}%</span>
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-lime transition-all"
                          style={{ width: `${goalProgressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 고정 하단 칩 + 주 액션 버튼 */}
              <div className="pt-1">
                <div className="flex items-center gap-2 overflow-x-auto scroll-x pb-0.5">
                  <button
                    onClick={() => openSheetPage('style')}
                    className="chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-zinc-200"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                    펜 스타일
                  </button>
                  <button
                    onClick={() => openSheetPage('goal')}
                    className="chip flex shrink-0 items-center gap-1.5 rounded-full border-mint/30 bg-mint/10 px-3 py-1.5 text-[11px] font-semibold text-mint"
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
                    className={`chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] ${
                      sim ? 'border-sky/50 bg-sky/15 text-sky' : 'text-zinc-300'
                    }`}
                  >
                    🛰 시뮬 {sim ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => {
                      setGuideId(null);
                      setCustomStrokes(null);
                      setGuideCenter(null);
                      setPinPoints([]);
                      setCandidates([]);
                      setSelectedCandId(null);
                      setWalkableRoute(null);
                      setRouteLocked(false);
                      setAiFormOpen(true);
                    }}
                    className="chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-zinc-400"
                  >
                    ♻︎ 초기화
                  </button>
                </div>

                {idle && (
                  <button
                    onClick={beginWalk}
                    className="mt-2 w-full rounded-2xl bg-lime py-3 text-[15px] font-extrabold text-[#0B1015] active:scale-[0.99]"
                  >
                    산책 시작
                  </button>
                )}

                {rec && (
                  <div className="mt-2 space-y-2">
                    {sim && (
                      <button
                        onClick={startAutoWalk}
                        className="w-full rounded-xl border border-sky/40 bg-sky/10 py-2 text-[13px] font-semibold text-sky active:scale-[0.99]"
                      >
                        {autoWalking
                          ? '⏹ 자동 걷기 멈추기'
                          : walkableRoute?.isRealRoad
                            ? `🧭 실제 도보 경로로 자동 걷기 (${activePace.label})`
                            : hasShape
                              ? `▶ ${effectiveShapeName ?? '도안'} 자동 걷기`
                              : '▶ 자동 걷기 (데모 루트)'}
                      </button>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={pauseWalk}
                        className="flex-1 rounded-2xl border border-white/12 bg-white/[0.06] py-3 text-[14px] font-bold text-zinc-100 active:scale-[0.99]"
                      >
                        ⏸ 일시정지
                      </button>
                      <button
                        onClick={finishWalk}
                        className="flex-1 rounded-2xl bg-lime py-3 text-[14px] font-extrabold text-[#0B1015] active:scale-[0.99]"
                      >
                        완료 · 카드 만들기
                      </button>
                    </div>
                  </div>
                )}

                {paused && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <button
                        onClick={resumeWalk}
                        className="flex-1 rounded-2xl bg-lime py-3 text-[14px] font-extrabold text-[#0B1015] active:scale-[0.99]"
                      >
                        ▶ 재개
                      </button>
                      <button
                        onClick={finishWalk}
                        className="flex-1 rounded-2xl border border-white/12 bg-white/[0.06] py-3 text-[14px] font-bold text-zinc-100 active:scale-[0.99]"
                      >
                        완료
                      </button>
                    </div>
                    <button onClick={cancelWalk} className="w-full py-1 text-[12px] text-zinc-500">
                      기록 취소
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {page === 'goal' && (
            <div className="max-h-[62dvh] overflow-y-auto overscroll-contain pb-1 pr-0.5">
              <SheetHeader title="도보 시간 · 거리 · 속도" onBack={() => openSheetPage('main')} />

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
                      <div
                        className={`mt-0.5 text-[12px] font-extrabold tabular-nums ${
                          selected ? 'text-lime' : 'text-mint'
                        }`}
                      >
                        {goalMode === 'time' ? formatDistance(calcDist) : formatEstimatedMinutes(calcMin)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {hasShape && (
                <div className="mt-3 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                  <div>
                    <div className="text-[12px] font-semibold text-zinc-200">
                      도안 크기 자동 맞추기 ({effectiveShapeName})
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      목표 {formatDistance(targetDistanceM)}에 맞춰 크기 {guideSize} m 적용
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const next = !autoSizeToGoal;
                      setAutoSizeToGoal(next);
                      if (next && effectiveSubpaths) {
                        setGuideSize(
                          xyGroupsSizeForDistance(
                            effectiveSubpaths,
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
                onClick={() => openSheetPage('main')}
                className="mt-3 w-full rounded-2xl bg-lime py-3 text-[13px] font-extrabold text-[#0B1015] active:scale-[0.99]"
              >
                적용 ({activePace.emoji} {formatDistance(targetDistanceM)} ·{' '}
                {formatEstimatedMinutes(estimatedGoalMinutes)})
              </button>
            </div>
          )}

          {page === 'guide' && (
            <div className="max-h-[62dvh] overflow-y-auto overscroll-contain pb-1 pr-0.5">
              <SheetHeader title="도안 10종 · 위치·회전" onBack={() => openSheetPage('main')} />
              <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                {GUIDES.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => selectGuide(g.id)}
                    className={`flex flex-col items-center gap-0.5 rounded-2xl border py-2 text-[10px] active:scale-95 ${
                      guideId === g.id && !customStrokes
                        ? 'border-lime/60 bg-lime/12 text-lime'
                        : 'border-white/10 bg-white/[0.03] text-zinc-300'
                    }`}
                  >
                    <span className="text-base leading-none">{g.emoji}</span>
                    {g.name}
                  </button>
                ))}
              </div>

              {hasShape && (
                <div className="mt-3 space-y-2 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12px] font-semibold text-zinc-200">
                        실제 도보 길 네비게이션
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        인도/산책로에 맞춘 턴바이턴 안내
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
                    label={`크기 (예상 ${formatDistance(
                      walkableRoute?.totalDistanceM || estimatedGuideDistanceM,
                    )})`}
                    value={guideSize}
                    min={40}
                    max={2500}
                    step={10}
                    display={`${guideSize} m`}
                    onChange={(v) => {
                      // 직접 크기를 고르면 자동 맞추기를 끈다 (보정이 사용자의 값을 덮어쓰지 않도록)
                      setAutoSizeToGoal(false);
                      setRouteLocked(false);
                      setGuideSize(v);
                    }}
                  />
                  <Slider
                    label="회전"
                    value={guideRot}
                    min={0}
                    max={359}
                    step={1}
                    display={`${guideRot}°`}
                    onChange={(v) => {
                      setRouteLocked(false);
                      setGuideRot(v);
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (myLoc) {
                          setGuideCenter(myLoc);
                          setRouteLocked(false);
                          mapRef.current?.flyTo(myLoc, 17);
                        } else {
                          showToast('내 위치를 아직 찾지 못했어요.');
                        }
                      }}
                      className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2 text-[11px] font-semibold text-zinc-200"
                    >
                      📍 내 위치 중심
                    </button>
                    <button
                      onClick={() => {
                        if (effectiveSubpaths) {
                          setRouteLocked(false);
                          setGuideSize(
                            xyGroupsSizeForDistance(
                              effectiveSubpaths,
                              targetDistanceM,
                              walkableNavEnabled ? 1.2 : 1.0,
                            ),
                          );
                          showToast(`목표(${formatDistance(targetDistanceM)})에 크기를 맞췄어요.`);
                        }
                      }}
                      className="flex-1 rounded-xl border border-mint/25 bg-mint/10 py-2 text-[11px] font-semibold text-mint"
                    >
                      🎯 목표 거리 맞춤
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    setGuideId(null);
                    setCustomStrokes(null);
                    setGuideCenter(null);
                    setWalkableRoute(null);
                    setCandidates([]);
                    setSelectedCandId(null);
                    openSheetPage('main');
                  }}
                  className="flex-1 rounded-2xl border border-white/12 bg-white/[0.04] py-2.5 text-[13px] font-semibold text-zinc-300"
                >
                  도안 없이
                </button>
                <button
                  onClick={() => openSheetPage('main')}
                  className="flex-1 rounded-2xl bg-lime py-2.5 text-[13px] font-extrabold text-[#0B1015]"
                >
                  확인
                </button>
              </div>
            </div>
          )}

          {page === 'style' && (
            <div className="max-h-[62dvh] overflow-y-auto overscroll-contain pb-1 pr-0.5">
              <SheetHeader title="펜 스타일 · 지도" onBack={() => openSheetPage('main')} />
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

              <button
                onClick={() => openSheetPage('main')}
                className="mt-3 w-full rounded-2xl bg-white/[0.06] py-3 text-[13px] font-semibold text-zinc-200"
              >
                확인
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 나의 기록 탭 */}
      {appTab === 'records' && view === 'map' && (
        <div className="absolute inset-0 z-30">
          <RecordsView
            walks={walks}
            savedRoutes={savedRoutes}
            onOpenWalk={(w) => {
              setWalk(w);
              setJustFinished(false);
              setView('card');
            }}
            onDeleteWalk={async (id) => {
              await deleteWalk(id);
              await refreshWalks();
              showToast('산책 기록을 삭제했어요.');
            }}
            onStartSavedRoute={(r) => {
              const restored = hydrateSavedRoute(r.path, r.isRealRoad, myLocRef.current);
              setAppTab('walk');
              setCourseTab(r.kind === 'ai' ? 'ai' : r.kind === 'pin' ? 'pin' : 'sketch');
              setWalkableRoute(restored);
              setRouteLocked(true);
              setPinPoints(r.kind === 'pin' ? r.path : []);
              setCandidates([]);
              setSelectedCandId(null);
              setPage('main');
              setSheetSnap('half');
              if (restored.path.length >= 2) {
                window.setTimeout(() => fitRouteInView(restored.path, 'half'), 100);
              }
              showToast(`[${r.title}] 코스를 불러왔어요! [산책 시작]을 눌러 따라 걸어보세요.`);
            }}
            onDeleteSavedRoute={(id) => {
              setSavedRoutes(deleteSavedRoute(id));
              showToast('찜한 코스를 삭제했어요.');
            }}
            onToast={showToast}
          />
        </div>
      )}

      {/* 파트너 탭 */}
      {appTab === 'partners' && view === 'map' && (
        <div className="absolute inset-0 z-30">
          <PartnersView
            state={partnerState}
            onSelectActive={selectActivePartner}
            onClaimStarter={claimStarterPartner}
          />
        </div>
      )}

      {/* 하단 3탭 내비게이션 바 (산책온 스타일) */}
      {showBottomTabs && (
        <nav
          aria-label="주요 메뉴"
          className="fixed inset-x-0 bottom-0 z-35 flex h-[calc(64px+env(safe-area-inset-bottom))] items-start justify-around border-t border-white/10 bg-[#080C12]/95 px-2 pt-2 backdrop-blur-md"
        >
          {(
            [
              ['walk', '👣', '산책하기', false],
              ['records', '📊', '나의 기록', false],
              ['partners', '🐾', '파트너', !partnerState.starterClaimed],
            ] as [AppTab, string, string, boolean][]
          ).map(([id, icon, label, badge]) => {
            const active = appTab === id;
            return (
              <button
                key={id}
                onClick={() => {
                  setAppTab(id);
                  if (id === 'records') refreshWalks();
                }}
                className={`relative flex flex-1 flex-col items-center gap-0.5 py-1 transition ${
                  active ? 'text-lime' : 'text-zinc-400'
                }`}
              >
                <span className="relative text-lg leading-none">
                  {icon}
                  {badge && (
                    <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-rose" />
                  )}
                </span>
                <span className="text-[11px] font-bold">{label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* 자유 그림 스케치 패드 모달 */}
      {showSketchPad && (
        <SketchPad
          onCancel={() => setShowSketchPad(false)}
          onComplete={(normStrokes) => {
            setShowSketchPad(false);
            applyCustomStrokes(normStrokes, null, null, '내 손그림');
          }}
        />
      )}

      {/* 오터치 방지 화면 잠금 오버레이 */}
      {screenLocked && (rec || paused) && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#05070B]/95 px-6 py-14 text-center backdrop-blur-md">
          <div className="text-xs font-bold tracking-[0.2em] text-zinc-500">
            🔒 EYES-FREE · 화면 잠금 중
          </div>

          <div className="w-full max-w-xs space-y-5">
            {navProgress?.currentStep && (
              <div className="rounded-3xl border border-sky/30 bg-sky/10 p-5">
                <div className="text-4xl">{turnIcon(navProgress.currentStep.turnType)}</div>
                <div className="mt-2 text-lg font-extrabold text-white">
                  {navProgress.currentStep.instruction}
                </div>
                {navProgress.nextStep && (
                  <div className="mt-1 text-xs text-sky">
                    {formatDistance(navProgress.distToNextStepM)} 앞 {navProgress.nextStep.instruction}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div>
                <div className="text-[10px] text-zinc-500">거리</div>
                <div className="mt-1 text-base font-extrabold tabular-nums text-lime">
                  {formatDistance(distance)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500">시간</div>
                <div className="mt-1 text-base font-extrabold tabular-nums text-white">
                  {formatClock(elapsed)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500">페이스</div>
                <div className="mt-1 text-base font-extrabold tabular-nums text-mint">
                  {formatPace(distance, elapsed)}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => setScreenLocked(false)}
            className="rounded-full border border-lime/40 bg-lime/15 px-7 py-3.5 text-sm font-extrabold text-lime active:scale-95"
          >
            🔓 화면 잠금 해제
          </button>
        </div>
      )}

      {/* 산책 완료 후기 + 파트너 해금 모달 */}
      {finishDraft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center">
          <div className="fade-up w-full max-w-sm rounded-3xl border border-white/12 bg-[#0D131C] p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold tracking-[0.16em] text-lime">산책 완주!</div>
                <h2 className="mt-0.5 text-lg font-extrabold text-white">
                  {formatDistance(finishDraft.walk.distanceM)} ·{' '}
                  {formatDuration(finishDraft.walk.durationMs)}
                </h2>
              </div>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                style={{
                  color: GRADE_LABELS[finishDraft.reward.grade].color,
                  background: GRADE_LABELS[finishDraft.reward.grade].bg,
                }}
              >
                {GRADE_LABELS[finishDraft.reward.grade].label}
              </span>
            </div>

            {/* 파트너 보상 카드 */}
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-lime/30 bg-lime/[0.08] p-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#090E15]">
                <img
                  src={partnerSvgDataUrl(finishDraft.reward, false)}
                  alt={finishDraft.reward.name}
                  className="h-11 w-11"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-extrabold text-white">
                    {finishDraft.reward.name}
                  </span>
                  {finishDraft.isNewReward && (
                    <span className="rounded-full bg-rose px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                      NEW
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-300">{finishDraft.reward.desc}</p>
              </div>
            </div>

            {/* 길 만족도 후기 */}
            <div className="mt-4">
              <div className="text-xs font-bold text-zinc-300">오늘 걸은 길은 어땠나요?</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(
                  [
                    ['great', '😍 최고예요'],
                    ['good', '🙂 좋아요'],
                    ['meh', '😐 아쉬워요'],
                  ] as [WalkFeedback['rating'], string][]
                ).map(([r, label]) => (
                  <button
                    key={r}
                    onClick={() => setFbRating(r)}
                    className={`rounded-xl border py-2 text-xs font-bold transition ${
                      fbRating === r
                        ? 'border-lime bg-lime/15 text-lime'
                        : 'border-white/10 bg-white/[0.03] text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {FEEDBACK_TAGS.map((tag) => {
                const active = fbTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() =>
                      setFbTags((prev) =>
                        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
                      )
                    }
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      active
                        ? 'border-sky/60 bg-sky/15 text-sky'
                        : 'border-white/10 bg-white/[0.03] text-zinc-400'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => finalizeWalkSave(false, true)}
                className="flex-1 rounded-2xl border border-white/12 py-3 text-xs font-bold text-zinc-300"
              >
                저장하고 닫기
              </button>
              <button
                onClick={() => finalizeWalkSave(true, true)}
                className="flex-[1.4] rounded-2xl bg-lime py-3 text-xs font-extrabold text-[#0B1015] active:scale-[0.99]"
              >
                🎨 카드 스튜디오 열기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 포스터 카드 스튜디오 */}
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

      {/* 토스트 */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+140px)] z-55 flex justify-center px-6">
          <div className="fade-up max-w-[92%] rounded-2xl border border-white/10 bg-[#111A24]/95 px-3.5 py-2 text-center text-[12px] leading-snug text-zinc-200 shadow-lg backdrop-blur">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="flex-1">
      <div className="text-[10px] font-semibold tracking-[0.14em] text-zinc-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-[20px] font-extrabold leading-none tabular-nums text-white">
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
