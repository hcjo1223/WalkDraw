import { useEffect, useRef, useState } from 'react';
import { isGoogleLoginConfigured, renderGoogleButton, type AuthUser } from '../lib/auth';

/** 헤더에 들어가는 작은 계정 버튼 (로그인 전: "로그인", 로그인 후: 프로필 사진) */
export function AccountButton({ user, onClick }: { user: AuthUser | null; onClick: () => void }) {
  if (!user) {
    return (
      <button
        onClick={onClick}
        className="ml-0.5 rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-zinc-200 active:scale-95"
        aria-label="Google 로그인"
      >
        로그인
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="ml-0.5 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-lime/40 bg-lime/15 text-[10px] font-bold text-lime active:scale-95"
      aria-label={`내 계정 (${user.name})`}
      title={user.email || user.name}
    >
      <Avatar user={user} />
    </button>
  );
}

function Avatar({ user }: { user: AuthUser }) {
  const [broken, setBroken] = useState(false);
  if (user.picture && !broken) {
    return (
      <img
        src={user.picture}
        alt=""
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return <span>{user.name.slice(0, 1).toUpperCase()}</span>;
}

interface SheetProps {
  user: AuthUser | null;
  onClose: () => void;
  onSignIn: (user: AuthUser) => void;
  onSignOut: () => void;
}

/** 로그인 / 내 계정 바텀 시트 */
export default function AccountSheet({ user, onClose, onSignIn, onSignOut }: SheetProps) {
  const btnRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const configured = isGoogleLoginConfigured();

  useEffect(() => {
    if (user || !configured || !btnRef.current) return;
    let cancelled = false;
    setStatus('loading');
    renderGoogleButton(
      btnRef.current,
      (u) => {
        if (!cancelled) onSignIn(u);
      },
      (msg) => {
        if (!cancelled) setError(msg);
      },
    )
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [user, configured, onSignIn]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={user ? '내 계정' : 'Google 로그인'}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl border border-white/10 bg-[#0B1017] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-extrabold text-white">{user ? '내 계정' : '로그인'}</div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-white/[0.06] text-zinc-400"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {user ? (
          <>
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime/15 text-lg font-bold text-lime">
                <Avatar user={user} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-bold text-zinc-100">{user.name}</div>
                {user.email && <div className="truncate text-[12px] text-zinc-400">{user.email}</div>}
                <div className="mt-0.5 text-[10px] font-semibold text-lime">Google 계정으로 로그인됨</div>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              산책 기록 · 찜한 코스 · 파트너는 지금처럼 이 기기에 저장돼요.
            </p>
            <button
              onClick={onSignOut}
              className="mt-4 w-full rounded-2xl border border-rose/30 bg-rose/10 py-3 text-[13px] font-bold text-rose"
            >
              로그아웃
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
              Google 계정으로 로그인하고 나만의 WalkDraw를 시작하세요.
            </p>

            {configured ? (
              <div className="mt-5 flex min-h-[44px] flex-col items-center justify-center">
                <div ref={btnRef} className="flex w-full justify-center" />
                {status === 'loading' && (
                  <div className="text-[12px] text-zinc-500">Google 로그인 준비 중…</div>
                )}
                {status === 'error' && (
                  <div className="text-center text-[12px] text-rose">
                    Google 로그인을 불러오지 못했어요. 네트워크 상태를 확인해 주세요.
                  </div>
                )}
                {error && <div className="mt-2 text-center text-[12px] text-rose">{error}</div>}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-amber/30 bg-amber/10 p-3 text-[12px] leading-relaxed text-amber">
                Google 로그인이 아직 설정되지 않았어요. (<code>VITE_GOOGLE_CLIENT_ID</code> 필요)
              </div>
            )}

            <p className="mt-4 text-center text-[10px] leading-relaxed text-zinc-600">
              로그인 없이도 모든 기능을 쓸 수 있어요. 이름 · 이메일 · 프로필 사진만 이 기기에 저장돼요.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
