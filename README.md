# WalkDraw · 발자취 스케치

걸어서 그리는 GPS 드로잉 & 코스 러닝 앱. 손그림이나 도안을 실제 걸을 수 있는 도보 길로 바꾸고, 동행 파트너와 함께 걸은 뒤 포스터 카드 · 타임랩스 영상 · 월말정산 달력으로 남깁니다.

> **산책온 · 발로그린그림 스타일의 올인원 GPS 아트 & 러닝** (로그인 없이도 100% 브라우저에서 동작 · 로그인하면 Supabase로 기기 간 동기화)

**라이브:** https://hcjo1223.github.io/WalkDraw/

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| **3가지 코스 설계** | ① **✏️ 그림/도안**: 점선 격자 스케치 패드(`사진 깔기`, 빠른 밑그림), 지도 위 직접 손그림, 10종 도안(`하트 · 고양이 · 별 · 달 · 나선 · 발바닥 · 원 · 집 · 산 · 번개`), **드래그(`✥`) · 회전(`↻`)**, **닮은 정도 % 포함 3개 보행 코스 후보 생성**<br>② **✨ AI 추천**: Nominatim 무료 장소 검색/지도 탭으로 경유지 지정, 왕복 순환/편도, 시간·거리·속도 맞춤 **3개 추천 코스 비교**<br>③ **📍 점 찍기**: 지도를 콕콕 찍어 원하는 길대로 자동 도보 경로 연결 |
| **실제 도보 네비게이션 (Eyes-Free)** | OSRM 보행자 도로(`routed-foot`) 기반 턴바이턴 안내, 진행률 바, **음성 안내(턴 + 1km 마일스톤)**, **🔒 오터치 방지 화면 잠금 모드**. |
| **시간·거리·속도 3단계 목표** | 시간 또는 거리 기준으로 목표를 정하고 **천천히 걷기(3.6 km/h) · 걷기(4.8 km/h) · 가볍게 뛰기(7.5 km/h)** 별 예상 거리/시간을 실시간 계산해 반영합니다. |
| **🐾 파트너 도감 (20종)** | D~S급 오리지널 픽셀 아트 동행 친구 20종. 첫 선물 `산책코기`를 받고 산책 완료 시 새 파트너를 해금해 지도 위에서 함께 걷습니다. |
| **📊 나의 기록 · 월말정산** | **달력** (일별 미니 경로 · `▶ 경로 재생` · **`✨ 월말정산 1080×1350 달력 포스터`**), **통계·배지** (주간 막대, 20주 히트맵, 8종 성취 배지), **🔖 찜한 코스** (`따라뛰기`). |
| **🎨 카드 스튜디오 · 영상 저장** | 지도 배경을 숨긴 1080×1350 포스터 PNG, **배경 색상 7종 · 내 사진 깔기 · 이모지 스티커 배치**, 타임랩스 재생 및 **`🎬 영상 저장`(MediaRecorder)** 지원. |
| **시뮬레이션 모드** | 실내 테스트: 지도 탭으로 점 찍기 + 자동 걷기로 네비게이션 · 피드백 · 파트너 · 포스터까지 전 기능을 GPS 없이 체험. |

## 스택

- Vite + React 19 + TypeScript + Tailwind CSS v4
- Leaflet + OpenStreetMap 타일 (API 키 불필요) — 다크 지도는 CSS 필터 반전 사용, 다크/밝은 지도 토글
- OSRM 보행자 경로 탐색 (`routing.openstreetmap.de/routed-foot`) + Nominatim 장소 검색 + 오프라인 직선 대체 안내
- 포스터 · 월말정산 · 타임랩스 영상은 **HTML5 Canvas + `captureStream()` 직접 렌더링**
- 로컬 저장: IndexedDB / `localStorage` (`walks`, `routes`, `partners`, `draft`)
- 로그인 · 동기화: Google Identity Services + Supabase (Auth + Postgres, RLS)

## 로그인 · 서버 (Google + Supabase)

Google 로그인 버튼(Google Identity Services)으로 받은 ID 토큰을 **Supabase Auth**(`signInWithIdToken`)가 서버에서 검증하고, 로그인한 계정에 **산책 기록 · 찜한 코스 · 파트너 도감**을 동기화합니다.

