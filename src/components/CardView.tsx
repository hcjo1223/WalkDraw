import { useEffect, useRef, useState } from 'react';
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatPace,
  type Walk,
} from '../lib/geo';
import { downloadBlob, shareBlob, stampName } from '../lib/download';
import {
  POSTER_H,
  POSTER_THEMES,
  POSTER_W,
  drawPoster,
  makeGeometry,
  renderPosterBlob,
  type PosterGeom,
  type PosterSticker,
} from '../lib/poster';

type Props = {
  walk: Walk;
  onClose: () => void;
  onTitleChange: (id: string, title: string) => void;
  onToast: (msg: string) => void;
  isFresh?: boolean;
};

type Tab = 'card' | 'timelapse' | 'studio';

const STICKER_SET = ['🐾', '💚', '🔥', '⭐', '🏃', '✨', '🌈', '☕'];

export default function CardView({ walk, onClose, onTitleChange, onToast, isFresh }: Props) {
  const [tab, setTab] = useState<Tab>('card');
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [title, setTitle] = useState(walk.title);
  const [boxW, setBoxW] = useState(0);

  // 스튜디오 커스터마이징
  const [themeId, setThemeId] = useState('ink');
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [bgDim, setBgDim] = useState(0.5);
  const [stickers, setStickers] = useState<PosterSticker[]>([]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setTitle(walk.title), [walk.id, walk.title]);

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

  const cacheRef = useRef<{ key: string; geom: PosterGeom } | null>(null);
  const getGeom = (w: number, h: number): PosterGeom => {
    const key = `${walk.id}:${walk.title}:${w}x${h}:${walk.color}:${walk.width}`;
    if (cacheRef.current && cacheRef.current.key === key) return cacheRef.current.geom;
    const g = makeGeometry(walk, w, h, 'card');
    cacheRef.current = { key, geom: g };
    return g;
  };

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
    drawPoster(ctx, getGeom(w, h), {
      progress,
      showText: true,
      themeId,
      bgImage,
      bgDim,
      stickers,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, walk, canvasW, canvasH, themeId, bgImage, bgDim, stickers]);

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
    if (tab === 'timelapse') {
      setProgress(0);
      setPlaying(true);
    } else {
      setProgress(1);
      setPlaying(false);
    }
  }, [tab]);

  useEffect(() => {
    onTitleChange(walk.id, title || '나의 발자취');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const aspect = { width: '100%', height: '100%' } as const;

  const styledWalk = { ...walk, title: title || '나의 발자취' };

  async function handleSave() {
    setBusy(true);
    try {
      const blob = await renderPosterBlob(styledWalk, {
        themeId,
        bgImage,
        bgDim,
        stickers,
      });
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
      const blob = await renderPosterBlob(styledWalk, {
        themeId,
        bgImage,
        bgDim,
        stickers,
      });
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

  async function handleExportVideo() {
    if (typeof MediaRecorder === 'undefined') {
      onToast('이 브라우저는 영상 녹화를 지원하지 않아요. PNG 저장을 이용해 주세요.');
      return;
    }
    setRecordingVideo(true);
    onToast('타임랩스 영상을 생성하는 중… (약 4초)');
    try {
      const W = 720;
      const H = 900;
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const ctx = off.getContext('2d');
      if (!ctx || !('captureStream' in off)) throw new Error('no-stream');

      const geom = makeGeometry(styledWalk, W, H, 'card');
      const mime = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm';
      const stream = off.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_500_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };

      const done = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
      });

      rec.start();
      const totalMs = 3600;
      const holdMs = 700;
      const startTs = performance.now();

      await new Promise<void>((resolve) => {
        const step = (ts: number) => {
          const dt = ts - startTs;
          const p = Math.min(1, dt / totalMs);
          drawPoster(ctx, geom, {
            progress: p,
            showText: true,
            themeId,
            bgImage,
            bgDim,
            stickers,
          });
          if (dt < totalMs + holdMs) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });

      rec.stop();
      const videoBlob = await done;
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(videoBlob, stampName('walkdraw-timelapse', walk.createdAt, ext));
      onToast('타임랩스 영상을 저장했어요!');
    } catch {
      onToast('영상 생성에 실패했어요. PNG 저장을 이용해 주세요.');
    } finally {
      setRecordingVideo(false);
    }
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tab !== 'studio' || stickers.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = Math.max(0.1, Math.min(0.9, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0.12, Math.min(0.88, (e.clientY - rect.top) / rect.height));
    setStickers((prev) => {
      const next = prev.slice();
      next[next.length - 1] = { ...next[next.length - 1], x: nx, y: ny };
      return next;
    });
  };

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
            {isFresh ? '그림 카드가 완성됐어요' : '카드 스튜디오'}
          </div>
        </div>
        <div className="h-10 w-10" />
      </div>

      <div className="flex justify-center px-4">
        <div className="flex rounded-full border border-white/10 bg-white/5 p-1 text-[12px]">
          {(
            [
              ['card', '포스터 카드'],
              ['studio', '배경·스티커'],
              ['timelapse', '타임랩스'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-full px-3.5 py-1.5 font-semibold transition ${
                tab === key ? 'bg-lime text-[#0B1015]' : 'text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div ref={wrapRef} className="mx-auto w-full max-w-[380px]">
          <div
            className="relative overflow-hidden rounded-[22px] border border-white/10 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]"
            style={{ aspectRatio: `${POSTER_W} / ${POSTER_H}` }}
          >
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="block"
              style={aspect}
            />
          </div>
        </div>

        {tab === 'studio' && (
          <div className="mx-auto mt-4 w-full max-w-[380px] space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <div>
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-zinc-400">
                <span>배경 색상 · 내 사진</span>
                {bgImage && (
                  <button
                    onClick={() => setBgImage(null)}
                    className="text-rose"
                  >
                    사진 빼기
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto scroll-x pb-1">
                <input
                  ref={bgInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const img = new Image();
                    img.onload = () => setBgImage(img);
                    img.src = URL.createObjectURL(f);
                  }}
                />
                <button
                  onClick={() => bgInputRef.current?.click()}
                  className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 text-[11px] font-semibold text-zinc-200"
                >
                  📷 사진
                </button>
                {POSTER_THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setBgImage(null);
                      setThemeId(t.id);
                    }}
                    title={t.label}
                    style={{ background: `linear-gradient(135deg, ${t.top}, ${t.bot})` }}
                    className={`h-8 w-8 shrink-0 rounded-full border ${
                      !bgImage && themeId === t.id
                        ? 'border-lime ring-2 ring-lime/40'
                        : 'border-white/20'
                    }`}
                  />
                ))}
              </div>
              {bgImage && (
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>배경 어둡기</span>
                    <span>{Math.round(bgDim * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.15}
                    max={0.85}
                    step={0.05}
                    value={bgDim}
                    onChange={(e) => setBgDim(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-zinc-400">
                <span>스티커 추가 (추가 후 카드 터치로 위치 이동)</span>
                {stickers.length > 0 && (
                  <button
                    onClick={() => setStickers([])}
                    className="text-zinc-500"
                  >
                    전체 삭제
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 overflow-x-auto scroll-x">
                {STICKER_SET.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() =>
                      setStickers((prev) => [
                        ...prev.slice(-7),
                        {
                          id: `${Date.now()}_${Math.random()}`,
                          emoji,
                          x: 0.78 - (prev.length % 3) * 0.14,
                          y: 0.26 + Math.floor(prev.length / 3) * 0.12,
                        },
                      ])
                    }
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-lg active:scale-90"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'timelapse' && (
          <div className="mx-auto mt-4 w-full max-w-[380px]">
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

        <div className="mx-auto mt-4 w-full max-w-[380px]">
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
        <div className="mx-auto flex w-full max-w-[380px] gap-2">
          <button
            onClick={handleSave}
            disabled={busy || recordingVideo}
            className="flex-1 rounded-2xl bg-lime py-3.5 text-xs font-extrabold text-[#0B1015] disabled:opacity-60 active:scale-[0.99]"
          >
            PNG 저장
          </button>
          <button
            onClick={handleExportVideo}
            disabled={busy || recordingVideo}
            className="flex-1 rounded-2xl border border-sky/35 bg-sky/12 py-3.5 text-xs font-bold text-sky disabled:opacity-60 active:scale-[0.99]"
          >
            {recordingVideo ? '녹화 중…' : '🎬 영상 저장'}
          </button>
          <button
            onClick={handleShare}
            disabled={busy || recordingVideo}
            className="rounded-2xl border border-white/12 bg-white/5 px-4 py-3.5 text-xs font-semibold text-zinc-100 disabled:opacity-60 active:scale-[0.99]"
          >
            공유
          </button>
        </div>
      </div>
    </div>
  );
}
