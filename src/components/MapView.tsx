import L from 'leaflet';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { bboxOf, softenLatLngSegments, toXY, type LatLng, type PathPoint } from '../lib/geo';
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
  fit: (lls: LatLng[]) => void;
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
  activeNavPoint: LatLng | null;
  myLoc: LatLng | null;
  accuracy: number | null;
  tile: 'dark' | 'voyager';
  onMapClick: (ll: LatLng) => void;
  onCenterChange: (ll: LatLng) => void;
  onGuideMove?: (ll: LatLng) => void;
  onGuideRotate?: (deg: number) => void;
  onGuideTransformEnd?: () => void;
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
    activeNavPoint,
    myLoc,
    accuracy,
    tile,
    onMapClick,
    onCenterChange,
    onGuideMove,
    onGuideRotate,
    onGuideTransformEnd,
  },
  ref,
) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const svgRendererRef = useRef<L.SVG | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const auraRef = useRef<L.Polyline | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const guideRef = useRef<L.Polyline[]>([]);
  const guideHitRef = useRef<L.Polyline[]>([]);
  const moveHandleRef = useRef<L.Marker | null>(null);
  const rotHandleRef = useRef<L.Marker | null>(null);
  const routeLayersRef = useRef<L.Layer[]>([]);
  const navTurnRef = useRef<L.CircleMarker | null>(null);
  const meRef = useRef<L.CircleMarker | null>(null);
  const accRef = useRef<L.Circle | null>(null);

  const clickCb = useRef(onMapClick);
  const centerCb = useRef(onCenterChange);
  const moveCb = useRef(onGuideMove);
  const rotCb = useRef(onGuideRotate);
  const endCb = useRef(onGuideTransformEnd);
  const guideCenterRef = useRef(guideCenter);
  const guideRotRef = useRef(guideRot);
  const draggingRef = useRef(false);

  clickCb.current = onMapClick;
  centerCb.current = onCenterChange;
  moveCb.current = onGuideMove;
  rotCb.current = onGuideRotate;
  endCb.current = onGuideTransformEnd;
  guideCenterRef.current = guideCenter;
  guideRotRef.current = guideRot;

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
      if (draggingRef.current) return;
      clickCb.current({ lat: e.latlng.lat, lng: e.latlng.lng });
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
      routeLayersRef.current = [];
      navTurnRef.current = null;
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
    fit: (lls) => {
      const map = mapRef.current;
      if (!map || lls.length === 0) return;
      const b = L.latLngBounds(lls.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(b, { padding: [54, 54], maxZoom: 18 });
    },
  }));

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

  // 내 위치
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (meRef.current) {
      map.removeLayer(meRef.current);
      meRef.current = null;
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
    meRef.current = L.circleMarker([myLoc.lat, myLoc.lng], {
      radius: 7,
      color: '#0B1017',
      weight: 3,
      fillColor: '#5EC8FF',
      fillOpacity: 1,
      interactive: false,
    }).addTo(map);
  }, [myLoc, accuracy]);

  return <div ref={elRef} className="absolute inset-0 z-0" />;
});

export default MapView;
