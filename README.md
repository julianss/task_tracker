# Task Tracker

Task tracker webapp for software development work. The backend is Python + Flask + SQLite, and the frontend is React + Vite.

## Run

1. Refresh the frontend bundle:
   `npm install`
   `npm run build`
2. Start the backend:
   `MAILERSEND_API_TOKEN=xxxxx MAILERSEND_FROM_EMAIL=alerts@your-domain.example .venv/bin/python backend/app.py`
3. Open `http://127.0.0.1:8000`

## Deploy On A VPS

Use `./scripts/deploy.sh` on the server. The script:

- creates or updates `.venv`
- installs Python dependencies including `gunicorn`
- prompts for the deployment path, port, service names, and secret key
- installs frontend dependencies and rebuilds the React app during deploy
- creates a `systemd` service
- writes an Apache config snippet that proxies `/tasks` to the app

Example:

`./scripts/deploy.sh`

After pulling new changes on the VPS, rebuild the frontend with:

`./scripts/rebuild_frontend.sh`

Important environment variables:

- `APP_BASE_PATH`: public base path for the app, default `/tasks`
- `APP_PORT`: localhost port bound by gunicorn, default `18000`
- `APP_NAME`: used for the service and Apache snippet names
- `SECRET_KEY`: written into `/etc/<app-name>.env` on first deploy if provided
- `MAILERSEND_API_TOKEN`: MailerSend API token used for task change notifications
- `MAILERSEND_FROM_EMAIL`: sender address used for MailerSend notifications, must belong to a verified MailerSend domain
- `MAILERSEND_FROM_NAME`: optional sender name, defaults to `Task Tracker`

The frontend build also uses `APP_BASE_PATH`, so static assets and API requests resolve correctly when the app is served from `/tasks`.

## Add Users

Create an application user directly in SQLite with:

`.venv/bin/python scripts/add_user.py`

The script prompts for a username and password, hashes the password, and inserts the user into `data/task_tracker.sqlite3`.

Set or update the email address for an existing user with:

`.venv/bin/python scripts/set_email.py`

Project notifications are sent to users linked to the project who have an email address configured.

## Features

- Projects for classifying tasks
- Project editor with member linking and optional logo
- Tasks with description, status, attachments, and comments
- Comment attachments
- Image attachment thumbnails
- Searchable, filterable list view
- Per-project kanban board with drag-and-drop status changes
- MailerSend notifications for task creation and task updates
