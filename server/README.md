# walkdraw-api

WalkDraw 로그인·동기화 API. 의존성은 `jose`(Google 토큰 검증) 하나이고, DB는 Node 22 내장 SQLite(`node:sqlite`) 파일 하나입니다.

- **로그인**: 앱이 Google 로그인 버튼으로 받은 ID 토큰을 `POST /api/auth/google`로 보내면, 서버가 Google 공개키(JWKS)로 서명·발급자·대상(`aud` = `GOOGLE_CLIENT_ID`)·만료를 검증하고 60일짜리 세션 토큰을 발급합니다. 세션 토큰은 DB에 SHA-256 해시로만 저장됩니다.
- **데이터**: `walks` · `saved_routes` · `partner_states` — 모든 쿼리가 로그인한 사용자 ID로 범위가 제한됩니다.
- 엔드포인트 목록은 [`src/app.js`](src/app.js) 상단 주석 참고.

## 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | (필수) | 앱의 `VITE_GOOGLE_CLIENT_ID`와 같은 OAuth 웹 클라이언트 ID |
| `DB_FILE` | `/data/walkdraw.db` | SQLite 파일 경로 |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `ALLOWED_ORIGINS` | `https://walkdraw.129.203.174.119.sslip.io,https://hcjo1223.github.io,http://localhost:5173` | CORS 허용 출처(쉼표 구분) |

## OCI 서버 배포 (최초 1회)

```bash
cd /opt/walkdraw && sudo git pull

# 1) API 컨테이너 — 127.0.0.1에만 열고 Caddy가 /api 를 넘겨준다
sudo docker build -t walkdraw-api server
sudo mkdir -p /opt/walkdraw-data && sudo chown 1000:1000 /opt/walkdraw-data
sudo docker run -d --name walkdraw-api --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v /opt/walkdraw-data:/data \
  -e GOOGLE_CLIENT_ID=<클라이언트 ID> \
  walkdraw-api
curl -s http://127.0.0.1:8787/api/health   # {"ok":true}

# 2) 프론트엔드 빌드 (Google 클라이언트 ID 포함)
echo 'VITE_GOOGLE_CLIENT_ID=<클라이언트 ID>' | sudo tee .env.local
sudo docker run --rm -v /opt/walkdraw:/app -w /app node:22-alpine \
  sh -c 'npm ci && npm test && npx tsc --noEmit && npx vite build --base=/'

# 3) Caddy: 기존 walkdraw 블록을 server/Caddyfile.walkdraw 내용으로 교체
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
curl -s https://walkdraw.129.203.174.119.sslip.io/api/health
```

## 갱신

```bash
cd /opt/walkdraw && sudo git pull
sudo docker build -t walkdraw-api server && sudo docker rm -f walkdraw-api && sudo docker run -d ...(위와 동일)
sudo docker run --rm -v /opt/walkdraw:/app -w /app node:22-alpine \
  sh -c 'npm ci && npm test && npx tsc --noEmit && npx vite build --base=/'
```

## 백업

DB는 `/opt/walkdraw-data/walkdraw.db` 파일 하나입니다. `sqlite3 walkdraw.db ".backup walkdraw-$(date +%F).db"` 또는 컨테이너를 잠시 멈추고 파일 복사.

## 로컬 개발

```bash
cd server && npm install
GOOGLE_CLIENT_ID=<ID> DB_FILE=./dev.db npm start      # :8787
# 프론트: .env.local 에 VITE_API_URL=http://localhost:8787
```

테스트는 저장소 루트에서 `npm test` (server/test 포함).
