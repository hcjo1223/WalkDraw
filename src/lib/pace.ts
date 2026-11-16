export type PaceId = 'slow' | 'walk' | 'jog';
export type GoalMode = 'time' | 'distance';

export type PacePreset = {
  id: PaceId;
  label: string;
  emoji: string;
  kmh: number;
  mps: number;
  simSpeed: number;
  paceText: string;
  desc: string;
};

export const PACE_PRESETS: PacePreset[] = [
  {
    id: 'slow',
    label: '천천히 걷기',
    emoji: '🐢',
    kmh: 3.6,
    mps: 1.0,
    simSpeed: 15,
    paceText: "16'40\"/km",
    desc: '여유롭게 산책 · 3.6 km/h',
  },
  {
    id: 'walk',
    label: '걷기',
    emoji: '🚶',
    kmh: 4.8,
    mps: 4.8 / 3.6,
    simSpeed: 22,
    paceText: "12'30\"/km",
    desc: '보통 걸음 · 4.8 km/h',
  },
  {
    id: 'jog',
    label: '가볍게 뛰기',
    emoji: '🏃',
    kmh: 7.5,
    mps: 7.5 / 3.6,
    simSpeed: 34,
    paceText: "8'00\"/km",
    desc: '가벼운 조깅 · 7.5 km/h',
  },
];

export const TIME_PRESETS_MIN = [10, 15, 20, 30, 45, 60];
export const DIST_PRESETS_M = [500, 1000, 1500, 2000, 3000, 5000];

export function paceById(id: PaceId): PacePreset {
  return PACE_PRESETS.find((p) => p.id === id) ?? PACE_PRESETS[1];
}

/** 시간(분)과 속도 프리셋으로 목표 거리(m) 계산 */
export function calcDistanceFromMinutes(minutes: number, paceId: PaceId): number {
  const pace = paceById(paceId);
  return Math.max(50, Math.round(minutes * 60 * pace.mps));
}

/** 거리(m)와 속도 프리셋으로 예상 소요 시간(분) 계산 */
export function calcMinutesFromDistance(distanceM: number, paceId: PaceId): number {
  const pace = paceById(paceId);
  return Math.max(1, Math.round(distanceM / pace.mps / 60));
}

/** 예상 소요 시간(분)을 읽기 좋은 한국어로 */
export function formatEstimatedMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}시간` : `${h}시간 ${rem}분`;
}

/** 예상 소요 시간(초)을 거리(m)와 속도로 계산 */
export function calcSecondsFromDistance(distanceM: number, paceId: PaceId): number {
  const pace = paceById(paceId);
  return Math.max(1, Math.round(distanceM / pace.mps));
}
