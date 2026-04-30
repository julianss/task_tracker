from __future__ import annotations

import json
import mimetypes
import os
import sqlite3
import sys
import uuid
from contextlib import closing
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request

from flask import Flask, abort, jsonify, request, send_file, send_from_directory, session
from werkzeug.security import check_password_hash
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "task_tracker.sqlite3"
UPLOAD_DIR = BASE_DIR / "data" / "uploads"
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
APP_BASE_PATH = os.environ.get("APP_BASE_PATH", "/").strip() or "/"
MAILERSEND_API_TOKEN = os.environ.get("MAILERSEND_API_TOKEN", "").strip()
MAILERSEND_FROM_EMAIL = os.environ.get("MAILERSEND_FROM_EMAIL", "").strip()
MAILERSEND_FROM_NAME = os.environ.get("MAILERSEND_FROM_NAME", "Task Tracker").strip() or "Task Tracker"

STATUSES = ["todo", "in_progress", "testing", "done"]


def normalize_base_path(value: str) -> str:
    if not value or value == "/":
        return "/"
    normalized = value if value.startswith("/") else f"/{value}"
    return normalized.rstrip("/") or "/"


APP_BASE_PATH = normalize_base_path(APP_BASE_PATH)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with closing(get_db()) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                logo_original_name TEXT,
                logo_stored_name TEXT
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                user_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER,
                comment_id INTEGER,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL UNIQUE,
                mime_type TEXT,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
                CHECK (
                    (task_id IS NOT NULL AND comment_id IS NULL)
                    OR (task_id IS NULL AND comment_id IS NOT NULL)
                )
            );

            CREATE TABLE IF NOT EXISTS checklist_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                is_done INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                email TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_users (
                project_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (project_id, user_id),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS task_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER,
                action TEXT NOT NULL,
                details TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            );
            """
        )
        project_columns = {row["name"] for row in db.execute("PRAGMA table_info(projects)").fetchall()}
        if "logo_original_name" not in project_columns:
            db.execute("ALTER TABLE projects ADD COLUMN logo_original_name TEXT")
        if "logo_stored_name" not in project_columns:
            db.execute("ALTER TABLE projects ADD COLUMN logo_stored_name TEXT")
        comment_columns = {row["name"] for row in db.execute("PRAGMA table_info(comments)").fetchall()}
        if "user_id" not in comment_columns:
            db.execute("ALTER TABLE comments ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
        if "updated_at" not in comment_columns:
            db.execute("ALTER TABLE comments ADD COLUMN updated_at TEXT")
            db.execute("UPDATE comments SET updated_at = created_at WHERE updated_at IS NULL")
            db.execute("UPDATE comments SET updated_at = ? WHERE updated_at IS NULL", (utc_now(),))
        user_columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
        if "email" not in user_columns:
            db.execute("ALTER TABLE users ADD COLUMN email TEXT")
        db.execute("UPDATE tasks SET status = 'testing' WHERE status = 'blocked'")
        count = db.execute("SELECT COUNT(*) AS count FROM projects").fetchone()["count"]
        if count == 0:
            db.execute(
                "INSERT INTO projects (name, created_at) VALUES (?, ?)",
                ("General", utc_now()),
            )
        db.commit()


def normalize_status(status: str) -> str:
    if status not in STATUSES:
        abort(400, description=f"Estado no valido: '{status}'")
    return status


def row_to_dict(row: sqlite3.Row) -> dict:
    return {key: row[key] for key in row.keys()}


def attachment_payload(row: sqlite3.Row) -> dict:
    data = row_to_dict(row)
    data["url"] = build_upload_url(data["stored_name"])
    data["is_image"] = bool(data["mime_type"] and data["mime_type"].startswith("image/"))
    return data


def build_upload_url(stored_name: str | None) -> str | None:
    if not stored_name:
        return None
    prefix = "" if APP_BASE_PATH == "/" else APP_BASE_PATH
    return f"{prefix}/uploads/{stored_name}"


def project_logo_payload(project: dict) -> dict:
    project["logo_url"] = build_upload_url(project.get("logo_stored_name"))
    return project


def user_payload(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "created_at": row["created_at"],
    }


def fetch_project_members(db: sqlite3.Connection, project_id: int) -> list[dict]:
    rows = db.execute(
        """
        SELECT users.id, users.username, users.email, users.created_at
        FROM project_users
        JOIN users ON users.id = project_users.user_id
        WHERE project_users.project_id = ?
        ORDER BY LOWER(users.username) ASC
        """,
        (project_id,),
    ).fetchall()
    return [user_payload(row) for row in rows]


def hydrate_project(db: sqlite3.Connection, project: dict) -> dict:
    project = project_logo_payload(project)
    project["members"] = fetch_project_members(db, project["id"])
    return project


def fetch_project(db: sqlite3.Connection, project_id: int) -> dict:
    row = db.execute(
        """
        SELECT
            projects.*,
            COUNT(tasks.id) AS task_count,
            SUM(CASE WHEN tasks.status IS NOT NULL AND tasks.status != 'done' THEN 1 ELSE 0 END) AS pending_count
        FROM projects
        LEFT JOIN tasks ON tasks.project_id = projects.id
        WHERE projects.id = ?
        GROUP BY projects.id
        """,
        (project_id,),
    ).fetchone()
    if row is None:
        abort(404, description="No se encontro el proyecto")
    return hydrate_project(db, row_to_dict(row))


def store_uploaded_file(file_storage) -> dict | None:
    if not file_storage or not file_storage.filename:
        return None
    safe_name = secure_filename(file_storage.filename) or "attachment"
    suffix = Path(safe_name).suffix
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    target = UPLOAD_DIR / stored_name
    file_storage.save(target)
    mime_type = file_storage.mimetype or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    return {
        "original_name": safe_name,
        "stored_name": stored_name,
        "mime_type": mime_type,
        "size_bytes": target.stat().st_size,
    }


def fetch_attachments(db: sqlite3.Connection, *, task_id: int | None = None, comment_id: int | None = None) -> list[dict]:
    if task_id is not None:
        rows = db.execute(
            "SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at ASC",
            (task_id,),
        ).fetchall()
    elif comment_id is not None:
        rows = db.execute(
            "SELECT * FROM attachments WHERE comment_id = ? ORDER BY created_at ASC",
            (comment_id,),
        ).fetchall()
    else:
        rows = []
    return [attachment_payload(row) for row in rows]


def fetch_comments(db: sqlite3.Connection, task_id: int) -> list[dict]:
    rows = db.execute(
        """
        SELECT comments.*, users.username
        FROM comments
        LEFT JOIN users ON users.id = comments.user_id
        WHERE comments.task_id = ?
        ORDER BY comments.created_at ASC
        """,
        (task_id,),
    ).fetchall()
    comments = []
    for row in rows:
        comment = row_to_dict(row)
        comment["attachments"] = fetch_attachments(db, comment_id=comment["id"])
        comments.append(comment)
    return comments


def fetch_checklist_items(db: sqlite3.Connection, task_id: int) -> list[dict]:
    rows = db.execute(
        "SELECT * FROM checklist_items WHERE task_id = ? ORDER BY created_at ASC, id ASC",
        (task_id,),
    ).fetchall()
    items = [row_to_dict(row) for row in rows]
    for item in items:
        item["is_done"] = bool(item["is_done"])
    return items


def hydrate_task(db: sqlite3.Connection, task: dict) -> dict:
    task_id = task["id"]
    task["project_logo_url"] = build_upload_url(task.get("project_logo_stored_name"))
    task["attachments"] = fetch_attachments(db, task_id=task_id)
    task["comments"] = fetch_comments(db, task_id)
    task["checklist_items"] = fetch_checklist_items(db, task_id)
    task["audit_logs"] = fetch_audit_logs(db, task_id)
    latest_audit = next((entry for entry in task["audit_logs"] if entry.get("username")), None)
    task["last_updated_by"] = latest_audit["username"] if latest_audit else None
    if task["checklist_items"]:
        completed = sum(1 for item in task["checklist_items"] if item["is_done"])
        task["progress_percent"] = round((completed / len(task["checklist_items"])) * 100)
    else:
        task["progress_percent"] = None
    return task


def fetch_task(db: sqlite3.Connection, task_id: int) -> dict:
    row = db.execute(
        """
        SELECT
            tasks.*,
            projects.name AS project_name,
            projects.logo_original_name AS project_logo_original_name,
            projects.logo_stored_name AS project_logo_stored_name
        FROM tasks
        JOIN projects ON projects.id = tasks.project_id
        WHERE tasks.id = ?
        """,
        (task_id,),
    ).fetchone()
    if row is None:
        abort(404, description="No se encontro la tarea")
    return hydrate_task(db, row_to_dict(row))


def fetch_audit_logs(db: sqlite3.Connection, task_id: int) -> list[dict]:
    rows = db.execute(
        """
        SELECT task_audit_logs.*, users.username
        FROM task_audit_logs
        LEFT JOIN users ON users.id = task_audit_logs.user_id
        WHERE task_audit_logs.task_id = ?
        ORDER BY task_audit_logs.created_at DESC, task_audit_logs.id DESC
        """,
        (task_id,),
    ).fetchall()
    return [row_to_dict(row) for row in rows]


def get_current_user(db: sqlite3.Connection) -> sqlite3.Row | None:
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.execute("SELECT id, username, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone()


def require_current_user(db: sqlite3.Connection) -> sqlite3.Row:
    user = get_current_user(db)
    if user is None:
        abort(401, description="Debes iniciar sesion para modificar datos")
    return user


def write_task_audit_log(
    db: sqlite3.Connection,
    *,
    task_id: int,
    user_id: int | None,
    action: str,
    details: str,
) -> None:
    db.execute(
        """
        INSERT INTO task_audit_logs (task_id, user_id, action, details, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (task_id, user_id, action, details, utc_now()),
    )


