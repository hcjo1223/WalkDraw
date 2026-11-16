import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPace,
  smoothGeometry,
  type Walk,
} from '../lib/geo';
import { downloadBlob, stampName } from '../lib/download';
import { POSTER_THEMES, drawPoster, makeGeometry } from '../lib/poster';
import type { SavedRoute } from '../lib/storage';

type Props = {
  walks: Walk[];
  savedRoutes: SavedRoute[];
  onOpenWalk: (w: Walk) => void;
  onDeleteWalk: (id: string) => void;
  onStartSavedRoute: (r: SavedRoute) => void;
  onDeleteSavedRoute: (id: string) => void;
  onToast: (msg: string) => void;
};

type SubTab = 'calendar' | 'stats' | 'saved';

function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function MiniWalkThumb({ walk, size = 36 }: { walk: Walk; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawPoster(ctx, makeGeometry(walk, c.width, c.height, 'thumb'), {
      progress: 1,
      showText: false,
    });
  }, [walk, size]);
  return <canvas ref={ref} className="rounded-md" style={{ width: size, height: size }} />;
}

/** 월말정산 1080x1350 달력 포스터 모달 */
function MonthlySettlementModal({
  year,
  month,
  walks,
  onClose,
  onToast,
}: {
  year: number;
  month: number; // 0-indexed
  walks: Walk[];
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const [themeId, setThemeId] = useState('ink');
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [showStats, setShowStats] = useState(true);

  const monthWalks = useMemo(
    () =>
      walks.filter((w) => {
        const d = new Date(w.createdAt);
        return d.getFullYear() === year && d.getMonth() === month;
      }),
    [walks, year, month],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 1080;
    const H = 1350;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const theme = POSTER_THEMES.find((t) => t.id === themeId) ?? POSTER_THEMES[0];
    const isLight = Boolean(theme.light && !bgImage);

    if (bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
      const scale = Math.max(W / bgImage.naturalWidth, H / bgImage.naturalHeight);
      const dw = bgImage.naturalWidth * scale;
      const dh = bgImage.naturalHeight * scale;
      ctx.drawImage(bgImage, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.fillStyle = 'rgba(7,10,15,0.58)';
      ctx.fillRect(0, 0, W, H);
    } else {
      const grad = ctx.createLinearGradient(0, 0, W * 0.3, H);
      grad.addColorStop(0, theme.top);
      grad.addColorStop(0.55, theme.mid);
      grad.addColorStop(1, theme.bot);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    const mainTxt = isLight ? '#0F172A' : '#F8FAFC';
    const subTxt = isLight ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.5)';
    const cellBg = isLight ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.04)';
    const FONT = 'system-ui, "Apple SD Gothic Neo", Pretendard, "Noto Sans KR", sans-serif';

    ctx.fillStyle = subTxt;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText('WALK DRAW · 월말정산', 84, 96);

    ctx.fillStyle = mainTxt;
    ctx.font = `800 68px ${FONT}`;
    ctx.fillText(`${year}. ${String(month + 1).padStart(2, '0')}`, 84, 178);

    const totalDist = monthWalks.reduce((a, w) => a + w.distanceM, 0);
    const totalMs = monthWalks.reduce((a, w) => a + w.durationMs, 0);
    if (showStats) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#C8FF4D';
      ctx.font = `800 44px ${FONT}`;
      ctx.fillText(formatDistance(totalDist), W - 84, 152);
      ctx.fillStyle = subTxt;
      ctx.font = `600 26px ${FONT}`;
      ctx.fillText(`${monthWalks.length}회 · ${formatDuration(totalMs)}`, W - 84, 192);
      ctx.textAlign = 'left';
    }

    // 달력 그리드
    const byDay = new Map<number, Walk>();
    for (const w of monthWalks) {
      const day = new Date(w.createdAt).getDate();
      const prev = byDay.get(day);
      if (!prev || w.distanceM > prev.distanceM) byDay.set(day, w);
    }

    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const padX = 76;
    const gridW = W - padX * 2;
    const colW = gridW / 7;
    const startY = 260;

    const dows = ['일', '월', '화', '수', '목', '금', '토'];
    ctx.font = `700 24px ${FONT}`;
    ctx.textAlign = 'center';
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = i === 0 ? '#FF8FA3' : subTxt;
      ctx.fillText(dows[i], padX + colW * (i + 0.5), startY);
    }

    const rows = Math.ceil((firstDow + daysInMonth) / 7);
    const cellH = Math.min(155, Math.floor(920 / rows));

    for (let day = 1; day <= daysInMonth; day++) {
      const idx = firstDow + day - 1;
      const col = idx % 7;
      const row = Math.floor(idx / 7);
      const x = padX + col * colW + 6;
      const y = startY + 26 + row * cellH + 6;
      const w = colW - 12;
      const h = cellH - 12;

      ctx.fillStyle = cellBg;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 18);
      ctx.fill();

      ctx.fillStyle = subTxt;
      ctx.font = `600 20px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(String(day), x + 12, y + 26);

      const walk = byDay.get(day);
      if (walk) {
        const { segments } = smoothGeometry(walk.points);
        const flat = segments.flat();
        if (flat.length > 1) {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const p of flat) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          }
          const spanX = Math.max(maxX - minX, 10);
          const spanY = Math.max(maxY - minY, 10);
          const boxW = w - 24;
          const boxH = h - 42;
          const sc = Math.min(boxW / spanX, boxH / spanY);
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const ox = x + w / 2;
          const oy = y + 32 + boxH / 2;

          ctx.save();
          ctx.strokeStyle = isLight && walk.color.toUpperCase() === '#F2F5F9' ? '#16A34A' : walk.color;
          ctx.lineWidth = 4.5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const seg of segments) {
            if (seg.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(ox + (seg[0].x - cx) * sc, oy - (seg[0].y - cy) * sc);
            for (let i = 1; i < seg.length; i++) {
              ctx.lineTo(ox + (seg[i].x - cx) * sc, oy - (seg[i].y - cy) * sc);
            }
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = subTxt;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText('WalkDraw · 나의 한 달 발자취', W - 84, H - 56);
  }, [year, month, monthWalks, themeId, bgImage, showStats]);

  const handleSave = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, stampName(`walkdraw-${year}-${month + 1}`, Date.now()));
      onToast('월말정산 달력 카드를 저장했어요!');
    }, 'image/png', 0.95);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#070A0F]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <button onClick={onClose} className="rounded-full px-3 py-1 text-sm text-zinc-400">
          닫기
        </button>
        <div className="text-sm font-extrabold text-white">월말정산 카드</div>
        <button
          onClick={handleSave}
          className="rounded-full bg-lime px-4 py-1.5 text-xs font-extrabold text-[#0B1015]"
        >
          PNG 저장
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-[360px] overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
          <canvas ref={canvasRef} className="block w-full" style={{ aspectRatio: '4 / 5' }} />
        </div>

        <div className="mx-auto mt-4 max-w-[360px] space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2 overflow-x-auto scroll-x">
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
              className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-zinc-200"
            >
              📷 내 사진
            </button>
            {POSTER_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setBgImage(null);
                  setThemeId(t.id);
                }}
                style={{ background: `linear-gradient(135deg, ${t.top}, ${t.bot})` }}
                className={`h-7 w-7 shrink-0 rounded-full border ${
                  !bgImage && themeId === t.id ? 'border-lime ring-2 ring-lime/40' : 'border-white/20'
                }`}
              />
            ))}
          </div>
          <label className="flex items-center justify-between text-xs text-zinc-300">
            <span>이달 총 거리·횟수 표시</span>
            <input
              type="checkbox"
              checked={showStats}
              onChange={(e) => setShowStats(e.target.checked)}
              className="accent-lime"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

/** 나의 발자취 재생(리플레이) 모달 */
function WalkReplayModal({ walk, onClose }: { walk: Walk; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let start = 0;
    const dur = 4200;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / dur);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = 720;
    c.height = 900;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawPoster(ctx, makeGeometry(walk, 720, 900, 'card'), { progress, showText: true });
  }, [walk, progress]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-white/12 bg-[#0B1017] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-bold text-white">{walk.title} · 경로 재생</div>
          <button onClick={onClose} className="text-sm text-zinc-400">
            ✕
          </button>
        </div>
        <canvas ref={canvasRef} className="w-full rounded-2xl border border-white/10" />
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => {
              setProgress(0);
              setPlaying(true);
            }}
            className="rounded-full bg-lime px-4 py-1.5 text-xs font-extrabold text-[#0B1015]"
          >
            {playing ? '재생 중…' : '↻ 다시 재생'}
          </button>
          <span className="text-xs tabular-nums text-zinc-400">
            {Math.round(progress * 100)}% · {formatDistance(walk.distanceM * progress)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function RecordsView({
  walks,
  savedRoutes,
  onOpenWalk,
  onDeleteWalk,
  onStartSavedRoute,
  onDeleteSavedRoute,
  onToast,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('calendar');
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showSettlement, setShowSettlement] = useState(false);
  const [replayWalk, setReplayWalk] = useState<Walk | null>(null);

  const walksByDate = useMemo(() => {
    const map = new Map<string, Walk[]>();
    for (const w of walks) {
      const k = dateKey(w.createdAt);
      const arr = map.get(k) ?? [];
      arr.push(w);
      map.set(k, arr);
    }
    return map;
  }, [walks]);

  const monthWalks = useMemo(
    () =>
      walks.filter((w) => {
        const d = new Date(w.createdAt);
        return d.getFullYear() === cursor.y && d.getMonth() === cursor.m;
      }),
    [walks, cursor],
  );

  const displayedWalks = useMemo(() => {
    if (selectedDay === null) return monthWalks;
    return monthWalks.filter((w) => new Date(w.createdAt).getDate() === selectedDay);
  }, [monthWalks, selectedDay]);

  const firstDow = new Date(cursor.y, cursor.m, 1).getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();

  // 통계 & 배지 계산
  const stats = useMemo(() => {
    const totalDist = walks.reduce((a, w) => a + w.distanceM, 0);
    const totalMs = walks.reduce((a, w) => a + w.durationMs, 0);
    const maxSingle = walks.reduce((a, w) => Math.max(a, w.distanceM), 0);
    const guideCount = walks.filter((w) => Boolean(w.guideId)).length;

    // 연속 일수 스트릭
    const daysSet = new Set(walks.map((w) => dateKey(w.createdAt)));
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      if (daysSet.has(dateKey(d.getTime()))) streak++;
      else if (i > 0) break;
    }

    // 최근 7일 거리 막대
    const weekBars: Array<{ label: string; distM: number }> = [];
    const dowNames = ['일', '월', '화', '수', '목', '금', '토'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const k = dateKey(d.getTime());
      const distM = (walksByDate.get(k) ?? []).reduce((a, w) => a + w.distanceM, 0);
      weekBars.push({ label: dowNames[d.getDay()], distM });
    }

    // 최근 140일(20주) 히트맵
    const heatCells: Array<{ key: string; distM: number }> = [];
    for (let i = 139; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const k = dateKey(d.getTime());
      const distM = (walksByDate.get(k) ?? []).reduce((a, w) => a + w.distanceM, 0);
      heatCells.push({ key: k, distM });
    }

    const badges = [
      { id: 'b1', emoji: '👣', title: '첫 발자국', desc: '첫 산책 기록 완료', ok: walks.length >= 1 },
      { id: 'b2', emoji: '🎨', title: '도안 아티스트', desc: '도안/그림 산책 1회', ok: guideCount >= 1 },
      { id: 'b3', emoji: '🏃', title: '3km 워커', desc: '한 번에 3km 이상', ok: maxSingle >= 3000 },
      { id: 'b4', emoji: '🏅', title: '5km 돌파', desc: '한 번에 5km 이상', ok: maxSingle >= 5000 },
      { id: 'b5', emoji: '🔥', title: '3일 연속', desc: '3일 연속 산책', ok: streak >= 3 },
      { id: 'b6', emoji: '🧭', title: '코스 수집가', desc: '코스 찜 1회 이상', ok: savedRoutes.length >= 1 },
      { id: 'b7', emoji: '🌟', title: '누적 10km', desc: '총 거리 10km 달성', ok: totalDist >= 10000 },
      { id: 'b8', emoji: '👑', title: '갤러리 마스터', desc: '작품 5개 이상 완성', ok: walks.length >= 5 },
    ];

    return { totalDist, totalMs, streak, weekBars, heatCells, badges };
  }, [walks, walksByDate, savedRoutes.length]);

  const prevMonth = () => {
    setSelectedDay(null);
    setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  };
  const nextMonth = () => {
    setSelectedDay(null);
    setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));
  };

  return (
    <div className="flex h-full flex-col bg-[#070A0F] pb-[72px]">
      <div className="border-b border-white/8 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-white">나의 기록</h1>
          <div className="text-xs text-zinc-400">총 {walks.length}회</div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-2xl border border-white/8 bg-white/[0.03] p-1">
          {(
            [
              ['calendar', '📅 달력'],
              ['stats', '📈 통계·배지'],
              ['saved', `🔖 찜한 코스 (${savedRoutes.length})`],
            ] as [SubTab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSubTab(k)}
              className={`rounded-xl py-2 text-[11px] font-bold transition ${
                subTab === k ? 'bg-lime text-[#0B1015]' : 'text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {subTab === 'calendar' && (
          <>
            {/* 월 네비게이션 + 월말정산 버튼 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={prevMonth}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-zinc-300"
                >
                  ‹
                </button>
                <span className="text-sm font-extrabold text-white">
                  {cursor.y}년 {cursor.m + 1}월
                </span>
                <button
                  onClick={nextMonth}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-zinc-300"
                >
                  ›
                </button>
              </div>
              <button
                onClick={() => setShowSettlement(true)}
                className="rounded-full border border-lime/40 bg-lime/12 px-3 py-1.5 text-[11px] font-extrabold text-lime active:scale-95"
              >
                ✨ 월말정산
              </button>
            </div>

            {/* 달력 */}
            <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.02] p-2.5">
              <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-zinc-500">
                {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                  <div key={d} className={i === 0 ? 'text-rose/80' : ''}>
                    {d}
                  </div>
                ))}
              </div>
              <div className="mt-1.5 grid grid-cols-7 gap-1">
                {Array.from({ length: firstDow }).map((_, i) => (
                  <div key={`e_${i}`} className="h-12" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, idx) => {
                  const day = idx + 1;
                  const k = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayWalks = walksByDate.get(k) ?? [];
                  const isSel = selectedDay === day;
                  return (
                    <button
                      key={day}
                      onClick={() => setSelectedDay(isSel ? null : day)}
                      className={`flex h-12 flex-col items-center justify-between rounded-xl p-1 text-[10px] transition ${
                        isSel
                          ? 'bg-lime/20 ring-1 ring-lime'
                          : dayWalks.length > 0
                            ? 'bg-white/[0.04]'
                            : ''
                      }`}
                    >
                      <span className={dayWalks.length > 0 ? 'font-bold text-white' : 'text-zinc-500'}>
                        {day}
                      </span>
                      {dayWalks[0] && <MiniWalkThumb walk={dayWalks[0]} size={24} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 선택 날짜 / 이달 산책 목록 */}
            <div className="mt-4 flex items-center justify-between text-xs">
              <span className="font-bold text-zinc-300">
                {selectedDay ? `${cursor.m + 1}월 ${selectedDay}일 기록` : `${cursor.m + 1}월 전체 기록`}
              </span>
              {selectedDay && (
                <button onClick={() => setSelectedDay(null)} className="text-[11px] text-sky">
                  전체 보기
                </button>
              )}
            </div>

            {displayedWalks.length === 0 ? (
              <div className="mt-8 rounded-2xl border border-white/6 bg-white/[0.02] p-6 text-center text-xs text-zinc-500">
                이 기간에 기록된 산책이 없어요.
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {displayedWalks.map((w) => (
                  <li
                    key={w.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-2.5"
                  >
                    <button onClick={() => onOpenWalk(w)} className="shrink-0">
                      <MiniWalkThumb walk={w} size={50} />
                    </button>
                    <button onClick={() => onOpenWalk(w)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-bold text-zinc-100">{w.title}</div>
                      <div className="text-[11px] text-zinc-500">{formatDateTime(w.createdAt)}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-300">
                        {formatDistance(w.distanceM)} · {formatDuration(w.durationMs)} ·{' '}
                        {formatPace(w.distanceM, w.durationMs)}/km
                      </div>
                    </button>
                    <button
                      onClick={() => setReplayWalk(w)}
                      className="rounded-xl border border-sky/30 bg-sky/10 px-2.5 py-1.5 text-[11px] font-bold text-sky"
                      title="경로 재생"
                    >
                      ▶ 재생
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('이 기록을 삭제할까요?')) onDeleteWalk(w.id);
                      }}
                      className="px-1.5 text-sm text-zinc-500"
                      aria-label="삭제"
                    >
                      🗑
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {subTab === 'stats' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5">
                <div className="text-[11px] text-zinc-500">누적 거리</div>
                <div className="mt-1 text-xl font-extrabold text-lime">
                  {formatDistance(stats.totalDist)}
                </div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5">
                <div className="text-[11px] text-zinc-500">누적 시간 · 스트릭</div>
                <div className="mt-1 text-xl font-extrabold text-white">
                  {formatDuration(stats.totalMs)}
                </div>
                <div className="text-[10px] text-mint">{stats.streak}일 연속</div>
              </div>
            </div>

            {/* 최근 7일 차트 */}
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5">
              <div className="mb-3 text-xs font-bold text-zinc-300">최근 7일 거리</div>
              <div className="flex h-24 items-end gap-2">
                {(() => {
                  const maxD = Math.max(500, ...stats.weekBars.map((b) => b.distM));
                  return stats.weekBars.map((b, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div className="flex w-full flex-1 items-end justify-center">
                        <div
                          className="w-full max-w-[22px] rounded-t-md bg-gradient-to-t from-mint to-lime"
                          style={{
                            height: `${Math.max(4, Math.round((b.distM / maxD) * 70))}px`,
                            opacity: b.distM > 0 ? 1 : 0.18,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-zinc-500">{b.label}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* 활동 히트맵 (20주) */}
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5">
              <div className="mb-2 flex items-center justify-between text-xs font-bold text-zinc-300">
                <span>활동 히트맵 (최근 20주)</span>
                <span className="text-[10px] font-normal text-zinc-500">적음 ◻ 🟩 많음</span>
              </div>
              <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto">
                {stats.heatCells.map((c) => {
                  const bg =
                    c.distM <= 0
                      ? 'bg-white/[0.05]'
                      : c.distM < 1000
                        ? 'bg-lime/30'
                        : c.distM < 3000
                          ? 'bg-lime/65'
                          : 'bg-lime';
                  return <div key={c.key} title={`${c.key}: ${formatDistance(c.distM)}`} className={`h-2.5 w-2.5 rounded-[2px] ${bg}`} />;
                })}
              </div>
            </div>

            {/* 8종 성취 배지 */}
            <div>
              <div className="mb-2 text-xs font-bold text-zinc-300">
                성취 배지 ({stats.badges.filter((b) => b.ok).length} / 8)
              </div>
              <div className="grid grid-cols-2 gap-2">
                {stats.badges.map((b) => (
                  <div
                    key={b.id}
                    className={`flex items-center gap-2.5 rounded-2xl border p-2.5 ${
                      b.ok
                        ? 'border-lime/35 bg-lime/[0.08]'
                        : 'border-white/8 bg-white/[0.02] opacity-55'
                    }`}
                  >
                    <div className="text-2xl">{b.emoji}</div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-white">{b.title}</div>
                      <div className="truncate text-[10px] text-zinc-400">{b.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {subTab === 'saved' && (
          <div>
            {savedRoutes.length === 0 ? (
              <div className="mt-12 text-center text-xs text-zinc-500">
                아직 찜한 코스가 없어요.
                <br />
                직접 그리기 · AI 추천 · 점 찍기에서 [🔖 찜]을 눌러 저장해 보세요.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {savedRoutes.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-white">{r.title}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-400">
                        {formatDistance(r.totalDistanceM)}
                        {r.similarity ? ` · 닮은 정도 ${r.similarity}%` : ''} ·{' '}
                        {r.isRealRoad ? '실제 도보길' : '직선 코스'}
                      </div>
                    </div>
                    <button
                      onClick={() => onStartSavedRoute(r)}
                      className="shrink-0 rounded-xl bg-lime px-3 py-2 text-xs font-extrabold text-[#0B1015] active:scale-95"
                    >
                      따라뛰기
                    </button>
                    <button
                      onClick={() => onDeleteSavedRoute(r.id)}
                      className="px-1 text-sm text-zinc-500"
                    >
                      🗑
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {showSettlement && (
        <MonthlySettlementModal
          year={cursor.y}
          month={cursor.m}
          walks={walks}
          onClose={() => setShowSettlement(false)}
          onToast={onToast}
        />
      )}

      {replayWalk && <WalkReplayModal walk={replayWalk} onClose={() => setReplayWalk(null)} />}
    </div>
  );
}
