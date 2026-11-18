#!/usr/bin/env bash
# GitHub Actions → OCI 자동 배포 준비 (서버에서 한 번만 실행).
#
#   사용법:  sudo GOOGLE_CLIENT_ID=<클라이언트 ID> bash /opt/walkdraw/server/setup-autodeploy.sh
#            (클라이언트 ID는 나중에 /etc/walkdraw/deploy.env 에 넣어도 된다)
#
# 만드는 것
#   - 배포 전용 계정 walkdraw-deploy (비밀번호 없음, 키 로그인만)
#   - 배포 전용 SSH 키: 이 키로 접속하면 **deploy-oci.sh 실행만** 가능 (셸·포트포워딩 불가)
#   - sudoers: walkdraw-deploy 는 deploy-oci.sh 하나만 root로 실행 가능
#   - /etc/walkdraw/deploy.env : GOOGLE_CLIENT_ID (서버에만 보관)
#
# 끝나면 GitHub 저장소에 등록할 값 3개(비밀 키 · known_hosts · 호스트)를 출력한다.
# 다시 실행하면 키를 새로 만든다(이전 키는 더 이상 동작하지 않음).
set -euo pipefail

DEPLOY_USER=walkdraw-deploy
SCRIPT=/opt/walkdraw/server/deploy-oci.sh
HOST_IP="${OCI_PUBLIC_IP:-129.203.174.119}"

die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "sudo로 실행해 주세요."
[ -x "$SCRIPT" ] || die "$SCRIPT 가 없어요. 먼저 /opt/walkdraw 에서 git pull 해 주세요."

# 1) 서버 전용 설정 파일
install -d -m 755 /etc/walkdraw
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then
  printf 'GOOGLE_CLIENT_ID=%s\n' "$GOOGLE_CLIENT_ID" > /etc/walkdraw/deploy.env
  chmod 600 /etc/walkdraw/deploy.env
fi

# 2) 배포 전용 계정
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/sh "$DEPLOY_USER"
fi
passwd -l "$DEPLOY_USER" >/dev/null 2>&1 || true
HOME_DIR="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"

# 3) 배포 전용 키 (명령 고정)
KEYDIR="$(mktemp -d)"
trap 'rm -rf "$KEYDIR"' EXIT
ssh-keygen -q -t ed25519 -N '' -C "walkdraw-github-actions" -f "$KEYDIR/key"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
printf 'command="sudo -n %s",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' \
  "$SCRIPT" "$(cat "$KEYDIR/key.pub")" > "$HOME_DIR/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"

# 4) sudoers — 배포 스크립트 하나만
SUDOERS_TMP="$KEYDIR/sudoers"
printf '%s ALL=(root) NOPASSWD: %s\n' "$DEPLOY_USER" "$SCRIPT" > "$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP" >/dev/null || die "sudoers 검증 실패"
install -m 440 "$SUDOERS_TMP" /etc/sudoers.d/walkdraw-deploy

# 5) sshd 가 이 계정을 막고 있는지 확인
if sshd -T 2>/dev/null | grep -qi '^allowusers '; then
  if ! sshd -T 2>/dev/null | grep -i '^allowusers ' | grep -qw "$DEPLOY_USER"; then
    printf '\n⚠️  sshd AllowUsers 에 %s 가 없어요. /etc/ssh/sshd_config 에 추가하고 sshd 를 reload 해 주세요.\n' "$DEPLOY_USER"
  fi
fi

HOST_KEY="$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"

cat <<EOF

✅ 서버 준비 완료. GitHub 저장소 → Settings → Secrets and variables → Actions 에 아래 값을 등록하세요.

[Secrets] OCI_SSH_KEY  (아래 BEGIN ~ END 전체)
$(cat "$KEYDIR/key")

[Variables] OCI_HOST
$HOST_IP

[Variables] OCI_KNOWN_HOSTS
$HOST_IP $HOST_KEY

(선택) [Variables] OCI_USER  — 기본값 $DEPLOY_USER

이 비밀 키는 지금 한 번만 보여요. 서버에는 남기지 않았어요.
EOF
