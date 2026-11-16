export type PartnerGrade = 'D' | 'C' | 'B' | 'A' | 'S';

export type PartnerDef = {
  id: string;
  name: string;
  grade: PartnerGrade;
  desc: string;
  unlockHint: string;
  accent: string;
  palette: Record<string, string>;
  grid: string[]; // 12x12 pixel grid, '.' is transparent
};

export const GRADE_LABELS: Record<PartnerGrade, { label: string; color: string; bg: string }> = {
  D: { label: 'D급', color: '#A3E635', bg: 'rgba(163,230,53,0.14)' },
  C: { label: 'C급', color: '#5EC8FF', bg: 'rgba(94,200,255,0.14)' },
  B: { label: 'B급', color: '#B79CFF', bg: 'rgba(183,156,255,0.16)' },
  A: { label: 'A급', color: '#FFC46B', bg: 'rgba(255,196,107,0.16)' },
  S: { label: 'S급', color: '#FF8FA3', bg: 'rgba(255,143,163,0.18)' },
};

export const PARTNERS: PartnerDef[] = [
  // D급 (4종) - 가벼운 첫 산책/스타터
  {
    id: 'corgi',
    name: '산책코기',
    grade: 'D',
    desc: '초록 스카프를 두른 첫 산책 메이트',
    unlockHint: '첫 파트너 선물 또는 100m 이상 산책',
    accent: '#F59E0B',
    palette: { o: '#EA580C', y: '#FDBA74', w: '#FFFBEB', k: '#111827', g: '#6EF3B6' },
    grid: [
      '..oo....oo..',
      '.oyyo..oyyo.',
      '.oyyyyyyyyo.',
      '.oykyyykyyo.',
      '.oyywwwyyyo.',
      '..owkwwkwo..',
      '...oggggo...',
      '..oyyyyyyo..',
      '.oyywwwwyyo.',
      '.oyywwwwyyo.',
      '..oo....oo..',
      '..ww....ww..',
    ],
  },
  {
    id: 'poodle',
    name: '구름푸들',
    grade: 'D',
    desc: '몽실몽실 솜사탕 같은 산책 친구',
    unlockHint: '산책 1회 이상 완료',
    accent: '#E2E8F0',
    palette: { w: '#F8FAFC', c: '#CBD5E1', p: '#C084FC', k: '#1E293B', r: '#FB7185' },
    grid: [
      '...pppp.....',
      '..pwwwwpp...',
      '.cwwwwwwwc..',
      '.cwwkwwkwc..',
      '.cwwwrkwwc..',
      '..cwwwwwc...',
      '..cwwwwwwc..',
      '.cwwwwwwwwc.',
      '.cwwwwwwwwc.',
      '..cww..wwc..',
      '..ww....ww..',
      '............',
    ],
  },
  {
    id: 'dachshund',
    name: '밤산책닥스',
    grade: 'D',
    desc: '노란 스카프가 매력적인 야간 산책러',
    unlockHint: '산책 1회 이상 완료',
    accent: '#FBBF24',
    palette: { b: '#292524', t: '#D97706', y: '#FDE047', k: '#09090B', r: '#F87171' },
    grid: [
      '..bb....bb..',
      '.bbbbbbbbbb.',
      '.bbkbbbbkbb.',
      '.bbtbbbbtbb.',
      '.bbttrrttbb.',
      '..bttttttb..',
      '..byyyyyyb..',
      '.bbbbbbbbbb.',
      '.bbttttttbb.',
      '..bb....bb..',
      '..tt....tt..',
      '............',
    ],
  },
  {
    id: 'chick',
    name: '노랑병아리',
    grade: 'D',
    desc: '총총총 발걸음이 가벼운 병아리',
    unlockHint: '산책 1회 이상 완료',
    accent: '#FACC15',
    palette: { y: '#FDE047', o: '#F97316', k: '#111827', w: '#FEF9C3', p: '#FB7185' },
    grid: [
      '.....yy.....',
      '...yyyyyy...',
      '..yyyyyyyy..',
      '..ykoyyoky..',
      '..ypyooopy..',
      '...yyyyyy...',
      '..wyyyyyyw..',
      '.wyyyyyyyyw.',
      '..yyyyyyyy..',
      '...yy..yy...',
      '..oo....oo..',
      '............',
    ],
  },

  // C급 (4종) - 도안/산책 누적
  {
    id: 'cheesecat',
    name: '치즈냥이',
    grade: 'C',
    desc: '도안을 유심히 따라 걷는 호기심 고양이',
    unlockHint: '산책 2회 이상 또는 800m 완주',
    accent: '#FB923C',
    palette: { o: '#FB923C', d: '#C2410C', w: '#FFF7ED', k: '#111827', p: '#FDA4AF' },
    grid: [
      '.oo......oo.',
      '.opo....opo.',
      '.oodododooo.',
      '.ookooooook.',
      '.oowpwwpwoo.',
      '..oowwwwoo..',
      '..oooddooo..',
      '.ooowwwwooo.',
      '.ooowwwwooo.',
      '..oo....oo..',
      '..ww....ww..',
      '............',
    ],
  },
  {
    id: 'bunny',
    name: '포근토끼',
    grade: 'C',
    desc: '폴짝폴짝 뛰어가는 분홍귀 토끼',
    unlockHint: '산책 2회 이상 또는 800m 완주',
    accent: '#F472B6',
    palette: { w: '#FFF1F2', p: '#F9A8D4', k: '#1F2937', r: '#FB7185', c: '#E2E8F0' },
    grid: [
      '..wp....pw..',
      '..wp....pw..',
      '..wp....pw..',
      '..wwwwwwww..',
      '.wwkwwwwkww.',
      '.wwpprrppww.',
      '..cwwwwwwc..',
      '..cwwwwwwc..',
      '.ccwwwwwwcc.',
      '..ww....ww..',
      '..pp....pp..',
      '............',
    ],
  },
  {
    id: 'duck',
    name: '연못오리',
    grade: 'C',
    desc: '물가 산책로를 사랑하는 하얀 오리',
    unlockHint: '산책 2회 이상 또는 800m 완주',
    accent: '#38BDF8',
    palette: { w: '#F8FAFC', o: '#FB923C', k: '#0F172A', b: '#BAE6FD', y: '#FDE047' },
    grid: [
      '....wwww....',
      '...wwwwww...',
      '..wwkwwkww..',
      '..wwooooww..',
      '...wwwwww...',
      '..bwwwwwwb..',
      '.bbwwwwwwbb.',
      '.bwwwwwwwwb.',
      '..bwwwwwwb..',
      '...oo..oo...',
      '..oo....oo..',
      '............',
    ],
  },
  {
    id: 'frog',
    name: '초록개굴',
    grade: 'C',
    desc: '비 온 뒤 공원 산책을 즐기는 개구리',
    unlockHint: '산책 2회 이상 또는 800m 완주',
    accent: '#4ADE80',
    palette: { g: '#4ADE80', d: '#16A34A', w: '#F0FDF4', k: '#052E16', p: '#FCA5A5' },
    grid: [
      '..gg....gg..',
      '.gwkggggkwg.',
      '.gggggggggg.',
      '.gpggggggpg.',
      '..gddddddg..',
      '..gwwwwwwg..',
      '.ggwwwwwwgg.',
      '.ggwwwwwwgg.',
      '..gg....gg..',
      '.dd......dd.',
      '............',
      '............',
    ],
  },

  // B급 (4종) - 중거리 산책/도안 완성
  {
    id: 'shroom',
    name: '디스코버섯',
    grade: 'B',
    desc: '밤산책에 별빛이 반짝이는 신비 버섯',
    unlockHint: '1.5km 이상 완주 또는 4회 산책',
    accent: '#A855F7',
    palette: { v: '#9333EA', y: '#FDE047', w: '#FAF5FF', k: '#1E1B4B', p: '#F472B6' },
    grid: [
      '...vvvvvv...',
      '..vvyvvvyv..',
      '.vvvvvvpvvv.',
      '.vyvvvvvvvy.',
      'vvvvvvvvvvvv',
      '..wwwwwwww..',
      '..wwkwwkww..',
      '..wpwwwwpw..',
      '...wwwwww...',
      '...ww..ww...',
      '..vv....vv..',
      '............',
    ],
  },
  {
    id: 'squirrel',
    name: '숲속다람쥐',
    grade: 'B',
    desc: '가로수길마다 도토리를 챙기는 다람쥐',
    unlockHint: '1.5km 이상 완주 또는 4회 산책',
    accent: '#D97706',
    palette: { b: '#B45309', l: '#FCD34D', w: '#FFFBEB', k: '#1C1917', d: '#78350F' },
    grid: [
      '.bb......bd.',
      '.bll....bdd.',
      '..bbbbbbbdd.',
      '..bkbbbbkdd.',
      '..bwwkkwwdd.',
      '...bbbbbbdd.',
      '..bwwwwbbdd.',
      '.bbwwwwbbdd.',
      '..bbbbbbdd..',
      '..dd....dd..',
      '............',
      '............',
    ],
  },
  {
    id: 'shiba',
    name: '네온시바',
    grade: 'B',
    desc: '라임색 하네스를 맨 활기찬 시바견',
    unlockHint: '1.5km 이상 완주 또는 4회 산책',
    accent: '#C8FF4D',
    palette: { o: '#F59E0B', w: '#FFFBEB', k: '#111827', l: '#C8FF4D', d: '#B45309' },
    grid: [
      '.dd......dd.',
      '.doooooooood',
      '.oowoooowoo.',
      '.ookoooooko.',
      '.oowwkkwwoo.',
      '..owwwwwwo..',
      '..ollllllo..',
      '.oowwwwwwoo.',
      '.oowwwwwwoo.',
      '..oo....oo..',
      '..ww....ww..',
      '............',
    ],
  },
  {
    id: 'owl',
    name: '새벽부엉이',
    grade: 'B',
    desc: '고요한 새벽 공기를 지키는 부엉이',
    unlockHint: '1.5km 이상 완주 또는 4회 산책',
    accent: '#818CF8',
    palette: { b: '#4F46E5', w: '#E0E7FF', y: '#FACC15', k: '#0F172A', c: '#A5B4FC' },
    grid: [
      '.bb......bb.',
      '.bbbbbbbbbb.',
      '.bwwbwwbwwb.',
      '.bwkbwwbkwb.',
      '.bwwbyybwwb.',
      '..bccccccb..',
      '.bbccccccbb.',
      '.bbcwwwwcbb.',
      '..bbccccbb..',
      '...yy..yy...',
      '............',
      '............',
    ],
  },

  // A급 (4종) - 장거리/꾸준한 러너
  {
    id: 'fox',
    name: '별빛여우',
    grade: 'A',
    desc: '도시의 별빛을 따라 달리는 영리한 여우',
    unlockHint: '3km 이상 완주 또는 누적 8km',
    accent: '#F97316',
    palette: { o: '#EA580C', w: '#FFF7ED', k: '#111827', y: '#FDE047', d: '#9A3412' },
    grid: [
      '.oo......oo.',
      '.odo....odo.',
      '.oooooooooo.',
      '.okoooooook.',
      '.owwokkkoow.',
      '..owwwwwwo..',
      '..oyyyyyyo..',
      '.ooowwwwoow.',
      '..oowwwwoow.',
      '..dd....ww..',
      '............',
      '............',
    ],
  },
  {
    id: 'retriever',
    name: '황금리트리버',
    grade: 'A',
    desc: '언제든 끝까지 함께 달리는 든든한 친구',
    unlockHint: '3km 이상 완주 또는 누적 8km',
    accent: '#FBBF24',
    palette: { y: '#FBBF24', l: '#FEF08A', d: '#D97706', k: '#111827', s: '#5EC8FF' },
    grid: [
      '.dd......dd.',
      '.dyyyyyyyyd.',
      '.dykyyyykyd.',
      '.dyyyllyyyd.',
      '..yyyllkyy..',
      '..yssssssy..',
      '.yyyyyyyyyy.',
      '.yyllllllyy.',
      '..yyyyyyyy..',
      '..dd....dd..',
      '............',
      '............',
    ],
  },
  {
    id: 'panda',
    name: '대나무판다',
    grade: 'A',
    desc: '느긋하지만 꾸준하게 완주하는 판다',
    unlockHint: '3km 이상 완주 또는 누적 8km',
    accent: '#34D399',
    palette: { w: '#F8FAFC', k: '#0F172A', g: '#34D399', c: '#CBD5E1' },
    grid: [
      '.kk......kk.',
      '.kwwwwwwwwk.',
      '.wkkwwwwkkw.',
      '.wkwwwwwwkw.',
      '.wwwwkkwwww.',
      '..cwwwwwwc..',
      '.kkwwwwwwkk.',
      '.kkwwwwwwkk.',
      '..kkggggkk..',
      '..kk....kk..',
      '............',
      '............',
    ],
  },
  {
    id: 'penguin',
    name: '우주펭귄',
    grade: 'A',
    desc: '헬멧을 쓰고 달리는 모험가 펭귄',
    unlockHint: '3km 이상 완주 또는 누적 8km',
    accent: '#38BDF8',
    palette: { b: '#1E293B', w: '#F8FAFC', o: '#F97316', s: '#7DD3FC', k: '#020617' },
    grid: [
      '...ssssss...',
      '..sbbbbbbss.',
      '..sbwwwwbbs.',
      '..sbkwwkbbs.',
      '..sbwoowbbs.',
      '..bwwwwwwb..',
      '.bbwwwwwwbb.',
      '.bbwwwwwwbb.',
      '..bwwwwwwb..',
      '...oo..oo...',
      '............',
      '............',
    ],
  },

  // S급 (4종) - 5km+ / 누적 마스터
  {
    id: 'alpaca',
    name: '무지개알파카',
    grade: 'S',
    desc: '무지개 목도리를 두른 전설의 알파카',
    unlockHint: '5km 이상 완주 또는 누적 20km',
    accent: '#F472B6',
    palette: { w: '#FFFDF7', r: '#FB7185', y: '#FACC15', b: '#38BDF8', k: '#1E293B' },
    grid: [
      '..ww....ww..',
      '..wwwwwwww..',
      '..wkwwwwkw..',
      '..wwwwwwww..',
      '...rryybb...',
      '...wwwwww...',
      '..wwwwwwww..',
      '.wwwwwwwwww.',
      '.wwwwwwwwww.',
      '..ww....ww..',
      '..rr....bb..',
      '............',
    ],
  },
  {
    id: 'dragon',
    name: '천둥용',
    grade: 'S',
    desc: '번개처럼 빠른 러너와 함께하는 미니 드래곤',
    unlockHint: '5km 이상 완주 또는 누적 20km',
    accent: '#6EF3B6',
    palette: { g: '#10B981', l: '#6EF3B6', y: '#FDE047', k: '#022C22', w: '#ECFDF5' },
    grid: [
      '.yy......yy.',
      '..gggggggg..',
      '.ggkggggkgg.',
      '.gggggggggg.',
      '..gllllllg..',
      '.wgllyyllgw.',
      '.wggggggggw.',
      '..gllllllg..',
      '..gg....gg..',
      '.ll......ll.',
      '............',
      '............',
    ],
  },
  {
    id: 'unicorn',
    name: '별빛유니콘',
    grade: 'S',
    desc: '걸을 때마다 반짝이는 뿔을 가진 유니콘',
    unlockHint: '5km 이상 완주 또는 누적 20km',
    accent: '#E879F9',
    palette: { w: '#FDF4FF', y: '#FDE047', p: '#E879F9', b: '#60A5FA', k: '#1E1B4B' },
    grid: [
      '.....yy.....',
      '....pyyp....',
      '...wwwwww...',
      '..pwkwwkwp..',
      '..bwwwwwwb..',
      '...wwwwww...',
      '..pwwwwwwp..',
      '.bbwwwwwwbb.',
      '..wwwwwwww..',
      '..ww....ww..',
      '..yy....yy..',
      '............',
    ],
  },
  {
    id: 'phoenix',
    name: '불꽃피닉스',
    grade: 'S',
    desc: '끝없이 달리는 열정의 황금 불새',
    unlockHint: '5km 이상 완주 또는 누적 20km',
    accent: '#FB7185',
    palette: { r: '#EF4444', o: '#F97316', y: '#FDE047', w: '#FFFBEB', k: '#1C1917' },
    grid: [
      '....y..y....',
      '...rorror...',
      '..rrrrrrrr..',
      '..rkoyyokr..',
      '.yrrrrrrrrr.',
      '.yoorwwrooy.',
      '.yoorwwrooy.',
      '..yoorrooy..',
      '...yroory...',
      '....y..y....',
      '............',
      '............',
    ],
  },
];

