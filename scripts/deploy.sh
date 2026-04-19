#!/usr/bin/env bash

set -euo pipefail

APP_NAME="${APP_NAME:-task-tracker}"
APP_USER="${APP_USER:-${SUDO_USER:-$USER}}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_PORT="${APP_PORT:-18000}"
APP_BASE_PATH_RAW="${APP_BASE_PATH:-/tasks}"
APP_BASE_PATH="${APP_BASE_PATH_RAW%/}"
APP_BASE_PATH="${APP_BASE_PATH:-/}"
SERVICE_NAME="${SERVICE_NAME:-${APP_NAME}.service}"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
APACHE_CONF_NAME="${APACHE_CONF_NAME:-${APP_NAME}.conf}"
APACHE_CONF_PATH="/etc/apache2/conf-available/${APACHE_CONF_NAME}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
NODE_BIN="${NODE_BIN:-node}"
NPM_BIN="${NPM_BIN:-npm}"
VENV_DIR="${VENV_DIR:-${APP_DIR}/.venv}"
ENV_FILE="${ENV_FILE:-/etc/${APP_NAME}.env}"

if [[ "${APP_BASE_PATH}" != /* ]]; then
  echo "APP_BASE_PATH must start with '/'. Current value: ${APP_BASE_PATH}" >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required for systemd and Apache configuration." >&2
  exit 1
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Missing Python interpreter: ${PYTHON_BIN}" >&2
  exit 1
fi

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Missing Node.js binary: ${NODE_BIN}" >&2
  exit 1
fi

if ! command -v "$NPM_BIN" >/dev/null 2>&1; then
  echo "Missing npm binary: ${NPM_BIN}" >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/backend/app.py" || ! -f "${APP_DIR}/package.json" ]]; then
  echo "APP_DIR does not look like this project: ${APP_DIR}" >&2
  exit 1
fi

echo "Deploying ${APP_NAME}"
echo "  app dir: ${APP_DIR}"
echo "  app user: ${APP_USER}:${APP_GROUP}"
echo "  bind: 127.0.0.1:${APP_PORT}"
echo "  base path: ${APP_BASE_PATH}"

sudo install -d -m 0755 -o "$APP_USER" -g "$APP_GROUP" "${APP_DIR}/data" "${APP_DIR}/data/uploads"

if [[ ! -d "${VENV_DIR}" ]]; then
  "$PYTHON_BIN" -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/pip" install --upgrade pip
"${VENV_DIR}/bin/pip" install -r "${APP_DIR}/backend/requirements.txt"

if [[ -f "${APP_DIR}/package-lock.json" ]]; then
  "$NPM_BIN" ci --prefix "${APP_DIR}"
else
  "$NPM_BIN" install --prefix "${APP_DIR}"
fi

TASK_TRACKER_BASE_PATH="${APP_BASE_PATH}" "$NPM_BIN" run build --prefix "${APP_DIR}"

sudo tee "${ENV_FILE}" >/dev/null <<EOF
APP_PORT=${APP_PORT}
APP_BASE_PATH=${APP_BASE_PATH}
SECRET_KEY=${SECRET_KEY:-change-me-in-${ENV_FILE}}
EOF
sudo chmod 0640 "${ENV_FILE}"
sudo chown root:"${APP_GROUP}" "${ENV_FILE}" || true

sudo tee "${SERVICE_PATH}" >/dev/null <<EOF
[Unit]
Description=Task Tracker
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${VENV_DIR}/bin/gunicorn --bind 127.0.0.1:\${APP_PORT} --workers 2 --threads 4 backend.app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee "${APACHE_CONF_PATH}" >/dev/null <<EOF
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
RequestHeader set X-Forwarded-Prefix "${APP_BASE_PATH}"

RedirectMatch 302 ^${APP_BASE_PATH}$ ${APP_BASE_PATH}/
ProxyPass ${APP_BASE_PATH}/ http://127.0.0.1:${APP_PORT}/ retry=0
ProxyPassReverse ${APP_BASE_PATH}/ http://127.0.0.1:${APP_PORT}/
EOF

sudo a2enmod proxy proxy_http headers
sudo a2enconf "${APACHE_CONF_NAME}"
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"
sudo apache2ctl configtest
sudo systemctl reload apache2

echo
echo "Deployment complete."
echo "Service: ${SERVICE_NAME}"
echo "Apache config: ${APACHE_CONF_PATH}"
echo "Environment file: ${ENV_FILE}"
echo
echo "Next steps:"
echo "  1. Set a real SECRET_KEY in ${ENV_FILE}"
echo "  2. Restart the service: sudo systemctl restart ${SERVICE_NAME}"
echo "  3. Verify: curl -I http://127.0.0.1:${APP_PORT}/api/health"
