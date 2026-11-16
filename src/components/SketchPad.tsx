import { useCallback, useEffect, useRef, useState } from 'react';
import type { XY } from '../lib/geo';

type Props = {
  onComplete: (normStrokes: XY[][]) => void;
  onCancel: () => void;
};

type CanvasStroke = XY[];

function normalizeCanvasStrokes(strokes: CanvasStroke[], w: number, h: number): XY[][] {
  const valid = strokes.filter((s) => s.length >= 2);
  if (valid.length === 0) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of valid) {
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const span = Math.max(maxX - minX, maxY - minY, Math.min(w, h) * 0.12);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const k = 2 / span;

  return valid.map((s) =>
    s
      .filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) >= 4)
      .map((p) => ({
        x: (p.x - cx) * k,
        // 캔버스 y는 아래로 증가하므로 북쪽(+y) 기준으로 반전
        y: -(p.y - cy) * k,
      })),
  );
}

const QUICK_SKETCHES: Record<string, XY[][]> = {
  고양이: [
    [
      { x: -0.7, y: 0.35 },
      { x: -0.62, y: 0.92 },
      { x: -0.25, y: 0.55 },
      { x: 0.25, y: 0.55 },
      { x: 0.62, y: 0.92 },
      { x: 0.7, y: 0.35 },
      { x: 0.84, y: -0.2 },
      { x: 0.45, y: -0.76 },
      { x: -0.45, y: -0.76 },
      { x: -0.84, y: -0.2 },
      { x: -0.7, y: 0.35 },
    ],
  ],
  달: [
    [
      { x: 0.25, y: 0.92 },
      { x: -0.28, y: 0.72 },
      { x: -0.6, y: 0.28 },
      { x: -0.62, y: -0.3 },
      { x: -0.25, y: -0.76 },
      { x: 0.35, y: -0.92 },
      { x: 0.05, y: -0.52 },
      { x: -0.05, y: 0.0 },
      { x: 0.08, y: 0.52 },
      { x: 0.25, y: 0.92 },
    ],
  ],
};

export default function SketchPad({ onComplete, onCancel }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [strokes, setStrokes] = useState<CanvasStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<CanvasStroke | null>(null);
  const [bgImgUrl, setBgImgUrl] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  const drawingRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // 점선 격자 배경 (발로그린그림 스타일)
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    const gap = 22;
    for (let x = gap / 2; x < size.w; x += gap) {
      for (let y = gap / 2; y < size.h; y += gap) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const all = activeStroke ? [...strokes, activeStroke] : strokes;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of all) {
      if (s.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
      ctx.strokeStyle = 'rgba(200, 255, 77, 0.25)';
      ctx.lineWidth = 10;
      ctx.stroke();

      ctx.strokeStyle = '#C8FF4D';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }, [strokes, activeStroke, size]);

  const toLocal = useCallback((e: React.PointerEvent<HTMLCanvasElement>): XY => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    setActiveStroke([toLocal(e)]);
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const p = toLocal(e);
    setActiveStroke((prev) => {
      if (!prev) return [p];
      const last = prev[prev.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 3) return prev;
      return [...prev, p];
    });
  };

  const handleUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setActiveStroke((cur) => {
      if (cur && cur.length >= 2) {
        setStrokes((prev) => [...prev, cur]);
      }
      return null;
    });
  };

  const loadTemplate = (key: string) => {
    const norm = QUICK_SKETCHES[key];
    if (!norm) return;
    const s = Math.min(size.w, size.h) * 0.34;
    const cx = size.w / 2;
    const cy = size.h / 2;
    setStrokes(
      norm.map((sp) =>
        sp.map((p) => ({
          x: cx + p.x * s,
          y: cy - p.y * s,
        })),
      ),
    );
  };

  const handleFinish = () => {
    const norm = normalizeCanvasStrokes(strokes, size.w, size.h);
    if (norm.length === 0) return;
    onComplete(norm);
  };

  return (
    <div className="fade-up fixed inset-0 z-50 flex flex-col bg-[#070A0F]">
      {/* 상단 바 */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <button
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-sm font-semibold text-zinc-400 active:bg-white/5"
        >
          취소
        </button>
        <div className="text-center">
          <div className="text-sm font-extrabold text-white">자유 그림 스케치</div>
          <div className="text-[10px] text-zinc-400">손가락으로 대충 그려도 길에 맞춰줘요</div>
        </div>
        <button
          onClick={handleFinish}
          disabled={strokes.length === 0}
          className={`rounded-full px-4 py-1.5 text-sm font-extrabold transition ${
            strokes.length > 0
              ? 'bg-lime text-[#0B1015] active:scale-95'
              : 'bg-white/10 text-zinc-500'
          }`}
        >
          완료
        </button>
      </div>

      {/* 빠른 도안 샘플 칩 */}
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2">
        <span className="text-[11px] text-zinc-500">빠른 밑그림</span>
        {Object.keys(QUICK_SKETCHES).map((k) => (
          <button
            key={k}
            onClick={() => loadTemplate(k)}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-zinc-200 active:scale-95"
          >
            {k === '고양이' ? '🐱 고양이' : '🌙 초승달'}
          </button>
        ))}
      </div>

      {/* 캔버스 영역 */}
      <div ref={wrapRef} className="relative flex-1 overflow-hidden bg-[#0B1017]">
        {bgImgUrl && (
          <img
            src={bgImgUrl}
            alt="밑그림 사진"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-30"
          />
        )}
        <canvas
          ref={canvasRef}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
          className="absolute inset-0 h-full w-full touch-none"
        />
        {strokes.length === 0 && !activeStroke && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="text-3xl opacity-70">✏️</div>
            <p className="mt-2 text-xs text-zinc-400">
              여기에 원하는 모양을 그려 보세요
              <br />
              예: 하트, 고양이, 강아지, 이니셜
            </p>
          </div>
        )}
      </div>

      {/* 하단 툴바 */}
      <div className="flex items-center justify-around border-t border-white/10 bg-[#0A0F16] px-4 py-3 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = URL.createObjectURL(f);
            setBgImgUrl(url);
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs font-semibold text-zinc-200 active:scale-95"
        >
          🖼 사진 깔기
        </button>
        <button
          onClick={() => setStrokes((s) => s.slice(0, -1))}
          disabled={strokes.length === 0}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs font-semibold text-zinc-200 disabled:opacity-40 active:scale-95"
        >
          ↩ 되돌리기
        </button>
        <button
          onClick={() => {
            setStrokes([]);
            setBgImgUrl(null);
          }}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs font-semibold text-zinc-300 active:scale-95"
        >
          🗑 지우기
        </button>
      </div>
    </div>
  );
}
