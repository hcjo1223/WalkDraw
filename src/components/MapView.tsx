import L from 'leaflet';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  bboxOf,
  centerOf,
  haversine,
  softenLatLngSegments,
  toXY,
  type LatLng,
  type PathPoint,
  type XY,
} from '../lib/geo';
import type { WalkableRoute } from '../lib/routing';

// CARTO 베이스맵은 2025년부터 API 키 없이는 워터마크 타일만 내려줍니다.
// 그래서 키가 필요 없는 OSM 타일을 쓰고, 다크 스타일은 CSS 필터(index.css)로 만듭니다.
// 다크 레이어만 {s} 서브도메인(a./b./c.)이 붙어, 필터 선택자가 두 레이어를 구분합니다.
const TILES = {
  dark: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  voyager: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

export type MapHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (ll: LatLng, zoom?: number) => void;
  center: () => LatLng | null;
  fit: (lls: LatLng[], pad?: { top?: number; bottom?: number }) => void;
};

export type CandidatePreview = {
  id: string;
  path: LatLng[];
  active: boolean;
};

type Props = {
  points: PathPoint[];
  color: string;
  width: number;
  guide: LatLng[][] | null;
  guideCenter: LatLng | null;
  guideRot: number;
  guideInteractive: boolean;
  walkableRoute: WalkableRoute | null;
  candidateRoutes?: CandidatePreview[];
  pinPoints?: LatLng[];
  mapDrawMode?: boolean;
  activeNavPoint: LatLng | null;
  myLoc: LatLng | null;
  accuracy: number | null;
  partnerIconUrl?: string | null;
  tile: 'dark' | 'voyager';
  onMapClick: (ll: LatLng) => void;
  onCenterChange: (ll: LatLng) => void;
  onMapDragStart?: () => void;
  onGuideMove?: (ll: LatLng) => void;
  onGuideRotate?: (deg: number) => void;
  onGuideTransformEnd?: () => void;
  onMapFreehandStroke?: (normStrokes: XY[][], center: LatLng, sizeMeters: number) => void;
};

