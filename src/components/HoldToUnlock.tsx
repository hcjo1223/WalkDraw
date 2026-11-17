import { useEffect, useRef, useState } from 'react';

const HOLD_MS = 1000;

/** 길게 눌러야(1초) 동작하는 버튼. 오터치 방지 잠금 해제용. 마우스·터치·키보드(Enter/Space 길게) 지원. */
export default function HoldToUnlock({ onUnlock }: { onUnlock: () => void }) {
  const [progress, setProgress] = useState(0);
  const raf = useRef(0);
  const startedAt = useRef(0);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    startedAt.current = 0;
    setProgress(0);
  };

  const start = () => {
    if (raf.current) return;
    startedAt.current = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - startedAt.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        stop();
        onUnlock();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') stop();
      }}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="화면 잠금 해제: 1초 동안 길게 누르세요"
      className="relative select-none overflow-hidden rounded-full border border-lime/40 bg-lime/15 px-7 py-3.5 text-sm font-extrabold text-lime [-webkit-touch-callout:none] [touch-action:none]"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-lime/30"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative">🔓 길게 눌러 잠금 해제</span>
    </button>
  );
}