- **기기 우선(local-first)**: 앱은 항상 IndexedDB/localStorage를 먼저 쓰고, 로그인 중 변경은 대기열을 거쳐 서버로 올라갑니다. 오프라인이면 다음 동기화(앱 시작 · 온라인 복귀 · `지금 동기화`) 때 재시도합니다.
- 첫 로그인 시 이 기기의 기존 기록이 계정으로 올라가고, 다른 기기에서 저장한 기록은 내려받습니다. 삭제는 서버에 묘비(`deleted`)로 남겨 다른 기기에도 반영됩니다.
- 같은 기기에서 **다른 계정**으로 로그인하면 기록이 섞이지 않도록 기기 데이터를 새 계정 데이터로 교체합니다(이전 계정 데이터는 서버에 남아 있음).
- 로그인하지 않아도 모든 기능은 예전처럼 기기 저장만으로 동작합니다.

**서버 구성** — Supabase 프로젝트 `walkdraw` (서울 `ap-northeast-2`), 스키마: [`supabase/migrations/`](supabase/migrations/)

| 테이블 | 내용 |
| --- | --- |
| `walks` | 산책 기록 (`user_id`, `id`, `data jsonb`, `deleted`) |
| `saved_routes` | 찜한 코스 |
| `partner_states` | 파트너 도감 (유저당 1행) |

모든 테이블은 RLS로 **본인 행만** 읽고 쓸 수 있고, 익명(anon) 접근은 막혀 있습니다. Supabase URL과 publishable 키는 공개용 값이라 `.env`에 커밋되어 있습니다.

### 설정 (한 번만)

1. **Google Cloud Console** → [사용자 인증 정보](https://console.cloud.google.com/apis/credentials) → OAuth 클라이언트 ID(**웹 애플리케이션**) 생성
   - 승인된 JavaScript 원본: `https://hcjo1223.github.io`, `http://localhost:5173`, `http://localhost`
2. **Supabase 대시보드** → `walkdraw` 프로젝트 → **Authentication → Sign In / Providers → Google** 켜기
   - *Client IDs*에 위 클라이언트 ID 입력 (Client Secret은 이 방식에선 필수 아님) → 저장
3. **GitHub** → 저장소 **Settings → Secrets and variables → Actions → Variables**에 `GOOGLE_CLIENT_ID` 등록
4. 로컬: `.env.example`을 `.env.local`로 복사하고 `VITE_GOOGLE_CLIENT_ID` 입력

## 로컬 실행

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # tsc --noEmit && vite build → dist/
npm run preview       # 빌드 결과 확인
npm run build:single  # dist-single/index.html (단일 파일)
```

## 구조

```
.github/workflows/
  deploy.yml              main push 시 GitHub Pages 자동 빌드·배포
src/
  App.tsx                 3탭 내비게이션(산책하기/나의 기록/파트너), 코스 모드, Eyes-Free HUD, 완료 피드백 모달
  components/
    MapView.tsx           Leaflet 지도, 제스처 드래그/회전 핸들, 지도 위 손그림, 핀 마커, 파트너 스프라이트
    SketchPad.tsx         점선 격자 자유 스케치 패드 (사진 깔기 · 되돌리기 · 빠른 밑그림)
    RecordsView.tsx       달력 · 월말정산 포스터 · 경로 재생 · 통계/20주 히트맵/8배지 · 찜한 코스
    PartnersView.tsx      D~S급 20종 픽셀 파트너 도감 · 실루엣/해금/동행 설정
    AccountSheet.tsx      헤더 로그인/프로필 버튼 · Google 로그인 & 내 계정 시트(동기화 상태 · 지금 동기화 · 로그아웃)
    CardView.tsx          포스터 스튜디오(배경/사진/스티커) · 타임랩스 재생 & 영상/PNG 저장
  lib/
    geo.ts                거리·투영·RDP 단순화·Catmull-Rom 스무딩·포맷터
    guides.ts             도안 10종 정의, 정규화 XY 도형 투영·거리 기반 크기·경유지 샘플링
    pace.ts               시간/거리 목표 및 3단계 속도(천천히 걷기·걷기·가볍게 뛰기) 계산
    routing.ts            OSRM 도보 경로, Nominatim 검색, 닮은 정도(%), 스케치/AI 3코스 후보 생성
    partners.ts           20종 픽셀 아트 파트너 SVG 생성 및 산책 보상 추첨
    poster.ts             포스터 캔버스 렌더러(테마 7종·사진 배경·스티커·진행률)
    simulate.ts           자동 걷기(rAF), 데모 루프 생성
    storage.ts            IndexedDB/localStorage(산책 기록·찜한 코스·파트너·임시저장)
    auth.ts               Google 로그인(GIS 버튼 · nonce · Supabase signInWithIdToken · 세션 복원)
    supabase.ts           Supabase 클라이언트 (미설정 시 null → 기기 저장만)
    sync.ts               동기화 엔진(대기열 · 전체 동기화 계획 · 파트너 병합 · 계정 전환)
    cloud.ts              동기화 엔진 ↔ Supabase 테이블 어댑터
```
