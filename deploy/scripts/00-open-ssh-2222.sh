#!/usr/bin/env bash
# PASTE THIS INTO THE LISH CONSOLE (Linode Cloud Manager -> donald -> Launch LISH
# Console), logged in as root. It is the one step that cannot be automated from
# the laptop, because the laptop cannot reach the box on port 22 at all.
#
# WHY: on the network this was authored from, TCP to 45.33.12.143:22 completes
# its handshake and then no SSH banner ever arrives (verified: a raw socket read
# times out after 90s, while ports 80/443/12345 return an immediate RST from the
# same host, and github.com:22 / gitlab.com:22 return their banners instantly).
# So the port-22 payload specifically is being dropped somewhere on the path.
# Ubuntu 24.04 socket-activates sshd, which is why adding a Port line to
# sshd_config alone is not enough — ssh.socket owns the listener.
set -euo pipefail

install -d -m 700 /root/.ssh
KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAqbS217KdGN2Gj5cJe38b852nlYDDLa1Gv44MLjbOll'
grep -qxF "$KEY" /root/.ssh/authorized_keys 2>/dev/null || echo "$KEY" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

cat > /etc/ssh/sshd_config.d/99-donald.conf <<'EOF'
Port 22
Port 2222
PermitRootLogin prohibit-password
PasswordAuthentication no
EOF

# Hand the listener back to sshd itself so the extra Port takes effect.
systemctl disable --now ssh.socket || true
systemctl unmask ssh.service || true
systemctl enable --now ssh.service
systemctl restart ssh.service

ss -lntp | grep -E ':(22|2222)\b' || true
echo "OK: sshd now listens on 22 and 2222"
