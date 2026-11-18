#!/usr/bin/env bash
# WalkDraw OCI 서버 배포/갱신 (프론트 + API). 몇 번을 실행해도 같은 결과가 나온다.
#
#   사용법:  sudo GOOGLE_CLIENT_ID=<클라이언트 ID> bash /opt/walkdraw/server/deploy-oci.sh
#            (클라이언트 ID 없이 실행하면 로그인 없이 프론트만 갱신)
#            /etc/walkdraw/deploy.env 에 GOOGLE_CLIENT_ID=... 가 있으면 그 값을 쓴다
#            (GitHub Actions 자동 배포는 이 방식 — server/setup-autodeploy.sh 참고)
#
# 하는 일
#   1) /opt/walkdraw 최신 main 받기
#   2) API 컨테이너(walkdraw-api) 빌드·재시작 — 127.0.0.1:8787, 데이터는 /opt/walkdraw-data
#   3) 프론트 테스트·빌드 (node:22-alpine 컨테이너, --base=/)
#   4) Caddy walkdraw 블록에 /api 연결이 없으면 백업 후 교체 → validate 실패 시 자동 복구
#   5) 헬스 체크
set -euo pipefail

APP_DIR=/opt/walkdraw
DATA_DIR=/opt/walkdraw-data
DOMAIN=walkdraw.129.203.174.119.sslip.io
CADDYFILE=/etc/caddy/Caddyfile
ENV_FILE=/etc/walkdraw/deploy.env
LOCK_FILE=/run/walkdraw-deploy.lock

# SSH 연결이 끊겨도(예: Actions 취소) 배포는 끝까지 진행
trap '' HUP

if [ -z "${GOOGLE_CLIENT_ID:-}" ] && [ -r "$ENV_FILE" ]; then
  GOOGLE_CLIENT_ID="$(sed -n 's/^GOOGLE_CLIENT_ID=//p' "$ENV_FILE" | head -n1 | tr -d '[:space:]')"
fi
CLIENT_ID="${GOOGLE_CLIENT_ID:-}"

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "sudo로 실행해 주세요."
[ -d "$APP_DIR/.git" ] || die "$APP_DIR 에 저장소가 없어요."

if [ -z "${WALKDRAW_DEPLOY_STAGE:-}" ]; then
  # 동시에 두 번 돌지 않게 (먼저 시작한 배포가 끝날 때까지 기다림). fd 9는 아래 exec 후에도 유지된다.
  exec 9>"$LOCK_FILE"
  flock 9

  say "1/5 최신 코드 받기"
  git -C "$APP_DIR" checkout -q main
  git -C "$APP_DIR" pull -q --ff-only origin main || die "git pull 실패 — 서버에서 직접 고친 파일이 있는지 확인해 주세요 (git -C $APP_DIR status)."
  git -C "$APP_DIR" log --oneline -1

  # 방금 받은 최신 버전의 이 스크립트로 나머지 단계를 실행 (실행 중인 파일이 바뀌는 문제 방지)
  export WALKDRAW_DEPLOY_STAGE=2 GOOGLE_CLIENT_ID="$CLIENT_ID"
  exec bash "$APP_DIR/server/deploy-oci.sh"
fi

if [ -n "$CLIENT_ID" ]; then
  say "2/5 API 컨테이너 빌드·재시작"
  mkdir -p "$DATA_DIR"
  chown 1000:1000 "$DATA_DIR"
  docker build -q -t walkdraw-api "$APP_DIR/server"
  docker rm -f walkdraw-api >/dev/null 2>&1 || true
  docker run -d --name walkdraw-api --restart unless-stopped \
    -p 127.0.0.1:8787:8787 \
    -v "$DATA_DIR":/data \
    -e GOOGLE_CLIENT_ID="$CLIENT_ID" \
    walkdraw-api >/dev/null
  for _ in $(seq 1 20); do
    curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1 && break
    sleep 0.5
  done
  curl -fsS http://127.0.0.1:8787/api/health >/dev/null || { docker logs --tail 30 walkdraw-api; die "API가 뜨지 않았어요."; }
  echo "API OK"
  printf 'VITE_GOOGLE_CLIENT_ID=%s\n' "$CLIENT_ID" > "$APP_DIR/.env.local"
else
  say "2/5 GOOGLE_CLIENT_ID 없음 → API·로그인 건너뜀 (프론트만 갱신)"
fi

say "3/5 프론트 테스트·빌드"
docker run --rm -v "$APP_DIR":/app -w /app node:22-alpine \
  sh -c 'npm ci --no-audit --no-fund && npm test && npx tsc --noEmit && npx vite build --base=/'

say "4/5 Caddy /api 연결 확인"
if [ -n "$CLIENT_ID" ]; then
  if grep -q 'reverse_proxy 127.0.0.1:8787' "$CADDYFILE"; then
    echo "이미 연결돼 있어요."
  else
    BACKUP="$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"
    cp "$CADDYFILE" "$BACKUP"
    # 기존 walkdraw 블록(첫 줄 "<도메인> {" ~ 같은 들여쓰기의 "}")을 지우고 새 블록을 붙인다
    awk -v d="$DOMAIN" '
      $0 ~ "^"d"[[:space:]]*\\{" { skip=1; next }
      skip && /^}/ { skip=0; next }
      !skip { print }
    ' "$BACKUP" > "$CADDYFILE"
    grep -v '^#' "$APP_DIR/server/Caddyfile.walkdraw" >> "$CADDYFILE"
    if caddy validate --config "$CADDYFILE" >/dev/null 2>&1; then
      systemctl reload caddy
      echo "Caddy 갱신 완료 (백업: $BACKUP)"
    else
      cp "$BACKUP" "$CADDYFILE"
      die "Caddy 설정 검증 실패 → 원래대로 복구했어요. server/Caddyfile.walkdraw 를 보고 직접 반영해 주세요."
    fi
  fi
else
  echo "건너뜀"
fi

say "5/5 헬스 체크"
curl -fsS -o /dev/null -w "프론트 https://$DOMAIN/  → %{http_code}\n" "https://$DOMAIN/"
if [ -n "$CLIENT_ID" ]; then
  curl -fsS -w "\nAPI    https://$DOMAIN/api/health → %{http_code}\n" "https://$DOMAIN/api/health"
fi
say "배포 완료"
