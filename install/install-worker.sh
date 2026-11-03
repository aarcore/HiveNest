#!/usr/bin/env bash
# HiveNest Worker installer (Linux). Requires root.
# Idempotent: safe to re-run; updates binary/env/unit and restarts service.
set -euo pipefail

VERSION="${HIVENEST_VERSION:-0.3.0-dev}"
PREFIX="${HIVENEST_PREFIX:-/usr/local}"
BIN_PATH="${PREFIX}/bin/hivenest-worker"
CONF_DIR="${HIVENEST_CONF_DIR:-/etc/hivenest}"
ENV_FILE="${CONF_DIR}/worker.env"
UNIT_PATH="/etc/systemd/system/hivenest-worker.service"
UNIT_SRC_NAME="hivenest-worker.service"

log()  { printf '+ %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

[[ "$(id -u)" -eq 0 ]] || die "must run as root (try: sudo ...)"

need systemctl
need uname
need mktemp

ARCH_RAW="$(uname -m)"
case "${ARCH_RAW}" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported arch: ${ARCH_RAW} (need amd64 or arm64)" ;;
esac

QUEEN_URL="${HIVENEST_QUEEN_URL:-}"
TOKEN="${HIVENEST_BOOTSTRAP_TOKEN:-}"
NODE_ID="${HIVENEST_NODE_ID:-}"
REGION="${HIVENEST_REGION:-}"
COUNTRY="${HIVENEST_COUNTRY:-}"
PUBLIC_URL="${HIVENEST_PUBLIC_URL:-}"
ARTIFACT_BASE="${HIVENEST_ARTIFACT_BASE:-}"
LOCAL_BINARY="${HIVENEST_LOCAL_BINARY:-}"
INSTALL_BASE="${HIVENEST_INSTALL_BASE:-}"

[[ -n "${QUEEN_URL}" ]] || die "set HIVENEST_QUEEN_URL (e.g. ws://queen.example:8080/v1/worker/ws)"
[[ -n "${TOKEN}" ]] || die "set HIVENEST_BOOTSTRAP_TOKEN"

if [[ -z "${ARTIFACT_BASE}" && -n "${PUBLIC_URL}" ]]; then
  ARTIFACT_BASE="${PUBLIC_URL%/}/releases"
fi
if [[ -z "${INSTALL_BASE}" && -n "${PUBLIC_URL}" ]]; then
  INSTALL_BASE="${PUBLIC_URL%/}/install"
fi

ASSET="hivenest-worker-linux-${ARCH}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

fetch() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" -o "${out}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${out}" "${url}"
  else
    die "need curl or wget to download ${url}"
  fi
}

install_binary() {
  local src="$1"
  install -d -m 0755 "$(dirname "${BIN_PATH}")"
  install -m 0755 "${src}" "${BIN_PATH}"
  log "installed ${BIN_PATH} (${ARCH})"
}

if [[ -n "${LOCAL_BINARY}" ]]; then
  [[ -f "${LOCAL_BINARY}" ]] || die "HIVENEST_LOCAL_BINARY not found: ${LOCAL_BINARY}"
  install_binary "${LOCAL_BINARY}"
elif [[ -f "./dist/${ASSET}" ]]; then
  install_binary "./dist/${ASSET}"
elif [[ -f "./${ASSET}" ]]; then
  install_binary "./${ASSET}"
elif [[ -n "${ARTIFACT_BASE}" ]]; then
  log "downloading ${ARTIFACT_BASE%/}/${ASSET}"
  fetch "${ARTIFACT_BASE%/}/${ASSET}" "${TMP}/${ASSET}"
  install_binary "${TMP}/${ASSET}"
else
  die "no worker binary: set HIVENEST_LOCAL_BINARY, place dist/${ASSET}, or set HIVENEST_PUBLIC_URL / HIVENEST_ARTIFACT_BASE"
fi

install -d -m 0755 "${CONF_DIR}"
# Preserve existing NODE_ID if not provided and file already has one
if [[ -z "${NODE_ID}" && -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  NODE_ID="$(grep -E '^HIVENEST_NODE_ID=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || true)"
fi
if [[ -z "${NODE_ID}" ]]; then
  if command -v uuidgen >/dev/null 2>&1; then
    NODE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  else
    NODE_ID="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s)-${ARCH}"
  fi
fi

umask 077
cat > "${ENV_FILE}" <<ENV
# Managed by HiveNest install-worker.sh (${VERSION})
HIVENEST_QUEEN_URL=${QUEEN_URL}
HIVENEST_BOOTSTRAP_TOKEN=${TOKEN}
HIVENEST_NODE_ID=${NODE_ID}
HIVENEST_REGION=${REGION}
HIVENEST_COUNTRY=${COUNTRY}
ENV
chmod 0600 "${ENV_FILE}"
log "wrote ${ENV_FILE}"

UNIT_SRC=""
if [[ -f "./install/${UNIT_SRC_NAME}" ]]; then
  UNIT_SRC="./install/${UNIT_SRC_NAME}"
elif [[ -f "./${UNIT_SRC_NAME}" ]]; then
  UNIT_SRC="./${UNIT_SRC_NAME}"
elif [[ -n "${INSTALL_BASE}" ]]; then
  fetch "${INSTALL_BASE%/}/${UNIT_SRC_NAME}" "${TMP}/${UNIT_SRC_NAME}"
  UNIT_SRC="${TMP}/${UNIT_SRC_NAME}"
fi
[[ -n "${UNIT_SRC}" ]] || die "cannot find ${UNIT_SRC_NAME}"

install -m 0644 "${UNIT_SRC}" "${UNIT_PATH}"
log "installed ${UNIT_PATH}"

systemctl daemon-reload
systemctl enable hivenest-worker.service >/dev/null
systemctl restart hivenest-worker.service
sleep 1
systemctl --no-pager --full status hivenest-worker.service || true

log "done. node_id=${NODE_ID}"
log "check: journalctl -u hivenest-worker -f"
