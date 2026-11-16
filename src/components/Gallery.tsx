import { useEffect, useRef } from 'react';
import { formatDateTime, formatDistance, formatDuration, type Walk } from '../lib/geo';
import { drawPoster, makeGeometry } from '../lib/poster';

function Thumb({ walk, width = 54 }: { walk: Walk; width?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const height = Math.round((width * 1350) / 1080);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawPoster(ctx, makeGeometry(walk, w, h, 'thumb'), { progress: 1, showText: false });
  }, [walk, width, height]);

  return (
    <canvas
      ref={ref}
      className="block rounded-lg"
      style={{ width, height }}
    />
  );
}

type Props = {
  walks: Walk[];
  onOpen: (walk: Walk) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export default function Gallery({ walks, onOpen, onDelete, onClose }: Props) {
  return (
    <div className="fade-up absolute inset-0 z-40 flex flex-col bg-[#070A0F]">
      <div className="flex items-center justify-between border-b border-white/8 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-zinc-300 active:scale-95"
          aria-label="닫기"
        >
          ✕
        </button>
        <div className="text-sm font-semibold text-zinc-100">내 그림 갤러리</div>
        <div className="w-10 text-right text-xs text-zinc-500">{walks.length}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {walks.length === 0 ? (
          <div className="mt-24 text-center">
            <div className="text-4xl">🖼️</div>
            <p className="mt-3 text-sm text-zinc-400">
              아직 저장한 그림이 없어요.
              <br />
              산책을 마치면 자동으로 여기에 담깁니다.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {walks.map((walk) => (
              <li key={walk.id} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-2.5">
                <button onClick={() => onOpen(walk)} className="shrink-0" aria-label={`${walk.title} 열기`}>
                  <Thumb walk={walk} />
                </button>
                <button onClick={() => onOpen(walk)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-semibold text-zinc-100">{walk.title}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{formatDateTime(walk.createdAt)}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <span className="font-semibold text-zinc-300">{formatDistance(walk.distanceM)}</span>
                    <span className="text-zinc-600">·</span>
                    <span>{formatDuration(walk.durationMs)}</span>
                  </div>
                </button>
                <button
                  onClick={() => {
                    if (window.confirm('이 그림을 삭제할까요? 되돌릴 수 없어요.')) onDelete(walk.id);
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-white/5"
                  aria-label="삭제"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
