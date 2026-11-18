/** 코스 방식 4가지 — 처음 쓰는 사람도 알 수 있게 이름과 한 줄 설명을 붙인다. */
export type CourseKind = 'free' | 'sketch' | 'ai' | 'pin';

export const COURSE_OPTIONS: Array<{
  id: CourseKind;
  icon: string;
  title: string;
  desc: string;
  tag?: string;
}> = [
  { id: 'free', icon: '🏃', title: '자유롭게 걷기', desc: '코스 없이 걷고, 걸은 길을 기록해요', tag: '가장 쉬워요' },
  { id: 'sketch', icon: '✏️', title: '그림 그리며 걷기', desc: '하트·별 같은 도안이나 내 손그림을 따라 걸어요' },
  { id: 'ai', icon: '✨', title: '추천 코스', desc: '목표 시간에 맞는 산책 코스 3개를 골라 드려요' },
  { id: 'pin', icon: '📍', title: '내가 만드는 코스', desc: '지도를 콕콕 눌러 원하는 길을 이어요' },
];

export const courseOption = (id: CourseKind) => COURSE_OPTIONS.find((c) => c.id === id) ?? COURSE_OPTIONS[0];

const COURSE_KEY = 'walkdraw.course.v1';

export function loadLastCourse(): CourseKind {
  try {
    const v = localStorage.getItem(COURSE_KEY);
    if (v === 'free' || v === 'sketch' || v === 'ai' || v === 'pin') return v;
  } catch {
    /* ignore */
  }
  return 'free';
}

export function saveLastCourse(k: CourseKind) {
  try {
    localStorage.setItem(COURSE_KEY, k);
  } catch {
    /* ignore */
  }
}

/** 큰 카드 목록 (온보딩 · 코스 고르기 시트 공용) */
export function CourseCardList({
  value,
  onPick,
}: {
  value: CourseKind | null;
  onPick: (k: CourseKind) => void;
}) {
  return (
    <div className="grid gap-2">
      {COURSE_OPTIONS.map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            aria-pressed={active}
            className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-[0.99] ${
              active ? 'border-lime/70 bg-lime/[0.10]' : 'border-white/10 bg-white/[0.04]'
            }`}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-2xl">
              {c.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-[15px] font-extrabold text-white">{c.title}</span>
                {c.tag && (
                  <span className="rounded-full bg-mint/15 px-1.5 py-0.5 text-[10px] font-bold text-mint">
                    {c.tag}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-zinc-400">{c.desc}</span>
            </span>
            <span className={`shrink-0 text-lg ${active ? 'text-lime' : 'text-zinc-600'}`}>
              {active ? '✓' : '›'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