def save_uploaded_files(db: sqlite3.Connection, files, *, task_id: int | None = None, comment_id: int | None = None) -> None:
    for file_storage in files:
        stored = store_uploaded_file(file_storage)
        if stored is None:
            continue
        db.execute(
            """
            INSERT INTO attachments (
                task_id,
                comment_id,
                original_name,
                stored_name,
                mime_type,
                size_bytes,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                comment_id,
                stored["original_name"],
                stored["stored_name"],
                stored["mime_type"],
                stored["size_bytes"],
                utc_now(),
            ),
        )


def delete_attachment_file(stored_name: str) -> None:
    target = UPLOAD_DIR / stored_name
    if target.exists():
        target.unlink()


def parse_project_form() -> tuple[str, list[int], object, bool]:
    payload = json.loads(request.form.get("data", "{}"))
    name = (payload.get("name") or "").strip()
    member_ids = payload.get("member_ids") or []
    normalized_member_ids = []
    for member_id in member_ids:
        try:
            normalized_member_ids.append(int(member_id))
        except (TypeError, ValueError):
            abort(400, description="Hay usuarios invalidos en el proyecto")
    remove_logo = bool(payload.get("remove_logo"))
    return name, normalized_member_ids, request.files.get("logo"), remove_logo


def replace_project_members(db: sqlite3.Connection, project_id: int, member_ids: list[int]) -> None:
    unique_member_ids = sorted({member_id for member_id in member_ids})
    if unique_member_ids:
        placeholders = ",".join("?" for _ in unique_member_ids)
        count = db.execute(
            f"SELECT COUNT(*) AS count FROM users WHERE id IN ({placeholders})",
            unique_member_ids,
        ).fetchone()["count"]
        if count != len(unique_member_ids):
            abort(400, description="Uno o mas usuarios del proyecto no existen")
    db.execute("DELETE FROM project_users WHERE project_id = ?", (project_id,))
    for member_id in unique_member_ids:
        db.execute(
            "INSERT INTO project_users (project_id, user_id, created_at) VALUES (?, ?, ?)",
            (project_id, member_id, utc_now()),
        )


def mailersend_enabled() -> bool:
    return bool(MAILERSEND_API_TOKEN and MAILERSEND_FROM_EMAIL)


def send_mailersend_email(*, recipients: list[dict], subject: str, text: str, html: str) -> None:
    if not recipients or not mailersend_enabled():
        return
    recipient_emails = [recipient.get("email", "") for recipient in recipients]
    masked_token = (
        f"{MAILERSEND_API_TOKEN[:8]}...{MAILERSEND_API_TOKEN[-6:]}"
        if len(MAILERSEND_API_TOKEN) > 18
        else "<masked>"
    )
    payload = {
        "from": {"email": MAILERSEND_FROM_EMAIL, "name": MAILERSEND_FROM_NAME},
        "to": recipients,
        "subject": subject,
        "text": text,
        "html": html,
    }
    request_data = urllib_request.Request(
        "https://api.mailersend.com/v1/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {MAILERSEND_API_TOKEN}",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "task-tracker-mailersend/1.0",
        },
        method="POST",
    )
    print(
        (
            "MailerSend notification request prepared; "
            "url='https://api.mailersend.com/v1/email'; "
            f"authorization='Bearer {masked_token}'; "
            "user_agent='task-tracker-mailersend/1.0'; "
            f"from={MAILERSEND_FROM_EMAIL!r}; recipients={recipient_emails!r}; subject={subject!r}"
        ),
        file=sys.stderr,
    )
    with urllib_request.urlopen(request_data, timeout=15):
        print(
            (
                f"MailerSend notification sent successfully; from={MAILERSEND_FROM_EMAIL!r}; "
                f"recipients={recipient_emails!r}; subject={subject!r}"
            ),
            file=sys.stderr,
        )
        return


def notify_task_change(
    db: sqlite3.Connection,
    *,
    task_id: int,
    action_label: str,
    actor_name: str,
    include_project_ids: list[int] | None = None,
    extra_text: str | None = None,
    extra_html: str | None = None,
) -> None:
    if not mailersend_enabled():
        print(
            (
                f"MailerSend notification skipped for task {task_id}: "
                f"MAILERSEND_API_TOKEN={'set' if bool(MAILERSEND_API_TOKEN) else 'missing'}, "
                f"MAILERSEND_FROM_EMAIL={'set' if bool(MAILERSEND_FROM_EMAIL) else 'missing'}"
            ),
            file=sys.stderr,
        )
        return
    task = fetch_task(db, task_id)
    project_ids = include_project_ids or [int(task["project_id"])]
    project_ids = sorted({int(project_id) for project_id in project_ids})
    recipients_by_email: dict[str, dict] = {}
    for project_id in project_ids:
        for member in fetch_project_members(db, project_id):
            email = (member.get("email") or "").strip()
            if not email:
                continue
            recipients_by_email[email.lower()] = {"email": email, "name": member["username"]}
    recipients = list(recipients_by_email.values())
    if not recipients:
        print(
            (
                f"MailerSend notification skipped for task {task_id}: no recipients with email "
                f"for project_ids={project_ids}"
            ),
            file=sys.stderr,
        )
        return
    recipient_emails = [recipient.get("email", "") for recipient in recipients]

    subject = f"[Task Tracker] Tarea #{task['id']} actualizada en {task['project_name']}"
    summary = task["audit_logs"][0]["details"] if task.get("audit_logs") else action_label
    text = (
        f"Proyecto: {task['project_name']}\n"
        f"Tarea: #{task['id']}\n"
        f"Cambio: {action_label}\n"
        f"Resumen: {summary}\n"
        f"Usuario: {actor_name}\n"
        f"Estado: {task['status']}\n"
        f"Actualizada: {task['updated_at']}\n\n"
        f"Descripcion:\n{task['description']}\n"
    )
    if extra_text:
        text += f"\n{extra_text}\n"
    html = (
        f"<p><strong>Proyecto:</strong> {escape(task['project_name'])}</p>"
        f"<p><strong>Tarea:</strong> #{task['id']}</p>"
        f"<p><strong>Cambio:</strong> {escape(action_label)}</p>"
        f"<p><strong>Resumen:</strong> {escape(summary)}</p>"
        f"<p><strong>Usuario:</strong> {escape(actor_name)}</p>"
        f"<p><strong>Estado:</strong> {escape(task['status'])}</p>"
        f"<p><strong>Actualizada:</strong> {escape(task['updated_at'])}</p>"
        f"<p><strong>Descripcion:</strong><br>{escape(task['description']).replace(chr(10), '<br>')}</p>"
    )
    if extra_html:
        html += extra_html
    try:
        send_mailersend_email(recipients=recipients, subject=subject, text=text, html=html)
    except urllib_error.HTTPError as exc:
        response_body = ""
        response_headers = {}
        try:
            response_body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            response_body = "<no response body>"
        try:
            response_headers = dict(exc.headers.items())
        except Exception:
            response_headers = {"error": "<unable to read response headers>"}
        print(
            (
                f"MailerSend notification failed for task {task_id}: {exc}; "
                f"from={MAILERSEND_FROM_EMAIL!r}; recipients={recipient_emails!r}; "
                f"headers={response_headers!r}; response={response_body}"
            ),
            file=sys.stderr,
        )
    except (urllib_error.URLError, TimeoutError) as exc:
        print(
            (
                f"MailerSend notification failed for task {task_id}: {exc}; "
                f"from={MAILERSEND_FROM_EMAIL!r}; recipients={recipient_emails!r}"
            ),
            file=sys.stderr,
        )


def fetch_attachment_parent_task_id(db: sqlite3.Connection, attachment_id: int) -> tuple[int, str]:
    row = db.execute("SELECT * FROM attachments WHERE id = ?", (attachment_id,)).fetchone()
    if row is None:
        abort(404, description="No se encontro el archivo adjunto")
    attachment = row_to_dict(row)
    if attachment["task_id"] is not None:
        return attachment["task_id"], attachment["stored_name"]
    comment = db.execute("SELECT task_id FROM comments WHERE id = ?", (attachment["comment_id"],)).fetchone()
    if comment is None:
        abort(404, description="No se encontro el elemento padre del archivo adjunto")
    return comment["task_id"], attachment["stored_name"]


app = Flask(__name__, static_folder=str(FRONTEND_DIST), static_url_path="/")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "task-tracker-dev-secret")
app.config["APPLICATION_ROOT"] = APP_BASE_PATH
app.config["SESSION_COOKIE_PATH"] = APP_BASE_PATH


@app.errorhandler(sqlite3.IntegrityError)
def handle_db_integrity_error(error):
    return jsonify({"description": str(error)}), 400


@app.errorhandler(400)
@app.errorhandler(401)
@app.errorhandler(404)
@app.errorhandler(500)
def handle_error(error):
    code = getattr(error, "code", 500)
    description = getattr(error, "description", "Error inesperado del servidor")
    return jsonify({"description": description}), code


@app.get("/api/health")
def healthcheck():
    return jsonify({"ok": True})


@app.get("/api/auth/me")
def auth_me():
    with closing(get_db()) as db:
        user = get_current_user(db)
        return jsonify({"user": user_payload(user) if user else None})


@app.post("/api/auth/login")
def login():
    payload = request.get_json(force=True)
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    if not username or not password:
        abort(400, description="Usuario y contrasena son obligatorios")
    with closing(get_db()) as db:
        user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if user is None or not check_password_hash(user["password_hash"], password):
            abort(401, description="Credenciales invalidas")
        session["user_id"] = user["id"]
        return jsonify({"user": user_payload(user)})


@app.post("/api/auth/logout")
def logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@app.get("/api/projects")
def list_projects():
    with closing(get_db()) as db:
        rows = db.execute(
            """
            SELECT
                projects.*,
                COUNT(tasks.id) AS task_count,
                SUM(CASE WHEN tasks.status IS NOT NULL AND tasks.status != 'done' THEN 1 ELSE 0 END) AS pending_count
            FROM projects
            LEFT JOIN tasks ON tasks.project_id = projects.id
            GROUP BY projects.id
            ORDER BY LOWER(projects.name) ASC
            """
        ).fetchall()
        return jsonify([hydrate_project(db, row_to_dict(row)) for row in rows])


@app.get("/api/users")
def list_users():
    with closing(get_db()) as db:
        rows = db.execute("SELECT id, username, email, created_at FROM users ORDER BY LOWER(username) ASC").fetchall()
        return jsonify([user_payload(row) for row in rows])


@app.post("/api/projects")
def create_project():
    name, member_ids, logo_file, _remove_logo = parse_project_form()
    if not name:
        abort(400, description="El nombre del proyecto es obligatorio")
    with closing(get_db()) as db:
        require_current_user(db)
        stored_logo = store_uploaded_file(logo_file)
        cursor = db.execute(
            "INSERT INTO projects (name, created_at, logo_original_name, logo_stored_name) VALUES (?, ?, ?, ?)",
            (
                name,
                utc_now(),
                stored_logo["original_name"] if stored_logo else None,
                stored_logo["stored_name"] if stored_logo else None,
            ),
        )
        replace_project_members(db, cursor.lastrowid, member_ids)
        db.commit()
        return jsonify(fetch_project(db, cursor.lastrowid)), 201


@app.patch("/api/projects/<int:project_id>")
def update_project(project_id: int):
    name, member_ids, logo_file, remove_logo = parse_project_form()
    if not name:
        abort(400, description="El nombre del proyecto es obligatorio")
    old_logo_stored_name = None
    with closing(get_db()) as db:
        require_current_user(db)
        current = fetch_project(db, project_id)
        stored_logo = store_uploaded_file(logo_file)
        next_logo_original_name = current.get("logo_original_name")
        next_logo_stored_name = current.get("logo_stored_name")
        if stored_logo:
            old_logo_stored_name = current.get("logo_stored_name")
            next_logo_original_name = stored_logo["original_name"]
            next_logo_stored_name = stored_logo["stored_name"]
        elif remove_logo:
            old_logo_stored_name = current.get("logo_stored_name")
            next_logo_original_name = None
            next_logo_stored_name = None
        db.execute(
            "UPDATE projects SET name = ?, logo_original_name = ?, logo_stored_name = ? WHERE id = ?",
            (name, next_logo_original_name, next_logo_stored_name, project_id),
        )
        replace_project_members(db, project_id, member_ids)
        db.commit()
        updated_project = fetch_project(db, project_id)
    if old_logo_stored_name and old_logo_stored_name != updated_project.get("logo_stored_name"):
        delete_attachment_file(old_logo_stored_name)
    return jsonify(updated_project)


@app.get("/api/tasks")
def list_tasks():
    project_id = request.args.get("project_id", type=int)
    status = request.args.get("status", type=str)
    query = (request.args.get("q", type=str) or "").strip().lower()

    clauses = []
    params: list[object] = []

    if project_id:
        clauses.append("tasks.project_id = ?")
        params.append(project_id)
    if status:
        normalize_status(status)
        clauses.append("tasks.status = ?")
        params.append(status)
    if query:
        like_query = f"%{query}%"
        clauses.append(
            """
            (
                LOWER(tasks.description) LIKE ?
                OR LOWER(projects.name) LIKE ?
                OR EXISTS (
                    SELECT 1 FROM comments
                    WHERE comments.task_id = tasks.id
                    AND LOWER(comments.body) LIKE ?
                )
            )
            """
        )
        params.extend([like_query, like_query, like_query])

    where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with closing(get_db()) as db:
        rows = db.execute(
            f"""
            SELECT
                tasks.*,
                projects.name AS project_name,
                projects.logo_original_name AS project_logo_original_name,
                projects.logo_stored_name AS project_logo_stored_name
            FROM tasks
            JOIN projects ON projects.id = tasks.project_id
            {where_clause}
            ORDER BY tasks.updated_at DESC, tasks.id DESC
            """,
            params,
        ).fetchall()
        return jsonify([hydrate_task(db, row_to_dict(row)) for row in rows])


@app.get("/api/tasks/<int:task_id>")
def get_task(task_id: int):
    with closing(get_db()) as db:
        return jsonify(fetch_task(db, task_id))


@app.post("/api/tasks")
def create_task():
    payload = json.loads(request.form.get("data", "{}"))
    description = (payload.get("description") or "").strip()
    status = normalize_status(payload.get("status") or "todo")
    project_id = payload.get("project_id")
    if not description:
        abort(400, description="La descripcion de la tarea es obligatoria")
    if not project_id:
        abort(400, description="El proyecto es obligatorio")
    with closing(get_db()) as db:
        user = require_current_user(db)
        now = utc_now()
        cursor = db.execute(
            """
            INSERT INTO tasks (project_id, description, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (project_id, description, status, now, now),
        )
        save_uploaded_files(db, request.files.getlist("attachments"), task_id=cursor.lastrowid)
        write_task_audit_log(
            db,
            task_id=cursor.lastrowid,
            user_id=user["id"],
            action="task_created",
            details=f"Creo la tarea con estado '{status}'.",
        )
        db.commit()
        notify_task_change(db, task_id=cursor.lastrowid, action_label="Tarea creada", actor_name=user["username"])
        return jsonify(fetch_task(db, cursor.lastrowid)), 201


@app.patch("/api/tasks/<int:task_id>")
def update_task(task_id: int):
    payload = request.get_json(force=True)
    with closing(get_db()) as db:
        user = require_current_user(db)
        current = fetch_task(db, task_id)
        previous_project_id = int(current["project_id"])
        description = (payload.get("description") or current["description"]).strip()
        status = normalize_status(payload.get("status") or current["status"])
        project_id = payload.get("project_id") or current["project_id"]
        db.execute(
            """
            UPDATE tasks
            SET project_id = ?, description = ?, status = ?, updated_at = ?
            WHERE id = ?
            """,
            (project_id, description, status, utc_now(), task_id),
        )
        if description != current["description"]:
            write_task_audit_log(
                db,
                task_id=task_id,
                user_id=user["id"],
                action="description_updated",
                details="Actualizo la descripcion de la tarea.",
            )
        if status != current["status"]:
            write_task_audit_log(
                db,
                task_id=task_id,
                user_id=user["id"],
                action="status_updated",
                details=f"Cambio el estado de '{current['status']}' a '{status}'.",
            )
        if int(project_id) != int(current["project_id"]):
            write_task_audit_log(
                db,
                task_id=task_id,
                user_id=user["id"],
                action="project_updated",
                details=f"Movio la tarea del proyecto '{current['project_name']}'.",
            )
        db.commit()
        notify_task_change(
            db,
            task_id=task_id,
            action_label="Tarea actualizada",
            actor_name=user["username"],
            include_project_ids=[previous_project_id, int(project_id)],
        )
        return jsonify(fetch_task(db, task_id))


@app.post("/api/tasks/<int:task_id>/attachments")
def upload_task_attachments(task_id: int):
    with closing(get_db()) as db:
        user = require_current_user(db)
        fetch_task(db, task_id)
        files = request.files.getlist("attachments")
        save_uploaded_files(db, files, task_id=task_id)
        db.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (utc_now(), task_id))
        if files:
            write_task_audit_log(
                db,
                task_id=task_id,
                user_id=user["id"],
                action="attachments_added",
                details=f"Agrego {len([file for file in files if file and file.filename])} archivo(s) a la tarea.",
            )
        db.commit()
        notify_task_change(db, task_id=task_id, action_label="Archivos agregados", actor_name=user["username"])
        return jsonify(fetch_task(db, task_id)), 201


