import { useEffect, useRef, useState } from 'react';

/** 시작 전 3·2·1 카운트다운 (Nike Run Club 방식). 화면을 탭하면 바로 시작. */
export default function Countdown({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [n, setN] = useState(3);
  const doneRef = useRef(false);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  useEffect(() => {
    try {
      navigator.vibrate?.(40);
    } catch {
      /* ignore */
    }
    if (n === 0) {
      const t = window.setTimeout(finish, 350);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setN((v) => v - 1), 900);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  return (
    <div
      className="fixed inset-0 z-[65] flex flex-col items-center justify-center bg-lime text-[#0B1015]"
      onClick={finish}
      role="button"
      aria-label="탭하면 바로 시작"
    >
      <div key={n} className="countdown-pop text-[160px] font-black leading-none tabular-nums">
        {n === 0 ? 'GO' : n}
      </div>
      <div className="mt-6 text-[15px] font-bold opacity-70">탭하면 바로 시작해요</div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          doneRef.current = true;
          onCancel();
        }}
        className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] rounded-full border border-black/20 px-5 py-2 text-[14px] font-bold"
      >
        취소
      </button>
    </div>
  );
}
