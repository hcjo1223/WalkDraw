import L from 'leaflet';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { softenLatLngSegments, type LatLng, type PathPoint } from '../lib/geo';

const TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  voyager: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
};

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';

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
  myLoc: LatLng | null;
  accuracy: number | null;
  tile: 'dark' | 'voyager';
  onMapClick: (ll: LatLng) => void;
  onCenterChange: (ll: LatLng) => void;
};

const MapView = forwardRef<MapHandle, Props>(function MapView(
  { points, color, width, guide, myLoc, accuracy, tile, onMapClick, onCenterChange },
  ref,
) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const auraRef = useRef<L.Polyline | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const guideRef = useRef<L.Polyline[]>([]);
  const meRef = useRef<L.CircleMarker | null>(null);
  const accRef = useRef<L.Circle | null>(null);
  const clickCb = useRef(onMapClick);
  const centerCb = useRef(onCenterChange);
  clickCb.current = onMapClick;
  centerCb.current = onCenterChange;

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

    map.attributionControl.setPrefix(false);
    map.on('click', (e: L.LeafletMouseEvent) => {
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
      tileRef.current = null;
      auraRef.current = null;
      lineRef.current = null;
      guideRef.current = [];
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
      map.fitBounds(b, { padding: [48, 48], maxZoom: 18 });
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

  // 도안 가이드
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const layer of guideRef.current) map.removeLayer(layer);
    guideRef.current = [];
    if (!guide) return;

    for (const line of guide) {
      if (line.length < 2) continue;
      const latlngs = line.map((p) => [p.lat, p.lng] as [number, number]);
      guideRef.current.push(
        L.polyline(latlngs, {
          color: '#9DB3C8',
          weight: 3,
          opacity: 0.75,
          dashArray: '1 9',
          lineCap: 'round',
          interactive: false,
        }).addTo(map),
      );
    }
  }, [guide]);

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
