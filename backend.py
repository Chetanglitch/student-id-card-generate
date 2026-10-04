import datetime as dt
import hmac
import http.cookies
import json
import os
import re
import secrets
import socket
import sqlite3
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("RCPIT_DATABASE_PATH", ROOT / "student_cards.db"))
ADMIN_USERNAME = os.environ.get("RCPIT_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("RCPIT_ADMIN_PASSWORD", "admin123")
SESSION_TTL = dt.timedelta(hours=8)
MAX_REQUEST_BYTES = 20 * 1024 * 1024
SESSIONS = {"admin": {}, "student": {}}
STUDENT_CARDS = {}


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def connect_db():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS student_cards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            roll_no TEXT NOT NULL,
            prn TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Pending',
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            signed_at TEXT
        )
        """
    )
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(student_cards)")}
    if "name" not in columns:
        connection.execute("ALTER TABLE student_cards ADD COLUMN name TEXT NOT NULL DEFAULT ''")
    rows = connection.execute(
        "SELECT id, data_json FROM student_cards WHERE name = ''"
    ).fetchall()
    for row in rows:
        try:
            name = str(json.loads(row["data_json"]).get("name", "")).strip()
        except (json.JSONDecodeError, AttributeError):
            name = ""
        connection.execute("UPDATE student_cards SET name = ? WHERE id = ?", (name, row["id"]))
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_verified_name_login ON student_cards(status, name, prn)"
    )
    return connection


@contextmanager
def db_session():
    connection = connect_db()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def clean_card(card, force_pending=False):
    if not isinstance(card, dict):
        raise ValueError("Card must be a JSON object")
    required = ("name", "rollNo", "course", "department", "prn")
    if any(not str(card.get(key, "")).strip() for key in required):
        raise ValueError("Name, roll number, course, department, and PRN are required")

    cleaned = dict(card)
    cleaned["id"] = str(card.get("id") or secrets.token_hex(12))
    cleaned["name"] = str(card["name"]).strip()
    cleaned["rollNo"] = re.sub(r"\D", "", str(card["rollNo"]))
    cleaned["prn"] = re.sub(r"\D", "", str(card["prn"]))
    if not 1 <= len(cleaned["rollNo"]) <= 3 or len(cleaned["prn"]) != 9:
        raise ValueError("Roll number must be 1 to 3 digits and PRN must be 9 digits")
    if force_pending:
        cleaned.update(status="Pending", signedBy="", signedAt="")
    else:
        cleaned["status"] = card.get("status") if card.get("status") in {"Verified", "Blocked"} else "Pending"
    cleaned.setdefault("createdAt", now_iso())
    cleaned.setdefault("signedBy", "")
    cleaned.setdefault("signedAt", "")
    return cleaned


def save_card(connection, card, ignore_existing=False):
    card_json = json.dumps(card, ensure_ascii=True, separators=(",", ":"))
    command = "INSERT OR IGNORE" if ignore_existing else "INSERT OR REPLACE"
    connection.execute(
        f"{command} INTO student_cards (id, name, roll_no, prn, status, data_json, created_at, signed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            card["id"], card["name"], card["rollNo"], card["prn"], card["status"],
            card_json, card["createdAt"], card.get("signedAt") or None,
        ),
    )


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in extra_headers or []:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("Invalid request size")
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ValueError("Invalid JSON body") from error

    def session_id(self, name):
        cookies = http.cookies.SimpleCookie()
        cookies.load(self.headers.get("Cookie", ""))
        morsel = cookies.get(name)
        return morsel.value if morsel else ""

    def session_user(self, kind):
        token = self.session_id(f"{kind}_session")
        expires_at = SESSIONS[kind].get(token)
        if not expires_at:
            return ""
        if expires_at <= dt.datetime.now(dt.timezone.utc):
            SESSIONS[kind].pop(token, None)
            STUDENT_CARDS.pop(token, None)
            return ""
        return token

    def issue_session(self, kind, response, student_card_id=""):
        token = secrets.token_urlsafe(32)
        SESSIONS[kind][token] = dt.datetime.now(dt.timezone.utc) + SESSION_TTL
        if student_card_id:
            STUDENT_CARDS[token] = student_card_id
        cookie = f"{kind}_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800"
        self.send_json(200, response, [("Set-Cookie", cookie)])

    def clear_session(self, kind):
        token = self.session_id(f"{kind}_session")
        SESSIONS[kind].pop(token, None)
        STUDENT_CARDS.pop(token, None)
        cookie = f"{kind}_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
        self.send_json(200, {"ok": True}, [("Set-Cookie", cookie)])

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json(200, {"ok": True, "database": "sqlite"})
            return
        if path == "/api/admin/cards":
            if not self.session_user("admin"):
                self.send_json(401, {"error": "Admin login required"})
                return
            with db_session() as connection:
                cards = [json.loads(row["data_json"]) for row in connection.execute(
                    "SELECT data_json FROM student_cards ORDER BY created_at DESC"
                )]
            self.send_json(200, {"cards": cards})
            return
        if path == "/api/student/card":
            token = self.session_user("student")
            if not token:
                self.send_json(401, {"error": "Student login required"})
                return
            with db_session() as connection:
                row = connection.execute(
                    "SELECT data_json FROM student_cards WHERE id = ? AND status = 'Verified'",
                    (STUDENT_CARDS.get(token, ""),),
                ).fetchone()
            if not row:
                self.send_json(404, {"error": "Verified card not found"})
                return
            self.send_json(200, {"card": json.loads(row["data_json"])})
            return
        if path in {"/", "/index.html", "/style.css", "/app.js"}:
            super().do_GET()
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
            if path == "/api/cards":
                card = clean_card(body, force_pending=True)
                with db_session() as connection:
                    save_card(connection, card)
                self.send_json(201, {"ok": True, "id": card["id"], "status": card["status"]})
                return

            if path == "/api/admin/login":
                username = str(body.get("username", "")) if isinstance(body, dict) else ""
                password = str(body.get("password", "")) if isinstance(body, dict) else ""
                valid_user = hmac.compare_digest(username.encode(), ADMIN_USERNAME.encode())
                valid_password = hmac.compare_digest(password.encode(), ADMIN_PASSWORD.encode())
                if not (valid_user and valid_password):
                    self.send_json(401, {"error": "Invalid admin username or password"})
                    return
                self.issue_session("admin", {"ok": True})
                return

            if path == "/api/admin/cards/import":
                if not self.session_user("admin"):
                    self.send_json(401, {"error": "Admin login required"})
                    return
                cards = body if isinstance(body, list) else body.get("cards", []) if isinstance(body, dict) else []
                if not isinstance(cards, list):
                    raise ValueError("Cards import must be a list")
                imported = 0
                with db_session() as connection:
                    for item in cards:
                        try:
                            card = clean_card(item)
                        except ValueError:
                            continue
                        before = connection.total_changes
                        save_card(connection, card, ignore_existing=True)
                        imported += connection.total_changes - before
                self.send_json(200, {"ok": True, "imported": imported})
                return

            if path == "/api/student/login":
                name = str(body.get("name", "")).strip() if isinstance(body, dict) else ""
                prn = re.sub(r"\D", "", str(body.get("prn", ""))) if isinstance(body, dict) else ""
                if len(prn) != 9:
                    self.send_json(400, {"error": "PRN must be exactly 9 digits"})
                    return
                with db_session() as connection:
                    row = connection.execute(
                        "SELECT id, status, data_json FROM student_cards "
                        "WHERE name = ? COLLATE NOCASE AND prn = ? LIMIT 1",
                        (name, prn),
                    ).fetchone()
                if not row:
                    self.send_json(401, {"error": "Details did not match a verified card"})
                    return
                if row["status"] == "Blocked":
                    self.send_json(403, {"error": "This ID card has been blocked. Contact the admin office."})
                    return
                if row["status"] != "Verified":
                    self.send_json(403, {"error": "This ID card is not verified yet."})
                    return
                self.issue_session(
                    "student", {"ok": True, "card": json.loads(row["data_json"])},
                    student_card_id=row["id"],
                )
                return

            if path == "/api/admin/logout":
                self.clear_session("admin")
                return
            if path == "/api/student/logout":
                self.clear_session("student")
                return

            match = re.fullmatch(r"/api/admin/cards/([^/]+)/(verify|block|unblock)", path)
            if match:
                if not self.session_user("admin"):
                    self.send_json(401, {"error": "Admin login required"})
                    return
                card_id = match.group(1)
                action = match.group(2)
                with db_session() as connection:
                    row = connection.execute(
                        "SELECT data_json FROM student_cards WHERE id = ?", (card_id,)
                    ).fetchone()
                    if not row:
                        self.send_json(404, {"error": "Card not found"})
                        return
                    card = json.loads(row["data_json"])
                    if action == "verify":
                        if card.get("status") == "Blocked":
                            self.send_json(409, {"error": "Unblock this card before verifying it."})
                            return
                        card.update(status="Verified", signedBy="Admin Office", signedAt=now_iso())
                    elif action == "block":
                        if card.get("status") != "Blocked":
                            card["statusBeforeBlock"] = card.get("status", "Pending")
                            card.update(status="Blocked", blockedBy="Admin Office", blockedAt=now_iso())
                    else:
                        if card.get("status") != "Blocked":
                            self.send_json(409, {"error": "This card is not blocked."})
                            return
                        previous_status = card.pop("statusBeforeBlock", "Pending")
                        card["status"] = previous_status if previous_status in {"Pending", "Verified"} else "Pending"
                        card.pop("blockedBy", None)
                        card.pop("blockedAt", None)
                    save_card(connection, card)
                self.send_json(200, {"ok": True, "card": card})
                return

            self.send_json(404, {"error": "API route not found"})
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except sqlite3.Error:
            self.send_json(500, {"error": "Database operation failed"})


class LocalThreadingHTTPServer(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def main():
    port = int(os.environ.get("PORT", "8000"))
    connection = connect_db()
    connection.commit()
    connection.close()
    server = LocalThreadingHTTPServer(("::1", port), AppHandler)
    print(f"Student ID portal running at http://localhost:{port}")
    print(f"SQLite database: {DATABASE_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