@app.delete("/api/attachments/<int:attachment_id>")
def delete_attachment(attachment_id: int):
    with closing(get_db()) as db:
        user = require_current_user(db)
        task_id, stored_name = fetch_attachment_parent_task_id(db, attachment_id)
        attachment = db.execute("SELECT original_name FROM attachments WHERE id = ?", (attachment_id,)).fetchone()
        db.execute("DELETE FROM attachments WHERE id = ?", (attachment_id,))
        db.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (utc_now(), task_id))
        write_task_audit_log(
            db,
            task_id=task_id,
            user_id=user["id"],
            action="attachment_deleted",
            details=f"Elimino el archivo '{attachment['original_name']}'.",
        )
        db.commit()
        notify_task_change(db, task_id=task_id, action_label="Archivo eliminado", actor_name=user["username"])
    delete_attachment_file(stored_name)
    with closing(get_db()) as db:
        return jsonify(fetch_task(db, task_id))


@app.post("/api/tasks/<int:task_id>/checklist")
def create_checklist_item(task_id: int):
    payload = request.get_json(force=True)
    body = (payload.get("body") or "").strip()
    if not body:
        abort(400, description="El texto del elemento de la lista es obligatorio")
    with closing(get_db()) as db:
        user = require_current_user(db)
        fetch_task(db, task_id)
        db.execute(
            "INSERT INTO checklist_items (task_id, body, is_done, created_at) VALUES (?, ?, ?, ?)",
            (task_id, body, 0, utc_now()),
        )
        db.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (utc_now(), task_id))
        write_task_audit_log(
            db,
            task_id=task_id,
            user_id=user["id"],
            action="checklist_item_added",
            details=f"Agrego un elemento a la lista: '{body}'.",
        )
        db.commit()
        notify_task_change(db, task_id=task_id, action_label="Checklist actualizada", actor_name=user["username"])
        return jsonify(fetch_task(db, task_id)), 201


