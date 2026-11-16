import { formatDate, formatDistance, formatDuration, formatPace, smoothGeometry, type XY } from './geo';
import type { Walk } from '../types';

export type PosterVariant = 'card' | 'plain' | 'thumb';

export type PosterGeom = {
  W: number;
  H: number;
  variant: PosterVariant;
  segments: { pts: XY[]; len: number }[];
  total: number;
  head: XY | null;
  tail: XY | null;
  walk: Walk;
};

export const POSTER_W = 1080;
export const POSTER_H = 1350;

// 주의: 캔버스 font 문자열에서는 -apple-system 을 쓰지 않는다(일부 렌더러가 해석 실패).
// system-ui 가 iOS/macOS 에서 같은 시스템 서체로 떨어진다.
const FONT = 'system-ui, "Apple SD Gothic Neo", Pretendard, "Noto Sans KR", sans-serif';

export function makeGeometry(walk: Walk, W: number, H: number, variant: PosterVariant): PosterGeom {
  const { segments: meters } = smoothGeometry(walk.points);

  let area: { x: number; y: number; w: number; h: number };
  if (variant === 'card') {
    const padX = W * 0.095;
    area = { x: padX, y: H * 0.205, w: W - padX * 2, h: H * 0.575 };
  } else if (variant === 'plain') {
    const pad = W * 0.1;
    area = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 };
  } else {
    const pad = Math.min(W, H) * 0.14;
    area = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 };
  }

  const flat = meters.flat();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of flat) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!flat.length) {
    return { W, H, variant, segments: [], total: 0, head: null, tail: null, walk };
  }

  const spanX = Math.max(maxX - minX, 18);
  const spanY = Math.max(maxY - minY, 18);
  const scale = Math.min(area.w / spanX, area.h / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ox = area.x + area.w / 2;
  const oy = area.y + area.h / 2;

  const toCanvas = (p: XY): XY => ({
    x: ox + (p.x - cx) * scale,
    y: oy - (p.y - cy) * scale,
  });

  const segments = meters.map((seg) => {
    const pts = seg.map(toCanvas);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return { pts, len };
  });
  const total = segments.reduce((a, s) => a + s.len, 0);

  return {
    W,
    H,
    variant,
    segments,
    total,
    head: segments[0]?.pts[0] ?? null,
    tail: (() => {
      const last = segments[segments.length - 1];
      return last ? last.pts[last.pts.length - 1] : null;
    })(),
    walk,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const parts = [r, g, b].map((c, i) =>
    Math.round(c + (target[i] - c) * amount)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${parts.join('')}`;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawSpaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
) {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

function traceProgress(
  ctx: CanvasRenderingContext2D,
  geom: PosterGeom,
  progress: number,
): { x: number; y: number } | null {
  if (geom.total <= 0) return null;
  const target = geom.total * Math.max(0, Math.min(1, progress));
  if (target <= 0) return null;

  let travelled = 0;
  let head: XY | null = null;
  for (const seg of geom.segments) {
    if (travelled >= target) break;
    const pts = seg.pts;
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    head = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (travelled + d >= target) {
        const t = d === 0 ? 0 : (target - travelled) / d;
        const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
        const y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
        ctx.lineTo(x, y);
        head = { x, y };
        travelled = target;
        break;
      }
      ctx.lineTo(pts[i].x, pts[i].y);
      travelled += d;
      head = pts[i];
    }
    ctx.stroke();
  }
  return head;
}

export function drawPoster(
  ctx: CanvasRenderingContext2D,
  geom: PosterGeom,
  opts: { progress?: number; showText?: boolean } = {},
) {
  const { W, H, walk, variant } = geom;
  const progress = opts.progress ?? 1;
  const showText = opts.showText ?? variant === 'card';
  ctx.clearRect(0, 0, W, H);

  // 배경
  if (variant === 'thumb') {
    ctx.fillStyle = '#0C1219';
    ctx.fillRect(0, 0, W, H);
  } else {
    const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
    bg.addColorStop(0, '#0D141D');
    bg.addColorStop(0.55, '#080C12');
    bg.addColorStop(1, '#06080C');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 경로 근처 은은한 색 번짐
    const focus = geom.tail ?? { x: W / 2, y: H / 2 };
    const glow = ctx.createRadialGradient(focus.x, focus.y, 0, focus.x, focus.y, W * 0.72);
    glow.addColorStop(0, rgba(mix(walk.color, [255, 255, 255], 0.06), 0.18));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // 경로
  if (geom.total > 0) {
    const lw = Math.max(1.5, W * 0.0125 * (walk.width / 5));
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, walk.color);
    grad.addColorStop(1, mix(walk.color, [255, 255, 255], 0.28));

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1) 빛 번짐(아우라)
    ctx.strokeStyle = walk.color;
    ctx.globalAlpha = variant === 'thumb' ? 0.18 : 0.11;
    ctx.lineWidth = lw * 2.4;
    traceProgress(ctx, geom, progress);

    // 2) 본선
    ctx.globalAlpha = 1;
    ctx.strokeStyle = grad;
    ctx.lineWidth = lw;
    ctx.shadowColor = walk.color;
    ctx.shadowBlur = variant === 'thumb' ? 6 : lw * 0.9;
    const head = traceProgress(ctx, geom, progress);
    ctx.shadowBlur = 0;
    ctx.restore();

    // 시작점 · 현재점
    const r = lw * 0.95;
    if (geom.head) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(geom.head.x, geom.head.y, r * 1.05, 0, Math.PI * 2);
      ctx.fillStyle = '#0A0F15';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.42);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.stroke();
      ctx.restore();
    }
    const tip = progress >= 1 ? geom.tail : head;
    if (tip) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, r * 1.35, 0, Math.PI * 2);
      ctx.fillStyle = walk.color;
      ctx.shadowColor = walk.color;
      ctx.shadowBlur = lw * 1.8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(8,12,18,0.9)';
      ctx.lineWidth = Math.max(1.5, r * 0.35);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (!showText) return;

  // 텍스트 블록
  const padX = W * 0.095;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // 브랜드 / 날짜
  ctx.font = `600 ${W * 0.024}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  drawSpaced(ctx, 'WALK DRAW', padX, H * 0.072, W * 0.005);

  ctx.font = `500 ${W * 0.024}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.textAlign = 'right';
  ctx.fillText(formatDate(walk.createdAt), W - padX, H * 0.072);
  ctx.textAlign = 'left';

  // 제목
  const title = walk.title || '나의 발자취';
  let titleSize = W * 0.078;
  ctx.font = `800 ${titleSize}px ${FONT}`;
  const maxTitleW = W - padX * 2;
  while (ctx.measureText(title).width > maxTitleW && titleSize > W * 0.04) {
    titleSize -= 2;
    ctx.font = `800 ${titleSize}px ${FONT}`;
  }
  ctx.fillStyle = '#F4F8FC';
  ctx.fillText(title, padX, H * 0.145);

  // 하단 스탯
  const statY = H * 0.865;
  const dist = formatDistance(walk.distanceM);
  const distSize = W * 0.1;
  ctx.font = `800 ${distSize}px ${FONT}`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(dist, padX, statY);

  ctx.font = `500 ${W * 0.032}px ${FONT}`;
  ctx.fillStyle = 'rgba(233,238,245,0.62)';
  const meta = `${formatDuration(walk.durationMs)}  ·  ${formatPace(walk.distanceM, walk.durationMs)}/km`;
  ctx.fillText(meta, padX, statY + W * 0.06);

  // 구분선
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = Math.max(1, W * 0.0015);
  ctx.beginPath();
  ctx.moveTo(padX, H * 0.93);
  ctx.lineTo(W - padX, H * 0.93);
  ctx.stroke();

  // 푸터
  ctx.font = `500 ${W * 0.023}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  drawSpaced(ctx, '발자취 스케치', padX, H * 0.962, W * 0.0023);

  ctx.textAlign = 'right';
  const guideLabel = walk.guideId ? '도안 따라 걷기' : '자유 드로잉';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(`${guideLabel} · WalkDraw`, W - padX, H * 0.962);
  ctx.restore();
}

export async function renderPosterBlob(
  walk: Walk,
  opts: { width?: number; height?: number; variant?: PosterVariant } = {},
): Promise<Blob | null> {
  const W = opts.width ?? POSTER_W;
  const H = opts.height ?? POSTER_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const geom = makeGeometry(walk, W, H, opts.variant ?? 'card');
  drawPoster(ctx, geom, { progress: 1, showText: true });
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 0.95));
}
