from __future__ import annotations

import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "task_tracker.sqlite3"


def prompt_non_empty(label: str) -> str:
    while True:
        value = input(f"{label}: ").strip()
        if value:
            return value
        print(f"{label} is required.")


def prompt_email() -> str:
    while True:
        value = input("Email: ").strip()
        if "@" in value and "." in value.rsplit("@", 1)[-1]:
            return value
        print("Provide a valid email address.")


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
    columns = {row[1] for row in connection.execute("PRAGMA table_info(users)").fetchall()}
    if "email" not in columns:
        connection.execute("ALTER TABLE users ADD COLUMN email TEXT")
    connection.commit()


def main() -> int:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    username = prompt_non_empty("Username")
    email = prompt_email()

    connection = sqlite3.connect(DB_PATH)
    try:
        ensure_schema(connection)
        existing_user = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if existing_user is None:
            print(f"User '{username}' does not exist.")
            return 1

        connection.execute(
            "UPDATE users SET email = ? WHERE username = ?",
            (email, username),
        )
        connection.commit()
    finally:
        connection.close()

    print(f"Updated email for '{username}' in {DB_PATH}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
