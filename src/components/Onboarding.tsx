import { useState } from 'react';
import { CourseCardList, type CourseKind } from './CourseOptions';

const ONBOARD_KEY = 'walkdraw.onboarded.v1';

export function needsOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARD_KEY) !== '1';
  } catch {
    return false;
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARD_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * 첫 실행 안내 3단계: 소개 → 걷는 방식 고르기 → 위치 권한 안내.
 * (위치 권한은 시스템 팝업 전에 왜 필요한지 먼저 설명 — Strava·NRC 방식)
 */
export default function Onboarding({
  onDone,
  onRequestLocation,
}: {
  onDone: (course: CourseKind) => void;
  onRequestLocation: () => void;
}) {
  const [step, setStep] = useState(0);
  const [course, setCourse] = useState<CourseKind>('free');

  const finish = () => {
    markOnboarded();
    onDone(course);
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5" aria-label={`${step + 1} / 3 단계`}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-lime' : 'w-1.5 bg-white/20'}`}
            />
          ))}
        </div>
        {step < 2 && (
          <button onClick={finish} className="px-2 py-1 text-[13px] text-zinc-500">
            건너뛰기
          </button>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        {step === 0 && (
          <>
            <div className="text-[56px] leading-none">👣</div>
            <h1 className="mt-5 text-[28px] font-extrabold leading-tight text-white">
              걸으면
              <br />
              <span className="text-lime">그림</span>이 돼요
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">
              WalkDraw는 내가 걸은 길을 기록해서 한 장의 그림 카드로 남겨 주는 산책 앱이에요.
            </p>
            <ul className="mt-6 space-y-3 text-[14px] text-zinc-200">
              <li className="flex gap-3">
                <span className="text-xl">🗺</span>
                <span>걷는 동안 지도 위에 내 발자취가 그려져요</span>
              </li>
              <li className="flex gap-3">
                <span className="text-xl">❤️</span>
                <span>하트·별 같은 도안을 따라 걸으면 GPS 아트 완성</span>
              </li>
              <li className="flex gap-3">
                <span className="text-xl">🎨</span>
                <span>다 걸으면 포스터 카드와 타임랩스 영상으로 저장</span>
              </li>
            </ul>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="text-[24px] font-extrabold leading-tight text-white">어떻게 걸어볼까요?</h1>
            <p className="mb-5 mt-2 text-[14px] text-zinc-400">나중에 언제든 바꿀 수 있어요.</p>
            <CourseCardList value={course} onPick={setCourse} />
          </>
        )}

        {step === 2 && (
          <>
            <div className="text-[56px] leading-none">📍</div>
            <h1 className="mt-5 text-[24px] font-extrabold leading-tight text-white">
              걸은 길을 그리려면
              <br />
              위치가 필요해요
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">
              산책을 기록하는 동안에만 위치를 사용해요. 위치 정보는 이 기기에 저장되고, 로그인하면 내 계정에만
              백업돼요.
            </p>
          </>
        )}
      </div>

      <div className="mx-auto w-full max-w-sm space-y-2">
        {step < 2 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            className="w-full rounded-2xl bg-lime py-4 text-[16px] font-extrabold text-[#0B1015] active:scale-[0.99]"
          >
            {step === 0 ? '시작하기' : '다음'}
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                onRequestLocation();
                finish();
              }}
              className="w-full rounded-2xl bg-lime py-4 text-[16px] font-extrabold text-[#0B1015] active:scale-[0.99]"
            >
              위치 허용하기
            </button>
            <button onClick={finish} className="w-full py-2 text-[14px] text-zinc-500">
              나중에 할게요
            </button>
          </>
        )}
      </div>
    </div>
  );
}
