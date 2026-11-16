import { useEffect, useRef, useState } from 'react';
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatPace,
  type Walk,
} from '../lib/geo';
import { downloadBlob, shareBlob, stampName } from '../lib/download';
import { drawPoster, makeGeometry, POSTER_H, POSTER_W, renderPosterBlob, type PosterGeom } from '../lib/poster';

type Props = {
  walk: Walk;
  onClose: () => void;
  onTitleChange: (id: string, title: string) => void;
  onToast: (msg: string) => void;
  isFresh?: boolean;
};

type Tab = 'card' | 'timelapse';

export default function CardView({ walk, onClose, onTitleChange, onToast, isFresh }: Props) {
  const [tab, setTab] = useState<Tab>('card');
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(walk.title);
  const [boxW, setBoxW] = useState(0);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => setTitle(walk.title), [walk.id, walk.title]);

  // 카드 영역 너비 측정
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setBoxW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const canvasW = Math.round(boxW);
  const canvasH = Math.round((boxW * POSTER_H) / POSTER_W);

  // 도형은 (경로, 제목, 캔버스 크기) 단위로 캐시 — 타임랩스 프레임마다 다시 계산하지 않는다
  const cacheRef = useRef<{ key: string; geom: PosterGeom } | null>(null);
  const getGeom = (w: number, h: number): PosterGeom => {
    const key = `${walk.id}:${walk.title}:${w}x${h}:${walk.color}:${walk.width}`;
    if (cacheRef.current && cacheRef.current.key === key) return cacheRef.current.geom;
    const g = makeGeometry(walk, w, h, 'card');
    cacheRef.current = { key, geom: g };
    return g;
  };

  // 그리기
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasW < 40) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = Math.round(canvasW * dpr);
    const h = Math.round(canvasH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawPoster(ctx, getGeom(w, h), { progress, showText: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, walk, canvasW, canvasH]);

  // 타임랩스 재생
  useEffect(() => {
    if (tab !== 'timelapse' || !playing) return;
    let raf = 0;
    let start = 0;
    const duration = 5600 / speed;
    setProgress(0);
    const tick = (now: number) => {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / duration);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, tab]);

  useEffect(() => {
    if (tab === 'card') {
      setProgress(1);
      setPlaying(false);
    } else {
      setProgress(0);
      setPlaying(true);
    }
  }, [tab]);

  useEffect(() => {
    onTitleChange(walk.id, title || '나의 발자취');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const aspect = { width: '100%', height: '100%' } as const;

  async function handleSave() {
    setBusy(true);
    try {
      const blob = await renderPosterBlob({ ...walk, title: title || '나의 발자취' });
      if (!blob) throw new Error('render-failed');
      downloadBlob(blob, stampName('walkdraw', walk.createdAt));
      onToast('PNG 카드를 저장했어요. 사진 앨범에서 확인하세요.');
    } catch {
      onToast('이미지 저장에 실패했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    setBusy(true);
    try {
      const blob = await renderPosterBlob({ ...walk, title: title || '나의 발자취' });
      if (!blob) throw new Error('render-failed');
      const ok = await shareBlob(blob, stampName('walkdraw', walk.createdAt), title || 'WalkDraw');
      if (!ok) {
        downloadBlob(blob, stampName('walkdraw', walk.createdAt));
        onToast('공유를 지원하지 않아 PNG로 내려받았어요.');
      }
    } catch {
      onToast('공유에 실패했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-up absolute inset-0 z-40 flex flex-col bg-[#070A0F]">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-zinc-300 active:scale-95"
          aria-label="닫기"
        >
          ✕
        </button>
        <div className="text-center">
          <div className="text-[11px] font-semibold tracking-[0.22em] text-zinc-500">WALK DRAW</div>
          <div className="text-sm font-semibold text-zinc-100">
            {isFresh ? '그림 카드가 완성됐어요' : '저장한 그림'}
          </div>
        </div>
        <div className="h-10 w-10" />
      </div>

      <div className="flex justify-center px-4">
        <div className="flex rounded-full border border-white/10 bg-white/5 p-1 text-[13px]">
          {(
            [
              ['card', '포스터 카드'],
              ['timelapse', '타임랩스'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-full px-4 py-1.5 font-semibold transition ${
                tab === key ? 'bg-lime text-[#0B1015]' : 'text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div ref={wrapRef} className="mx-auto w-full max-w-[420px]">
          <div
            className="relative overflow-hidden rounded-[22px] border border-white/10 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]"
            style={{ aspectRatio: `${POSTER_W} / ${POSTER_H}` }}
          >
            <canvas ref={canvasRef} className="block" style={aspect} />
          </div>
        </div>

        {tab === 'timelapse' && (
          <div className="mx-auto mt-4 w-full max-w-[420px]">
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-lime transition-[width] duration-75"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (progress >= 1) setProgress(0);
                    setPlaying((p) => !p);
                  }}
                  className="flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-zinc-100 active:scale-95"
                >
                  {playing ? '⏸ 일시정지' : '▶ 재생'}
                </button>
                <span className="text-xs tabular-nums text-zinc-500">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="flex gap-1 rounded-full bg-white/5 p-1 text-xs">
                {[0.7, 1, 1.6].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={`rounded-full px-2.5 py-1 font-semibold ${
                      speed === s ? 'bg-white/15 text-white' : 'text-zinc-400'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mx-auto mt-5 w-full max-w-[420px]">
          <label className="mb-1 block text-[11px] font-semibold tracking-wide text-zinc-500">
            제목
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 24))}
            placeholder="예: 퇴근길 하트 산책"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-lime/50"
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-400">
            <span>{formatDate(walk.createdAt)}</span>
            <span className="text-zinc-600">·</span>
            <span className="font-semibold text-zinc-200">{formatDistance(walk.distanceM)}</span>
            <span className="text-zinc-600">·</span>
            <span>{formatDuration(walk.durationMs)}</span>
            <span className="text-zinc-600">·</span>
            <span>{formatPace(walk.distanceM, walk.durationMs)}/km</span>
          </div>
        </div>
      </div>

      <div className="border-t border-white/8 bg-[#080C11] px-4 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex w-full max-w-[420px] gap-2">
          <button
            onClick={handleSave}
            disabled={busy}
            className="flex-1 rounded-2xl bg-lime py-3.5 text-sm font-bold text-[#0B1015] disabled:opacity-60 active:scale-[0.99]"
          >
            PNG 저장
          </button>
          <button
            onClick={handleShare}
            disabled={busy}
            className="flex-1 rounded-2xl border border-white/12 bg-white/5 py-3.5 text-sm font-semibold text-zinc-100 disabled:opacity-60 active:scale-[0.99]"
          >
            공유
          </button>
        </div>
      </div>
    </div>
  );
}
