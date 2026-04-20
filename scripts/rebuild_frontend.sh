#!/usr/bin/env bash

set -euo pipefail

normalize_base_path() {
  local value="${1:-/}"
  if [[ -z "${value}" || "${value}" == "/" ]]; then
    printf '/'
    return
  fi
  if [[ "${value}" != /* ]]; then
    value="/${value}"
  fi
  value="${value%/}"
  printf '%s' "${value:-/}"
}

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_NAME="${APP_NAME:-task-tracker}"
SERVICE_NAME="${SERVICE_NAME:-${APP_NAME}.service}"
ENV_FILE="${ENV_FILE:-/etc/${APP_NAME}.env}"
NPM_BIN="${NPM_BIN:-npm}"

if ! command -v "${NPM_BIN}" >/dev/null 2>&1; then
  echo "Missing npm binary: ${NPM_BIN}" >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "APP_DIR does not look like this project: ${APP_DIR}" >&2
  exit 1
fi

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "Environment file is missing or not readable: ${ENV_FILE}" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

APP_BASE_PATH="$(normalize_base_path "${APP_BASE_PATH:-/tasks}")"

echo "Rebuilding frontend"
echo "  app dir: ${APP_DIR}"
echo "  env file: ${ENV_FILE}"
echo "  base path: ${APP_BASE_PATH}"
echo "  service: ${SERVICE_NAME}"

if [[ -f "${APP_DIR}/package-lock.json" ]]; then
  "${NPM_BIN}" ci --prefix "${APP_DIR}"
else
  "${NPM_BIN}" install --prefix "${APP_DIR}"
fi

TASK_TRACKER_BASE_PATH="${APP_BASE_PATH}" "${NPM_BIN}" run build --prefix "${APP_DIR}"
sudo systemctl restart "${SERVICE_NAME}"

echo
echo "Frontend rebuild complete."
echo "Verify with:"
echo "  systemctl status ${SERVICE_NAME} --no-pager"
