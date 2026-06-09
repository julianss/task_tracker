from __future__ import annotations

import argparse
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from werkzeug.security import generate_password_hash


BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "task_tracker.sqlite3"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            email TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS read_api_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            can_update_testing INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_used_at TEXT,
            revoked_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_read_api_tokens_user_id
            ON read_api_tokens(user_id);
        """
    )
    columns = {row[1] for row in connection.execute("PRAGMA table_info(read_api_tokens)").fetchall()}
    if "can_update_testing" not in columns:
        connection.execute("ALTER TABLE read_api_tokens ADD COLUMN can_update_testing INTEGER NOT NULL DEFAULT 0")
    connection.commit()


def fetch_user_id(connection: sqlite3.Connection, username: str) -> int | None:
    row = connection.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    return int(row[0]) if row else None


def create_token(connection: sqlite3.Connection, username: str, name: str, can_update_testing: bool) -> int:
    user_id = fetch_user_id(connection, username)
    if user_id is None:
        raise ValueError(f"User '{username}' does not exist.")

    token = f"ttro_{secrets.token_urlsafe(32)}"
    cursor = connection.execute(
        """
        INSERT INTO read_api_tokens (user_id, name, token_hash, can_update_testing, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, name, generate_password_hash(token), 1 if can_update_testing else 0, utc_now()),
    )
    connection.commit()

    print("Created API token.")
    print(f"Token ID: {cursor.lastrowid}")
    print(f"Username: {username}")
    print(f"Name: {name}")
    print(f"Can update testing: {'yes' if can_update_testing else 'no'}")
    print("")
    print("Copy this token now. It is not stored in plaintext:")
    print(token)
    return 0


def list_tokens(connection: sqlite3.Connection, username: str | None) -> int:
    params: list[object] = []
    where = ""
    if username:
        where = "WHERE users.username = ?"
        params.append(username)
    rows = connection.execute(
        f"""
        SELECT
            read_api_tokens.id,
            read_api_tokens.name,
            read_api_tokens.can_update_testing,
            read_api_tokens.created_at,
            read_api_tokens.last_used_at,
            read_api_tokens.revoked_at,
            users.username
        FROM read_api_tokens
        JOIN users ON users.id = read_api_tokens.user_id
        {where}
        ORDER BY read_api_tokens.id ASC
        """,
        params,
    ).fetchall()
    if not rows:
        print("No API tokens found.")
        return 0
    for row in rows:
        status = "revoked" if row[5] else "active"
        print(
            f"{row[0]} | {status} | user={row[6]} | name={row[1]} | "
            f"can_update_testing={'yes' if row[2] else 'no'} | "
            f"created={row[3]} | last_used={row[4] or '-'}"
        )
    return 0


def revoke_token(connection: sqlite3.Connection, token_id: int) -> int:
    row = connection.execute(
        "SELECT revoked_at FROM read_api_tokens WHERE id = ?",
        (token_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"Token ID {token_id} does not exist.")
    if row[0]:
        print(f"Token ID {token_id} is already revoked.")
        return 0
    connection.execute(
        "UPDATE read_api_tokens SET revoked_at = ? WHERE id = ?",
        (utc_now(), token_id),
    )
    connection.commit()
    print(f"Revoked token ID {token_id}.")
    return 0


def set_testing_permission(connection: sqlite3.Connection, token_id: int, allowed: bool) -> int:
    row = connection.execute("SELECT id FROM read_api_tokens WHERE id = ?", (token_id,)).fetchone()
    if row is None:
        raise ValueError(f"Token ID {token_id} does not exist.")
    connection.execute(
        "UPDATE read_api_tokens SET can_update_testing = ? WHERE id = ?",
        (1 if allowed else 0, token_id),
    )
    connection.commit()
    print(f"Token ID {token_id} can_update_testing={'yes' if allowed else 'no'}.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage API tokens.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="Create an API token")
    create.add_argument("username", help="Existing app username the token should read as")
    create.add_argument("name", help="Human-readable token name")
    create.add_argument(
        "--can-update-testing",
        action="store_true",
        help="Allow this token to mark visible tasks as testing and add an optional comment",
    )

    list_command = subparsers.add_parser("list", help="List API tokens")
    list_command.add_argument("--username", help="Only list tokens for this username")

    revoke = subparsers.add_parser("revoke", help="Revoke an API token")
    revoke.add_argument("token_id", type=int, help="Token ID from the list command")

    allow_testing = subparsers.add_parser("allow-testing", help="Allow a token to mark visible tasks as testing")
    allow_testing.add_argument("token_id", type=int, help="Token ID from the list command")

    revoke_testing = subparsers.add_parser("revoke-testing", help="Remove testing update permission from a token")
    revoke_testing.add_argument("token_id", type=int, help="Token ID from the list command")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        ensure_schema(connection)
        if args.command == "create":
            return create_token(connection, args.username, args.name, args.can_update_testing)
        if args.command == "list":
            return list_tokens(connection, args.username)
        if args.command == "revoke":
            return revoke_token(connection, args.token_id)
        if args.command == "allow-testing":
            return set_testing_permission(connection, args.token_id, True)
        if args.command == "revoke-testing":
            return set_testing_permission(connection, args.token_id, False)
    except ValueError as exc:
        print(exc)
        return 1
    finally:
        connection.close()
    parser.error("Unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