@app.patch("/api/checklist-items/<int:item_id>")
def update_checklist_item(item_id: int):
    payload = request.get_json(force=True)
    with closing(get_db()) as db:
        user = require_current_user(db)
        row = db.execute("SELECT * FROM checklist_items WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            abort(404, description="No se encontro el elemento de la lista")
        current = row_to_dict(row)
        body = (payload.get("body") or current["body"]).strip()
        if not body:
            abort(400, description="El texto del elemento de la lista es obligatorio")
        is_done = payload.get("is_done")
        if is_done is None:
            is_done = bool(current["is_done"])
        db.execute(
            "UPDATE checklist_items SET body = ?, is_done = ? WHERE id = ?",
            (body, 1 if is_done else 0, item_id),
        )
        db.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (utc_now(), current["task_id"]))
        if body != current["body"]:
            write_task_audit_log(
                db,
                task_id=current["task_id"],
                user_id=user["id"],
                action="checklist_item_updated",
                details=f"Actualizo el elemento de lista a '{body}'.",
            )
        if bool(is_done) != bool(current["is_done"]):
            write_task_audit_log(
                db,
                task_id=current["task_id"],
                user_id=user["id"],
                action="checklist_item_toggled",
                details=f"Marco el elemento '{body}' como {'hecho' if is_done else 'pendiente'}.",
            )
        db.commit()
        notify_task_change(
            db,
            task_id=current["task_id"],
            action_label="Checklist actualizada",
            actor_name=user["username"],
        )
        return jsonify(fetch_task(db, current["task_id"]))


