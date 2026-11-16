# WalkDraw · 발자취 스케치

걸어서 그리는 GPS 드로잉. 산책 경로가 그림이 되고, 마지막엔 지도를 지운 포스터 카드 한 장과 타임랩스로 남습니다.

> "내가 걷거나 달려서 그림을 만들자" — 자유 드로잉 · 도안 따라 걷기 · 그림 카드/타임랩스

**라이브:** https://hcjo1223.github.io/WalkDraw/

## 무엇을 할 수 있나

| 기능 | 설명 |
| --- | --- |
| **자유 드로잉** | 실시간 GPS(`watchPosition`)로 이동 경로를 지도 위에 부드러운 선으로 그립니다. 펜 색상 7가지 · 굵기 5단계, 시작/일시정지/재개/완료. |
| **도안 따라 걷기** | 하트·별·나선·강아지 발바닥·원·집·산·번개 8개 도안을 현재 위치 중심에 반투명 점선으로 띄웁니다. 크기(40~600m)·회전(0~359°), 지도를 눌러 위치 이동. |
| **그림 카드** | 완료하면 지도 배경을 숨기고 **순수 경로만** 1080×1350 포스터 PNG로 저장/공유 (거리·시간·페이스·날짜·제목 포함). |
| **타임랩스** | 0% → 100% 그려지는 과정을 0.7x/1x/1.6x 속도로 재생. |
| **시뮬레이션 모드** | 집 안에서 테스트: 지도 탭으로 점 찍기 + 자동 걷기(도안/데모 루프). GPS 없이 타임랩스·PNG까지 전부 확인. |
| **로컬 갤러리** | 로그인 없이 IndexedDB(막히면 localStorage)에 저장. 목록에서 다시 열어 PNG 저장 가능. |

## 스택

- Vite + React 19 + TypeScript + Tailwind CSS v4
- Leaflet + CARTO/OpenStreetMap 타일 (API 키 불필요, 다크/밝은 지도 토글)
- 포스터는 **HTML5 Canvas 직접 렌더링** — 타일을 캡처하지 않으므로 CORS 이슈가 없습니다
- PWA 매니페스트 (`standalone`, iPhone 홈 화면 추가 대응)

## 로컬 실행

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit && vite build  → dist/
npm run preview    # 빌드 결과 확인
npm run build:single  # dist-single/index.html (CSS·JS 인라인 단일 파일)
```

> GPS는 HTTPS 또는 localhost에서만 동작합니다. 집 안에서는 **시뮬레이션 모드**를 켜고 지도를 눌러 그리면 됩니다.
> iPhone Safari: 공유 → 홈 화면에 추가하면 전체 화면 앱처럼 열립니다.

## 저장소 만들고 올리기 (처음 한 번)

```bash
# GitHub CLI 사용 시 (저장소 생성 + 첫 push를 한 번에)
gh repo create hcjo1223/WalkDraw --public --source=. --push

# 또는 웹에서 빈 저장소(WalkDraw, public)를 만든 뒤
git remote add origin https://github.com/hcjo1223/WalkDraw.git
git push -u origin main
```

## 배포

### GitHub Pages (자동)

1. 저장소를 public으로 만들고 `main` 브랜치에 push
2. **Settings → Pages → Build and deployment → Source: GitHub Actions** 선택
3. `.github/workflows/deploy.yml`이 빌드·배포합니다 → `https://hcjo1223.github.io/WalkDraw/`

`vite.config.ts`의 `base: './'` 덕분에 하위 경로 배포에서도 자산 경로가 깨지지 않습니다.

### Vercel

- 저장소 import → Framework: **Vite** → Build `npm run build`, Output `dist` → 배포 끝.

## 구조

```
src/
  App.tsx                 화면·상태 머신 (idle/recording/paused), 하단 시트 UI
  components/
    MapView.tsx           Leaflet 지도, 경로/도안/내위치 레이어
    CardView.tsx          포스터 + 타임랩스 + PNG 저장/공유
    Gallery.tsx           저장된 그림 목록 (썸네일 캔버스)
  lib/
    geo.ts                거리·투영·RDP 단순화·Catmull-Rom 스무딩·포맷터
    guides.ts             도안 8종 정의(정규화 좌표) + 위경도 변환
    poster.ts             포스터 캔버스 렌더러(진행률 지원)
    simulate.ts           자동 걷기(rAF), 데모 루프 생성
    storage.ts            IndexedDB/localStorage 저장·임시저장(draft)
```

### 처리 흐름

1. GPS 점 → 1m 미만 떨림 무시, 150m 이상 점프는 `brk`(선 끊김)로 기록
2. 포스터: 로컬 평면(m) 투영 → RDP 1.4m 단순화 → Catmull-Rom 8샘플 → 캔버스에 맞춰 스케일
3. 진행률 렌더: 전체 길이 대비 목표 거리까지 잘라 그리기 (타임랩스)
4. 저장: 경로가 그대로 IndexedDB에 남아 나중에 다시 열어 PNG로 뽑을 수 있음

## 다음에 붙이면 좋은 것

- 경로 걸린 순서대로 색이 변하는 그라데이션 펜
- 도안을 지도 위에서 손가락으로 회전/확대 (지금은 슬라이더)
- 여러 산책을 이어 붙인 콜라주 카드
- Web Share Target / 서비스워커 오프라인 셸
