from __future__ import annotations

import json
import mimetypes
import os
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file, send_from_directory, session
from werkzeug.security import check_password_hash
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "task_tracker.sqlite3"
UPLOAD_DIR = BASE_DIR / "data" / "uploads"
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
APP_BASE_PATH = os.environ.get("APP_BASE_PATH", "/").strip() or "/"

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
                created_at TEXT NOT NULL
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
                created_at TEXT NOT NULL
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
        comment_columns = {row["name"] for row in db.execute("PRAGMA table_info(comments)").fetchall()}
        if "user_id" not in comment_columns:
            db.execute("ALTER TABLE comments ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
        if "updated_at" not in comment_columns:
            db.execute("ALTER TABLE comments ADD COLUMN updated_at TEXT")
            db.execute("UPDATE comments SET updated_at = created_at WHERE updated_at IS NULL")
            db.execute("UPDATE comments SET updated_at = ? WHERE updated_at IS NULL", (utc_now(),))
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
    prefix = "" if APP_BASE_PATH == "/" else APP_BASE_PATH
    data["url"] = f"{prefix}/uploads/{data['stored_name']}"
    data["is_image"] = bool(data["mime_type"] and data["mime_type"].startswith("image/"))
    return data


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
        SELECT tasks.*, projects.name AS project_name
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
    return db.execute("SELECT id, username, created_at FROM users WHERE id = ?", (user_id,)).fetchone()


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
        if not file_storage or not file_storage.filename:
            continue
        safe_name = secure_filename(file_storage.filename) or "attachment"
        suffix = Path(safe_name).suffix
        stored_name = f"{uuid.uuid4().hex}{suffix}"
        target = UPLOAD_DIR / stored_name
        file_storage.save(target)
        mime_type = file_storage.mimetype or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
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
                safe_name,
                stored_name,
                mime_type,
                target.stat().st_size,
                utc_now(),
            ),
        )


def delete_attachment_file(stored_name: str) -> None:
    target = UPLOAD_DIR / stored_name
    if target.exists():
        target.unlink()


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
        return jsonify({"user": row_to_dict(user) if user else None})


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
        return jsonify({"user": {"id": user["id"], "username": user["username"], "created_at": user["created_at"]}})


@app.post("/api/auth/logout")
def logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@app.get("/api/projects")
def list_projects():
    with closing(get_db()) as db:
        rows = db.execute(
            """
            SELECT projects.*, COUNT(tasks.id) AS task_count
            FROM projects
            LEFT JOIN tasks ON tasks.project_id = projects.id
            GROUP BY projects.id
            ORDER BY LOWER(projects.name) ASC
            """
        ).fetchall()
        return jsonify([row_to_dict(row) for row in rows])


@app.post("/api/projects")
def create_project():
    payload = request.get_json(force=True)
    name = (payload.get("name") or "").strip()
    if not name:
        abort(400, description="El nombre del proyecto es obligatorio")
    with closing(get_db()) as db:
        require_current_user(db)
        cursor = db.execute(
            "INSERT INTO projects (name, created_at) VALUES (?, ?)",
            (name, utc_now()),
        )
        db.commit()
        row = db.execute(
            "SELECT projects.*, 0 AS task_count FROM projects WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return jsonify(row_to_dict(row)), 201


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
            SELECT tasks.*, projects.name AS project_name
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
        return jsonify(fetch_task(db, cursor.lastrowid)), 201


@app.patch("/api/tasks/<int:task_id>")
def update_task(task_id: int):
    payload = request.get_json(force=True)
    with closing(get_db()) as db:
        user = require_current_user(db)
        current = fetch_task(db, task_id)
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
        return jsonify(fetch_task(db, task_id)), 201


@app.get("/api/projects/<int:project_id>/board")
def project_board(project_id: int):
    with closing(get_db()) as db:
        project = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if project is None:
            abort(404, description="No se encontro el proyecto")
        rows = db.execute(
            """
            SELECT tasks.*, projects.name AS project_name
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
                "project": row_to_dict(project),
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