@app.delete("/api/checklist-items/<int:item_id>")
def delete_checklist_item(item_id: int):
    with closing(get_db()) as db:
        user = require_current_user(db)
        row = db.execute("SELECT * FROM checklist_items WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            abort(404, description="No se encontro el elemento de la lista")
        current = row_to_dict(row)
        db.execute("DELETE FROM checklist_items WHERE id = ?", (item_id,))
        db.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (utc_now(), current["task_id"]))
        write_task_audit_log(
            db,
            task_id=current["task_id"],
            user_id=user["id"],
            action="checklist_item_deleted",
            details=f"Elimino el elemento de lista '{current['body']}'.",
        )
        db.commit()
        notify_task_change(
            db,
            task_id=current["task_id"],
            action_label="Checklist actualizada",
            actor_name=user["username"],
        )
        return jsonify(fetch_task(db, current["task_id"]))


@app.post("/api/tasks/<int:task_id>/comments")
def create_comment(task_id: int):
    body = (request.form.get("body") or "").strip()
    if not body:
        abort(400, description="El texto del comentario es obligatorio")
    with closing(get_db()) as db:
        user = require_current_user(db)
        fetch_task(db, task_id)
        now = utc_now()
        cursor = db.execute(
            "INSERT INTO comments (task_id, body, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (task_id, body, user["id"], now, now),
        )
        files = request.files.getlist("attachments")
        save_uploaded_files(db, files, comment_id=cursor.lastrowid)
        db.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (utc_now(), task_id))
        details = "Agrego un comentario."
        if files and any(file and file.filename for file in files):
            details = f"Agrego un comentario con {len([file for file in files if file and file.filename])} archivo(s) adjunto(s)."
        write_task_audit_log(
            db,
            task_id=task_id,
            user_id=user["id"],
            action="comment_added",
            details=details,
        )
        db.commit()
        notify_task_change(
            db,
            task_id=task_id,
            action_label="Comentario agregado",
            actor_name=user["username"],
            extra_text=f"Comentario nuevo:\n{body}",
            extra_html=f"<p><strong>Comentario nuevo:</strong><br>{escape(body).replace(chr(10), '<br>')}</p>",
        )
        return jsonify(fetch_task(db, task_id)), 201


