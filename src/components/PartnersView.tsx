import { useMemo, useState } from 'react';
import {
  GRADE_LABELS,
  PARTNERS,
  partnerSvgDataUrl,
  type PartnerDef,
  type PartnerGrade,
} from '../lib/partners';
import type { PartnerState } from '../lib/storage';

type Props = {
  state: PartnerState;
  onSelectActive: (id: string) => void;
  onClaimStarter: () => void;
};

const GRADES: Array<'ALL' | PartnerGrade> = ['ALL', 'D', 'C', 'B', 'A', 'S'];

export default function PartnersView({ state, onSelectActive, onClaimStarter }: Props) {
  const [grade, setGrade] = useState<'ALL' | PartnerGrade>('ALL');
  const [detail, setDetail] = useState<PartnerDef | null>(null);

  const ownedUnique = useMemo(
    () => PARTNERS.filter((p) => (state.counts[p.id] ?? 0) > 0).length,
    [state.counts],
  );
  const ownedTotal = useMemo(
    () => Object.values(state.counts).reduce((a, b) => a + b, 0),
    [state.counts],
  );

  const filtered = useMemo(
    () => (grade === 'ALL' ? PARTNERS : PARTNERS.filter((p) => p.grade === grade)),
    [grade],
  );

  return (
    <div className="flex h-full flex-col bg-[#070A0F] pb-[72px]">
      {/* 헤더 */}
      <div className="border-b border-white/8 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-extrabold text-white">파트너</h1>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              보유 {ownedTotal}개 · 아직 만나지 않은 친구는 실루엣으로 보여요.
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-bold tabular-nums text-lime">
            {ownedUnique} / {PARTNERS.length}종
          </div>
        </div>

        {/* 첫 파트너 선물 배너 */}
        {!state.starterClaimed && (
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-lime/35 bg-lime/10 px-3.5 py-2.5">
            <div>
              <div className="text-[12px] font-bold text-lime">🎁 첫 파트너 선물이 도착했어요!</div>
              <div className="text-[11px] text-zinc-300">산책코기와 함께 오늘 첫 걸음을 시작해 보세요.</div>
            </div>
            <button
              onClick={onClaimStarter}
              className="shrink-0 rounded-xl bg-lime px-3 py-1.5 text-[12px] font-extrabold text-[#0B1015] active:scale-95"
            >
              받기
            </button>
          </div>
        )}

        {/* 등급 필터 */}
        <div className="mt-3 flex gap-1.5 overflow-x-auto scroll-x">
          {GRADES.map((g) => {
            const active = grade === g;
            return (
              <button
                key={g}
                onClick={() => setGrade(g)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${
                  active
                    ? 'bg-lime text-[#0B1015]'
                    : 'border border-white/10 bg-white/[0.04] text-zinc-400'
                }`}
              >
                {g === 'ALL' ? '전체' : GRADE_LABELS[g].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 파트너 그리드 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-3 gap-2.5">
          {filtered.map((p) => {
            const count = state.counts[p.id] ?? 0;
            const unlocked = count > 0;
            const isActive = state.activeId === p.id;
            const meta = GRADE_LABELS[p.grade];
            return (
              <button
                key={p.id}
                onClick={() => setDetail(p)}
                className={`relative flex flex-col items-center rounded-2xl border p-2.5 text-center transition active:scale-[0.97] ${
                  isActive
                    ? 'border-lime bg-lime/[0.10]'
                    : unlocked
                      ? 'border-white/10 bg-white/[0.03]'
                      : 'border-white/6 bg-[#0B1017]'
                }`}
              >
                <span
                  className="self-start rounded-md px-1.5 py-0.5 text-[9px] font-extrabold"
                  style={{ color: meta.color, background: meta.bg }}
                >
                  {meta.label}
                </span>

                <div className="relative my-2 flex h-16 w-16 items-center justify-center">
                  <img
                    src={partnerSvgDataUrl(p, !unlocked)}
                    alt={unlocked ? p.name : '미지의 친구'}
                    className="h-14 w-14 object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  {!unlocked && (
                    <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-[#0B1017] text-[10px]">
                      🔒
                    </span>
                  )}
                </div>

                <div className={`w-full truncate text-[12px] font-bold ${unlocked ? 'text-zinc-100' : 'text-zinc-500'}`}>
                  {unlocked ? p.name : '미지의 친구'}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  {unlocked ? `${count}개 보유` : '미획득'}
                </div>

                {isActive && (
                  <span className="mt-1 rounded-full bg-lime px-2 py-0.5 text-[9px] font-extrabold text-[#0B1015]">
                    동행 중
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 파트너 상세 모달 */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setDetail(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/12 bg-[#0E151E] p-5 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const count = state.counts[detail.id] ?? 0;
              const unlocked = count > 0;
              const isActive = state.activeId === detail.id;
              const meta = GRADE_LABELS[detail.grade];
              return (
                <>
                  <span
                    className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                    style={{ color: meta.color, background: meta.bg }}
                  >
                    {meta.label}
                  </span>
                  <div className="mx-auto my-4 flex h-24 w-24 items-center justify-center rounded-3xl bg-white/[0.04]">
                    <img
                      src={partnerSvgDataUrl(detail, !unlocked)}
                      alt={detail.name}
                      className="h-20 w-20"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                  <h3 className="text-lg font-extrabold text-white">
                    {unlocked ? detail.name : '미지의 친구'}
                  </h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    {unlocked ? detail.desc : `해금 조건: ${detail.unlockHint}`}
                  </p>
                  {unlocked && (
                    <div className="mt-2 text-[11px] text-mint">보유 수량: {count}개</div>
                  )}

                  <div className="mt-5 flex gap-2">
                    <button
                      onClick={() => setDetail(null)}
                      className="flex-1 rounded-2xl border border-white/12 py-3 text-xs font-bold text-zinc-300"
                    >
                      닫기
                    </button>
                    {unlocked && (
                      <button
                        onClick={() => {
                          onSelectActive(detail.id);
                          setDetail(null);
                        }}
                        className={`flex-1 rounded-2xl py-3 text-xs font-extrabold ${
                          isActive ? 'bg-white/10 text-zinc-300' : 'bg-lime text-[#0B1015]'
                        }`}
                      >
                        {isActive ? '이미 동행 중' : '함께 산책하기'}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
