from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "task_tracker.sqlite3"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def prompt_non_empty(label: str) -> str:
    while True:
        value = input(f"{label}: ").strip()
        if value:
            return value
        print(f"{label} is required.")


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            email TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            logo_original_name TEXT,
            logo_stored_name TEXT
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS project_users (
            project_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    connection.commit()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Assign a project to a user.")
    parser.add_argument("--username", help="Existing username to assign")
    parser.add_argument("--project", help="Existing project name to assign")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    username = (args.username or "").strip() or prompt_non_empty("Username")
    project_name = (args.project or "").strip() or prompt_non_empty("Project")

    connection = sqlite3.connect(DB_PATH)
    try:
        ensure_schema(connection)
        user = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if user is None:
            print(f"User '{username}' does not exist.")
            return 1

        project = connection.execute(
            "SELECT id FROM projects WHERE name = ?",
            (project_name,),
        ).fetchone()
        if project is None:
            print(f"Project '{project_name}' does not exist.")
            return 1

        existing_assignment = connection.execute(
            "SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?",
            (project[0], user[0]),
        ).fetchone()
        if existing_assignment is not None:
            print(f"User '{username}' is already assigned to project '{project_name}'.")
            return 0

        connection.execute(
            "INSERT INTO project_users (project_id, user_id, created_at) VALUES (?, ?, ?)",
            (project[0], user[0], utc_now()),
        )
        connection.commit()
    finally:
        connection.close()

    print(f"Assigned project '{project_name}' to user '{username}' in {DB_PATH}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
