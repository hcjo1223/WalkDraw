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

## 자동 배포 (main 머지 → GitHub Pages + OCI)

`.github/workflows/deploy.yml`의 `deploy-oci` 잡이 테스트·빌드가 통과하면 SSH로 OCI 서버에 접속해 `deploy-oci.sh`를 실행합니다. `OCI_HOST` 변수가 없으면 이 잡은 건너뜁니다.

**최초 1회 설정 (서버에서)**

```bash
cd /opt/walkdraw && sudo git pull --ff-only
sudo GOOGLE_CLIENT_ID=<클라이언트 ID> bash server/setup-autodeploy.sh
```

출력된 값을 GitHub 저장소 **Settings → Secrets and variables → Actions**에 등록:

| 종류 | 이름 | 값 |
| --- | --- | --- |
| Secret | `OCI_SSH_KEY` | 출력된 비밀 키 전체 (`-----BEGIN` ~ `END-----`) |
| Variable | `OCI_HOST` | `129.203.174.119` |
| Variable | `OCI_KNOWN_HOSTS` | 출력된 `129.203.174.119 ssh-ed25519 AAAA...` 한 줄 |
| Variable | `GOOGLE_CLIENT_ID` | (Pages 빌드용, 이미 등록했다면 생략) |

OCI 보안 목록(Security List)에서 22번 포트가 인터넷에 열려 있어야 합니다(OCI 기본값).

**보안 설계**

- 배포 전용 계정 `walkdraw-deploy` (비밀번호 잠김, 키 로그인만)
- 배포 키는 `authorized_keys`의 `command=`로 **`deploy-oci.sh` 실행만** 가능 — 다른 명령을 보내도 무시되고, 셸·포트 포워딩·에이전트 포워딩 불가
- sudoers는 `deploy-oci.sh` 하나만 root로 허용
- `GOOGLE_CLIENT_ID`는 서버의 `/etc/walkdraw/deploy.env`(root 전용)에만 보관
- Actions는 `OCI_KNOWN_HOSTS`로 서버 호스트 키를 엄격히 확인(중간자 공격 방지)
- 주의: `deploy-oci.sh`는 저장소에 있으므로 **main에 머지할 수 있는 사람은 서버에서 root로 실행되는 내용을 바꿀 수 있습니다.** main 브랜치 보호를 켜 두는 것을 권장합니다.
- 키를 바꾸려면 `setup-autodeploy.sh`를 다시 실행하고 Secret을 새 값으로 교체(이전 키는 즉시 무효)

**배포 스크립트 안전장치**: `flock`으로 동시 실행 방지(순서대로 실행), SSH가 끊겨도 끝까지 진행(`trap '' HUP`), 코드를 받은 뒤 **새 버전 스크립트로 다시 실행**, Caddy 교체 시 백업·검증 실패 시 자동 복구.

## OCI 서버 배포 — 스크립트 한 번

```bash
cd /opt/walkdraw && sudo git pull --ff-only
sudo GOOGLE_CLIENT_ID=<클라이언트 ID> bash server/deploy-oci.sh
```

코드 받기 → API 컨테이너 재시작 → 프론트 테스트·빌드 → Caddy `/api` 연결(없을 때만, 백업 후 교체·검증 실패 시 자동 복구) → 헬스 체크까지 한 번에 합니다. 다시 실행해도 안전하고, 이후 갱신도 같은 명령입니다. 아래는 같은 내용을 손으로 하는 방법입니다.

## OCI 서버 배포 (수동)

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
