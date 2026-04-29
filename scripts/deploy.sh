#!/usr/bin/env bash

set -euo pipefail

MODE="full"
if [[ "${1:-}" == "--env-only" ]]; then
  MODE="env-only"
  shift
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: $0 [--env-only]"
  echo
  echo "  --env-only   Update only the environment file and restart the service."
  exit 0
fi

prompt_with_default() {
  local __var_name="$1"
  local prompt_label="$2"
  local default_value="$3"
  local input=""

  if [[ -t 0 && -t 1 ]]; then
    read -r -p "${prompt_label} [${default_value}]: " input
  fi

  if [[ -z "${input}" ]]; then
    printf -v "${__var_name}" '%s' "${default_value}"
  else
    printf -v "${__var_name}" '%s' "${input}"
  fi
}

prompt_secret_with_default() {
  local __var_name="$1"
  local prompt_label="$2"
  local default_value="$3"
  local input=""

  if [[ -t 0 && -t 1 ]]; then
    read -r -s -p "${prompt_label} [hidden]: " input
    echo
  fi

  if [[ -z "${input}" ]]; then
    printf -v "${__var_name}" '%s' "${default_value}"
  else
    printf -v "${__var_name}" '%s' "${input}"
  fi
}

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

validate_port() {
  local value="$1"
  [[ "${value}" =~ ^[0-9]+$ ]] || return 1
  (( value >= 1 && value <= 65535 ))
}

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
NODE_BIN="${NODE_BIN:-node}"
NPM_BIN="${NPM_BIN:-npm}"

APP_NAME_DEFAULT="${APP_NAME:-task-tracker}"
APP_USER_DEFAULT="${APP_USER:-${SUDO_USER:-$USER}}"
APP_GROUP_DEFAULT="${APP_GROUP:-${APP_GROUP:-${APP_USER_DEFAULT}}}"
APP_PORT_DEFAULT="${APP_PORT:-18000}"
APP_BASE_PATH_DEFAULT="$(normalize_base_path "${APP_BASE_PATH:-/tasks}")"
SECRET_KEY_DEFAULT="${SECRET_KEY:-change-me-in-/etc/${APP_NAME_DEFAULT}.env}"
MAILERSEND_API_TOKEN_DEFAULT="${MAILERSEND_API_TOKEN:-}"
MAILERSEND_FROM_EMAIL_DEFAULT="${MAILERSEND_FROM_EMAIL:-}"
MAILERSEND_FROM_NAME_DEFAULT="${MAILERSEND_FROM_NAME:-Task Tracker}"

prompt_with_default APP_NAME "Application name" "${APP_NAME_DEFAULT}"
prompt_with_default APP_USER "System user for the service" "${APP_USER_DEFAULT}"
prompt_with_default APP_GROUP "System group for the service" "${APP_GROUP_DEFAULT}"
prompt_with_default APP_PORT "Local bind port" "${APP_PORT_DEFAULT}"
prompt_with_default APP_BASE_PATH "Public app path" "${APP_BASE_PATH_DEFAULT}"

APP_BASE_PATH="$(normalize_base_path "${APP_BASE_PATH}")"
if ! validate_port "${APP_PORT}"; then
  echo "APP_PORT must be a number between 1 and 65535. Current value: ${APP_PORT}" >&2
  exit 1
fi

SERVICE_NAME_DEFAULT="${SERVICE_NAME:-${APP_NAME}.service}"
APACHE_CONF_NAME_DEFAULT="${APACHE_CONF_NAME:-${APP_NAME}.conf}"
ENV_FILE_DEFAULT="${ENV_FILE:-/etc/${APP_NAME}.env}"
VENV_DIR_DEFAULT="${VENV_DIR:-${APP_DIR}/.venv}"

prompt_with_default SERVICE_NAME "systemd service name" "${SERVICE_NAME_DEFAULT}"
prompt_with_default APACHE_CONF_NAME "Apache config name" "${APACHE_CONF_NAME_DEFAULT}"
prompt_with_default ENV_FILE "Environment file" "${ENV_FILE_DEFAULT}"
prompt_with_default VENV_DIR "Virtualenv path" "${VENV_DIR_DEFAULT}"
prompt_secret_with_default SECRET_KEY "SECRET_KEY for Flask sessions" "${SECRET_KEY_DEFAULT}"
prompt_secret_with_default MAILERSEND_API_TOKEN "MAILERSEND_API_TOKEN for notifications" "${MAILERSEND_API_TOKEN_DEFAULT}"
prompt_with_default MAILERSEND_FROM_EMAIL "MAILERSEND_FROM_EMAIL sender address" "${MAILERSEND_FROM_EMAIL_DEFAULT}"
prompt_with_default MAILERSEND_FROM_NAME "MAILERSEND_FROM_NAME sender name" "${MAILERSEND_FROM_NAME_DEFAULT}"

SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
APACHE_CONF_PATH="/etc/apache2/conf-available/${APACHE_CONF_NAME}"

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

if [[ "${APP_BASE_PATH}" != /* ]]; then
  echo "APP_BASE_PATH must start with '/'. Current value: ${APP_BASE_PATH}" >&2
  exit 1
fi

echo "Deploying ${APP_NAME}"
echo "  app dir: ${APP_DIR}"
echo "  app user: ${APP_USER}:${APP_GROUP}"
echo "  bind: 127.0.0.1:${APP_PORT}"
echo "  base path: ${APP_BASE_PATH}"
echo "  mode: ${MODE}"

write_env_file() {
  sudo tee "${ENV_FILE}" >/dev/null <<EOF
APP_PORT=${APP_PORT}
APP_BASE_PATH=${APP_BASE_PATH}
SECRET_KEY=${SECRET_KEY}
MAILERSEND_API_TOKEN=${MAILERSEND_API_TOKEN}
MAILERSEND_FROM_EMAIL=${MAILERSEND_FROM_EMAIL}
MAILERSEND_FROM_NAME=${MAILERSEND_FROM_NAME}
EOF
  sudo chmod 0640 "${ENV_FILE}"
  sudo chown root:"${APP_GROUP}" "${ENV_FILE}" || true
}

if [[ "${MODE}" == "env-only" ]]; then
  write_env_file
  sudo systemctl restart "${SERVICE_NAME}"
  echo
  echo "Environment update complete."
  echo "Service: ${SERVICE_NAME}"
  echo "Environment file: ${ENV_FILE}"
  echo
  echo "Next steps:"
  echo "  1. Verify: sudo systemctl status ${SERVICE_NAME}"
  echo "  2. Check app health: curl -I http://127.0.0.1:${APP_PORT}/api/health"
  exit 0
fi

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

echo "Building frontend bundle"
TASK_TRACKER_BASE_PATH="${APP_BASE_PATH}" "$NPM_BIN" run build --prefix "${APP_DIR}"

write_env_file

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
echo "  2. Set MAILERSEND_API_TOKEN and MAILERSEND_FROM_EMAIL in ${ENV_FILE} if you want task notifications"
echo "  3. Restart the service: sudo systemctl restart ${SERVICE_NAME}"
echo "  4. Verify: curl -I http://127.0.0.1:${APP_PORT}/api/health"