const MapView = forwardRef<MapHandle, Props>(function MapView(
  {
    points,
    color,
    width,
    guide,
    guideCenter,
    guideRot,
    guideInteractive,
    walkableRoute,
    candidateRoutes,
    pinPoints,
    mapDrawMode,
    activeNavPoint,
    myLoc,
    accuracy,
    partnerIconUrl,
    tile,
    onMapClick,
    onCenterChange,
    onMapDragStart,
    onGuideMove,
    onGuideRotate,
    onGuideTransformEnd,
    onMapFreehandStroke,
  },
  ref,
) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const svgRendererRef = useRef<L.SVG | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const auraRef = useRef<L.Polyline | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const guideRef = useRef<L.Polyline[]>([]);
  const guideHitRef = useRef<L.Polyline[]>([]);
  const moveHandleRef = useRef<L.Marker | null>(null);
  const rotHandleRef = useRef<L.Marker | null>(null);
  const candidateLayersRef = useRef<L.Layer[]>([]);
  const routeLayersRef = useRef<L.Layer[]>([]);
  const pinLayersRef = useRef<L.Layer[]>([]);
  const navTurnRef = useRef<L.CircleMarker | null>(null);
  const meRef = useRef<L.CircleMarker | null>(null);
  const partnerMarkerRef = useRef<L.Marker | null>(null);
  const accRef = useRef<L.Circle | null>(null);

  const clickCb = useRef(onMapClick);
  const centerCb = useRef(onCenterChange);
  const dragStartCb = useRef(onMapDragStart);
  const moveCb = useRef(onGuideMove);
  const rotCb = useRef(onGuideRotate);
  const endCb = useRef(onGuideTransformEnd);
  const freehandCb = useRef(onMapFreehandStroke);
  const guideCenterRef = useRef(guideCenter);
  const guideRotRef = useRef(guideRot);
  const draggingRef = useRef(false);
  const mapDrawModeRef = useRef(Boolean(mapDrawMode));

  const [drawStrokePts, setDrawStrokePts] = useState<XY[]>([]);
  const drawActiveRef = useRef(false);

  clickCb.current = onMapClick;
  centerCb.current = onCenterChange;
  dragStartCb.current = onMapDragStart;
  moveCb.current = onGuideMove;
  rotCb.current = onGuideRotate;
  endCb.current = onGuideTransformEnd;
  freehandCb.current = onMapFreehandStroke;
  guideCenterRef.current = guideCenter;
  guideRotRef.current = guideRot;
  mapDrawModeRef.current = Boolean(mapDrawMode);

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      zoomSnap: 0.5,
      minZoom: 3,
      maxZoom: 19,
      inertia: true,
    }).setView([37.3945, 126.9632], 16);

    svgRendererRef.current = L.svg({ padding: 0.5 }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (draggingRef.current || mapDrawModeRef.current) return;
      clickCb.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    map.on('dragstart', () => {
      if (!draggingRef.current) dragStartCb.current?.();
    });
    map.on('moveend', () => {
      const c = map.getCenter();
      centerCb.current({ lat: c.lat, lng: c.lng });
    });
    mapRef.current = map;

    const invalidate = () => map.invalidateSize();
    const t1 = window.setTimeout(invalidate, 80);
    const t2 = window.setTimeout(invalidate, 400);
    const ro = new ResizeObserver(invalidate);
    ro.observe(el);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      svgRendererRef.current = null;
      tileRef.current = null;
      auraRef.current = null;
      lineRef.current = null;
      guideRef.current = [];
      guideHitRef.current = [];
      moveHandleRef.current = null;
      rotHandleRef.current = null;
      candidateLayersRef.current = [];
      routeLayersRef.current = [];
      pinLayersRef.current = [];
      navTurnRef.current = null;
      meRef.current = null;
      partnerMarkerRef.current = null;
      accRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(1),
    zoomOut: () => mapRef.current?.zoomOut(1),
    flyTo: (ll, zoom) => {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo([ll.lat, ll.lng], zoom ?? Math.max(map.getZoom(), 17), { duration: 0.8 });
    },
    center: () => {
      const map = mapRef.current;
      if (!map) return null;
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    },
    fit: (lls, pad) => {
      const map = mapRef.current;
      if (!map || lls.length === 0) return;
      const b = L.latLngBounds(lls.map((p) => [p.lat, p.lng] as [number, number]));
      const top = pad?.top ?? 80;
      const bottom = pad?.bottom ?? 80;
      map.fitBounds(b, {
        paddingTopLeft: [28, top],
        paddingBottomRight: [28, bottom],
        maxZoom: 18,
      });
    },
  }));

  // 지도 위 직접 그리기 모드 활성 시 드래그 잠금
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapDrawMode) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
      setDrawStrokePts([]);
      drawActiveRef.current = false;
    }
  }, [mapDrawMode]);

  // 직접 그리기 캔버스 렌더
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas || !mapDrawMode) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (drawStrokePts.length < 2) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(drawStrokePts[0].x, drawStrokePts[0].y);
    for (let i = 1; i < drawStrokePts.length; i++) {
      ctx.lineTo(drawStrokePts[i].x, drawStrokePts[i].y);
    }
    ctx.strokeStyle = 'rgba(200, 255, 77, 0.28)';
    ctx.lineWidth = 14;
    ctx.stroke();

    ctx.strokeStyle = '#C8FF4D';
    ctx.lineWidth = 5;
    ctx.stroke();
  }, [drawStrokePts, mapDrawMode]);

  const handleMapDrawDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    drawActiveRef.current = true;
    setDrawStrokePts([{ x: e.clientX - r.left, y: e.clientY - r.top }]);
  }, []);

  const handleMapDrawMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawActiveRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    setDrawStrokePts((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 4) return prev;
      return [...prev, p];
    });
  }, []);

  const handleMapDrawUp = useCallback(() => {
    if (!drawActiveRef.current) return;
    drawActiveRef.current = false;
    const map = mapRef.current;
    setDrawStrokePts((pts) => {
      if (map && pts.length >= 4) {
        const lls = pts.map((p) => {
          const ll = map.containerPointToLatLng(L.point(p.x, p.y));
          return { lat: ll.lat, lng: ll.lng };
        });
        const c = centerOf(lls);
        if (c) {
          const xys = lls.map((ll) => toXY(ll, c));
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let maxY = -Infinity;
          for (const q of xys) {
            if (q.x < minX) minX = q.x;
            if (q.x > maxX) maxX = q.x;
            if (q.y < minY) minY = q.y;
            if (q.y > maxY) maxY = q.y;
          }
          const span = Math.max(maxX - minX, maxY - minY, 40);
          const k = 2 / span;
          const norm = xys.map((q) => ({ x: q.x * k, y: q.y * k }));
          const sizeM = Math.max(80, Math.min(2500, Math.round(span / 10) * 10));
          freehandCb.current?.([norm], c, sizeM);
        }
      }
      return [];
    });
  }, []);

  // 타일
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
      tileRef.current = null;
    }
    const layer = L.tileLayer(TILES[tile], {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      detectRetina: true,
      crossOrigin: true,
    }).addTo(map);
    layer.setZIndex(1);
    tileRef.current = layer;
  }, [tile]);

  // 그려지는 선 (점이 늘어날 때는 기존 레이어를 갱신만 한다)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const segs = softenLatLngSegments(points);
    const latlngs = segs
      .filter((s) => s.length > 1)
      .map((s) => s.map((p) => [p.lat, p.lng] as [number, number]));

    if (!latlngs.length) {
      if (auraRef.current) {
        map.removeLayer(auraRef.current);
        auraRef.current = null;
      }
      if (lineRef.current) {
        map.removeLayer(lineRef.current);
        lineRef.current = null;
      }
      return;
    }

    if (!lineRef.current) {
      auraRef.current = L.polyline(latlngs, {
        color,
        weight: Math.max(6, width * 4.2),
        opacity: 0.16,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(map);
      lineRef.current = L.polyline(latlngs, {
        color,
        weight: width,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(map);
      return;
    }

    lineRef.current.setLatLngs(latlngs);
    lineRef.current.setStyle({ color, weight: width });
    auraRef.current?.setLatLngs(latlngs);
    auraRef.current?.setStyle({ color, weight: Math.max(6, width * 4.2) });
  }, [points, color, width]);

  // 후보 비교용 보조 경로 (비선택 후보 점선)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const l of candidateLayersRef.current) map.removeLayer(l);
    candidateLayersRef.current = [];
    if (!candidateRoutes || candidateRoutes.length === 0) return;

    const layers: L.Layer[] = [];
    for (const c of candidateRoutes) {
      if (c.active || c.path.length < 2) continue;
      layers.push(
        L.polyline(
          c.path.map((p) => [p.lat, p.lng] as [number, number]),
          {
            color: '#9DB3C8',
            weight: 3,
            opacity: 0.32,
            dashArray: '4 7',
            lineCap: 'round',
            interactive: false,
          },
        ).addTo(map),
      );
    }
    candidateLayersRef.current = layers;
  }, [candidateRoutes]);

  // 실제 도보 경로 레이어
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const l of routeLayersRef.current) map.removeLayer(l);
    routeLayersRef.current = [];
    if (!walkableRoute || walkableRoute.path.length < 2) return;

    const layers: L.Layer[] = [];

    if (walkableRoute.approachPath && walkableRoute.approachPath.length >= 2) {
      const appLL = walkableRoute.approachPath.map((p) => [p.lat, p.lng] as [number, number]);
      layers.push(
        L.polyline(appLL, {
          color: '#5EC8FF',
          weight: 3,
          opacity: 0.7,
          dashArray: '4 8',
          interactive: false,
        }).addTo(map),
      );
    }

    const routeLL = walkableRoute.path.map((p) => [p.lat, p.lng] as [number, number]);
    layers.push(
      L.polyline(routeLL, {
        color: '#070A0F',
        weight: 8,
        opacity: 0.45,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(map),
    );
    layers.push(
      L.polyline(routeLL, {
        color: walkableRoute.isRealRoad ? '#5EC8FF' : '#9DB3C8',
        weight: 4,
        opacity: 0.92,
        dashArray: walkableRoute.isRealRoad ? undefined : '6 8',
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(map),
    );

    const startPt = walkableRoute.path[0];
    const startIcon = L.divIcon({
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      html: `<div style="width:24px;height:24px;border-radius:999px;background:#C8FF4D;color:#070A0F;font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center;border:2px solid #070A0F;box-shadow:0 2px 8px rgba(0,0,0,0.45);">S</div>`,
    });
    layers.push(L.marker([startPt.lat, startPt.lng], { icon: startIcon, interactive: false }).addTo(map));

    routeLayersRef.current = layers;
  }, [walkableRoute]);

  // 점 찍기 핀 마커 (1, 2, 3...)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const l of pinLayersRef.current) map.removeLayer(l);
    pinLayersRef.current = [];
    if (!pinPoints || pinPoints.length === 0) return;

    pinLayersRef.current = pinPoints.map((pt, idx) => {
      const isClosedLoopEnd =
        idx > 0 &&
        idx === pinPoints.length - 1 &&
        haversine(pt, pinPoints[0]) < 8;
      const label = isClosedLoopEnd ? '🏁' : String(idx + 1);
      const icon = L.divIcon({
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        html: `<div style="width:24px;height:24px;border-radius:999px;background:${
          idx === 0 ? '#C8FF4D' : '#111A24'
        };color:${
          idx === 0 ? '#070A0F' : '#5EC8FF'
        };font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center;border:2px solid #5EC8FF;box-shadow:0 2px 10px rgba(0,0,0,0.55);">${label}</div>`,
      });
      return L.marker([pt.lat, pt.lng], {
        icon,
        interactive: false,
        zIndexOffset: 450,
      }).addTo(map);
    });
  }, [pinPoints]);

  // 다음 회전 지점 하이라이트
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (navTurnRef.current) {
      map.removeLayer(navTurnRef.current);
      navTurnRef.current = null;
    }
    if (!activeNavPoint) return;
    navTurnRef.current = L.circleMarker([activeNavPoint.lat, activeNavPoint.lng], {
      radius: 9,
      color: '#C8FF4D',
      weight: 3,
      opacity: 0.95,
      fillColor: '#070A0F',
      fillOpacity: 0.85,
      interactive: false,
    }).addTo(map);
  }, [activeNavPoint]);

  // 도안 가이드 선 렌더링 (제스처 드래그 중에도 기존 SVG 히트 레이어를 깨지 않도록 점진 갱신)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const validLines = (guide ?? []).filter((l) => l.length >= 2);
    const hasRoute = Boolean(walkableRoute && walkableRoute.path.length >= 2);

    if (guideRef.current.length !== validLines.length) {
      for (const layer of guideRef.current) map.removeLayer(layer);
      guideRef.current = validLines.map((line) =>
        L.polyline(
          line.map((p) => [p.lat, p.lng] as [number, number]),
          {
            color: '#9DB3C8',
            weight: hasRoute ? 2 : 3,
            opacity: hasRoute ? 0.42 : 0.78,
            dashArray: '2 8',
            lineCap: 'round',
            interactive: false,
          },
        ).addTo(map),
      );
    } else {
      validLines.forEach((line, idx) => {
        guideRef.current[idx].setLatLngs(line.map((p) => [p.lat, p.lng] as [number, number]));
        guideRef.current[idx].setStyle({
          weight: hasRoute ? 2 : 3,
          opacity: hasRoute ? 0.42 : 0.78,
        });
      });
    }
  }, [guide, walkableRoute]);

  // 도안 제스처 이동/회전 인터랙션 (히트 폴리라인 + 중앙 이동 핸들 + 회전 핸들)
  useEffect(() => {
    const map = mapRef.current;
    const svgRenderer = svgRendererRef.current;
    if (!map || !svgRenderer) return;

    const cleanupHandlers: Array<() => void> = [];

    const attachMoveGesture = (domEl: HTMLElement | SVGElement) => {
      (domEl as HTMLElement).style.touchAction = 'none';
      (domEl as HTMLElement).style.cursor = 'grab';

      const onPointerDown = (e: Event) => {
        const pe = e as PointerEvent;
        if (pe.button !== undefined && pe.button !== 0) return;
        const origCenter = guideCenterRef.current;
        if (!origCenter) return;

        pe.stopPropagation();
        pe.preventDefault();
        draggingRef.current = true;
        map.dragging.disable();
        (domEl as HTMLElement).style.cursor = 'grabbing';

        const rect = map.getContainer().getBoundingClientRect();
        const startLL = map.containerPointToLatLng(
          L.point(pe.clientX - rect.left, pe.clientY - rect.top),
        );

        const onMove = (me: PointerEvent) => {
          me.preventDefault();
          const curLL = map.containerPointToLatLng(
            L.point(me.clientX - rect.left, me.clientY - rect.top),
          );
          moveCb.current?.({
            lat: origCenter.lat + (curLL.lat - startLL.lat),
            lng: origCenter.lng + (curLL.lng - startLL.lng),
          });
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          map.dragging.enable();
          (domEl as HTMLElement).style.cursor = 'grab';
          window.setTimeout(() => {
            draggingRef.current = false;
          }, 40);
          endCb.current?.();
        };

        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      };

      domEl.addEventListener('pointerdown', onPointerDown);
      cleanupHandlers.push(() => domEl.removeEventListener('pointerdown', onPointerDown));
    };

    const validLines = (guide ?? []).filter((l) => l.length >= 2);
    if (!guideInteractive || !guideCenter || validLines.length === 0) {
      for (const l of guideHitRef.current) map.removeLayer(l);
      guideHitRef.current = [];
      if (moveHandleRef.current) {
        map.removeLayer(moveHandleRef.current);
        moveHandleRef.current = null;
      }
      if (rotHandleRef.current) {
        map.removeLayer(rotHandleRef.current);
        rotHandleRef.current = null;
      }
      return;
    }

    // 히트 폴리라인 (드래그 중에는 재생성하지 않고 좌표만 갱신)
    if (guideHitRef.current.length !== validLines.length) {
      for (const l of guideHitRef.current) map.removeLayer(l);
      guideHitRef.current = validLines.map((line) =>
        L.polyline(
          line.map((p) => [p.lat, p.lng] as [number, number]),
          {
            renderer: svgRenderer,
            color: '#C8FF4D',
            weight: 30,
            opacity: 0.001,
            interactive: true,
          },
        ).addTo(map),
      );
    } else {
      validLines.forEach((line, idx) => {
        guideHitRef.current[idx].setLatLngs(line.map((p) => [p.lat, p.lng] as [number, number]));
      });
    }

    for (const hit of guideHitRef.current) {
      const pathEl = (hit as unknown as { _path?: SVGElement })._path;
      if (pathEl) attachMoveGesture(pathEl);
    }

    // 중앙 이동 핸들
    if (!moveHandleRef.current) {
      const icon = L.divIcon({
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        html: `<div title="드래그해 도안 이동" style="width:34px;height:34px;border-radius:999px;background:rgba(11,16,23,0.92);border:2px solid #C8FF4D;color:#C8FF4D;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,0.55);touch-action:none;user-select:none;">✥</div>`,
      });
      moveHandleRef.current = L.marker([guideCenter.lat, guideCenter.lng], {
        icon,
        draggable: false,
        zIndexOffset: 500,
      }).addTo(map);
    } else {
      moveHandleRef.current.setLatLng([guideCenter.lat, guideCenter.lng]);
    }
    const moveEl = moveHandleRef.current.getElement();
    if (moveEl) attachMoveGesture(moveEl);

    // 우상단 회전 핸들
    const allPts = validLines.flat();
    const b = bboxOf(allPts);
    const rotPos: LatLng = {
      lat: b.maxLat,
      lng: b.maxLng,
    };

    if (!rotHandleRef.current) {
      const rotIcon = L.divIcon({
        className: '',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        html: `<div title="드래그해 도안 회전" style="width:30px;height:30px;border-radius:999px;background:rgba(11,16,23,0.92);border:1.5px solid #5EC8FF;color:#5EC8FF;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,0.5);touch-action:none;user-select:none;">↻</div>`,
      });
      rotHandleRef.current = L.marker([rotPos.lat, rotPos.lng], {
        icon: rotIcon,
        draggable: false,
        zIndexOffset: 500,
      }).addTo(map);
    } else {
      rotHandleRef.current.setLatLng([rotPos.lat, rotPos.lng]);
    }

    const rotEl = rotHandleRef.current.getElement();
    if (rotEl) {
      rotEl.style.touchAction = 'none';
      rotEl.style.cursor = 'grab';
      const onRotDown = (e: Event) => {
        const pe = e as PointerEvent;
        if (pe.button !== undefined && pe.button !== 0) return;
        const center = guideCenterRef.current;
        if (!center) return;

        pe.stopPropagation();
        pe.preventDefault();
        draggingRef.current = true;
        map.dragging.disable();

        const rect = map.getContainer().getBoundingClientRect();
        const startLL = map.containerPointToLatLng(
          L.point(pe.clientX - rect.left, pe.clientY - rect.top),
        );
        const sXY = toXY(startLL, center);
        const startAngle = Math.atan2(sXY.x, sXY.y); // 북쪽 기준 시계방향 각도
        const origRot = guideRotRef.current;

        const onMove = (me: PointerEvent) => {
          me.preventDefault();
          const curLL = map.containerPointToLatLng(
            L.point(me.clientX - rect.left, me.clientY - rect.top),
          );
          const cXY = toXY(curLL, center);
          const curAngle = Math.atan2(cXY.x, cXY.y);
          const deltaDeg = ((curAngle - startAngle) * 180) / Math.PI;
          const nextDeg = ((Math.round(origRot + deltaDeg) % 360) + 360) % 360;
          rotCb.current?.(nextDeg);
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          map.dragging.enable();
          window.setTimeout(() => {
            draggingRef.current = false;
          }, 40);
          endCb.current?.();
        };

        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      };
      rotEl.addEventListener('pointerdown', onRotDown);
      cleanupHandlers.push(() => rotEl.removeEventListener('pointerdown', onRotDown));
    }

    return () => {
      for (const fn of cleanupHandlers) fn();
    };
  }, [guide, guideCenter, guideInteractive]);

  // 내 위치 + 동행 파트너 스프라이트
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (meRef.current) {
      map.removeLayer(meRef.current);
      meRef.current = null;
    }
    if (partnerMarkerRef.current) {
      map.removeLayer(partnerMarkerRef.current);
      partnerMarkerRef.current = null;
    }
    if (accRef.current) {
      map.removeLayer(accRef.current);
      accRef.current = null;
    }
    if (!myLoc) return;

    if (accuracy && accuracy > 8) {
      accRef.current = L.circle([myLoc.lat, myLoc.lng], {
        radius: Math.min(accuracy, 200),
        color: '#5EC8FF',
        weight: 1,
        opacity: 0.35,
        fillColor: '#5EC8FF',
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(map);
    }

    if (partnerIconUrl) {
      const icon = L.divIcon({
        className: '',
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        html: `<div style="width:38px;height:38px;border-radius:999px;background:rgba(11,16,23,0.92);border:2px solid #C8FF4D;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,0.55);"><img src="${partnerIconUrl}" alt="" style="width:26px;height:26px;image-rendering:pixelated;" /></div>`,
      });
      partnerMarkerRef.current = L.marker([myLoc.lat, myLoc.lng], {
        icon,
        interactive: false,
        zIndexOffset: 650,
      }).addTo(map);
    } else {
      meRef.current = L.circleMarker([myLoc.lat, myLoc.lng], {
        radius: 7,
        color: '#0B1017',
        weight: 3,
        fillColor: '#5EC8FF',
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    }
  }, [myLoc, accuracy, partnerIconUrl]);

  return (
    <div className="absolute inset-0 z-0">
      <div ref={elRef} className="absolute inset-0 z-0" />
      {mapDrawMode && (
        <canvas
          ref={drawCanvasRef}
          onPointerDown={handleMapDrawDown}
          onPointerMove={handleMapDrawMove}
          onPointerUp={handleMapDrawUp}
          onPointerCancel={handleMapDrawUp}
          className="absolute inset-0 z-10 h-full w-full cursor-crosshair touch-none"
        />
      )}
    </div>
  );
});

export default MapView;
