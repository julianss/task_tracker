from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path

from werkzeug.security import generate_password_hash


BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "task_tracker.sqlite3"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_user_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.commit()


def prompt_non_empty(label: str) -> str:
    while True:
        value = input(f"{label}: ").strip()
        if value:
            return value
        print(f"{label} is required.")


def prompt_password() -> str:
    while True:
        password = getpass("Password: ")
        if not password:
            print("Password is required.")
            continue
        confirmation = getpass("Confirm password: ")
        if password != confirmation:
            print("Passwords do not match.")
            continue
        return password


def main() -> int:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    username = prompt_non_empty("Username")
    password = prompt_password()

    connection = sqlite3.connect(DB_PATH)
    try:
        init_user_table(connection)
        existing_user = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if existing_user is not None:
            print(f"User '{username}' already exists.")
            return 1

        connection.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username, generate_password_hash(password), utc_now()),
        )
        connection.commit()
    finally:
        connection.close()

    print(f"Created user '{username}' in {DB_PATH}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