export function partnerById(id: string | null | undefined): PartnerDef | null {
  if (!id) return null;
  return PARTNERS.find((p) => p.id === id) ?? null;
}

export function partnerSvgString(p: PartnerDef, locked = false): string {
  const rects: string[] = [];
  for (let y = 0; y < p.grid.length; y++) {
    const row = p.grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const fill = locked ? '#1A2330' : (p.palette[ch] ?? '#FFFFFF');
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}" />`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

export function partnerSvgDataUrl(p: PartnerDef, locked = false): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(partnerSvgString(p, locked))}`;
}

/** 산책 완료 시 거리·누적 거리에 따라 만날 수 있는 파트너 추첨 */
export function pickRewardPartner(
  walkDistanceM: number,
  totalDistanceM: number,
  ownedCounts: Record<string, number>,
): PartnerDef {
  let allowedGrades: PartnerGrade[] = ['D'];
  if (walkDistanceM >= 5000 || totalDistanceM >= 20000) {
    allowedGrades = ['D', 'C', 'B', 'A', 'S'];
  } else if (walkDistanceM >= 3000 || totalDistanceM >= 8000) {
    allowedGrades = ['D', 'C', 'B', 'A'];
  } else if (walkDistanceM >= 1500 || totalDistanceM >= 4000) {
    allowedGrades = ['D', 'C', 'B'];
  } else if (walkDistanceM >= 600 || totalDistanceM >= 1200) {
    allowedGrades = ['D', 'C'];
  }

  const pool = PARTNERS.filter((p) => allowedGrades.includes(p.grade));
  // 아직 없는 파트너가 있으면 우선적으로 높은 등급 쪽에서 해금 확률 우대
  const unowned = pool.filter((p) => !ownedCounts[p.id]);
  if (unowned.length > 0) {
    // 가장 높은 허용 등급 우선
    for (let g = allowedGrades.length - 1; g >= 0; g--) {
      const tierUnowned = unowned.filter((p) => p.grade === allowedGrades[g]);
      if (tierUnowned.length > 0) {
        return tierUnowned[Math.floor(Math.random() * tierUnowned.length)];
      }
    }
  }
  return pool[Math.floor(Math.random() * pool.length)] ?? PARTNERS[0];
}