@app.get("/api/projects/<int:project_id>/board")
def project_board(project_id: int):
    with closing(get_db()) as db:
        project = fetch_project(db, project_id)
        rows = db.execute(
            """
            SELECT
                tasks.*,
                projects.name AS project_name,
                projects.logo_original_name AS project_logo_original_name,
                projects.logo_stored_name AS project_logo_stored_name
            FROM tasks
            JOIN projects ON projects.id = tasks.project_id
            WHERE tasks.project_id = ?
            ORDER BY tasks.updated_at DESC, tasks.id DESC
            """,
            (project_id,),
        ).fetchall()
        columns = {status: [] for status in STATUSES}
        for row in rows:
            task = hydrate_task(db, row_to_dict(row))
            columns.setdefault(task["status"], columns["todo"]).append(task)
        return jsonify(
            {
                "project": project,
                "columns": [{"status": status, "tasks": columns[status]} for status in STATUSES],
            }
        )


@app.get("/uploads/<path:filename>")
def uploaded_file(filename: str):
    target = UPLOAD_DIR / filename
    if not target.exists():
        abort(404)
    return send_file(target)


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def frontend(path: str):
    target = FRONTEND_DIST / path
    if path and target.exists():
        return send_from_directory(FRONTEND_DIST, path)
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return send_from_directory(FRONTEND_DIST, "index.html")
    return (
        jsonify({"message": "El frontend todavia no esta compilado. Ejecuta `npm run build` y vuelve a abrir la app."}),
        503,
    )


init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), debug=True)
