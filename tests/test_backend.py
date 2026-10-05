import http.cookiejar
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener

import backend


class BackendApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "test-cards.db"
        self.database_patch = patch.object(backend, "DATABASE_PATH", self.database_path)
        self.database_patch.start()
        backend.SESSIONS["admin"].clear()
        backend.SESSIONS["student"].clear()
        backend.STUDENT_CARDS.clear()

        self.server = backend.LocalThreadingHTTPServer(("::1", 0), backend.AppHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.base_url = f"http://[::1]:{self.server.server_port}"
        self.anonymous = build_opener(ProxyHandler({}))
        self.admin = self.cookie_client()
        self.student = self.cookie_client()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        self.database_patch.stop()
        self.temp_dir.cleanup()
        backend.SESSIONS["admin"].clear()
        backend.SESSIONS["student"].clear()
        backend.STUDENT_CARDS.clear()

    @staticmethod
    def cookie_client():
        return build_opener(ProxyHandler({}), HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request_json(self, path, method="GET", payload=None, client=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            response = (client or self.anonymous).open(request)
            return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                return error.code, json.loads(error.read().decode("utf-8"))
            finally:
                error.close()

    def test_pending_card_requires_admin_verification(self):
        card = {
            "id": "test-card-1",
            "name": "Portal Test",
            "rollNo": "80",
            "course": "B.E.",
            "department": "Data Science",
            "prn": "251106090",
            "email": "student@example.com",
            "phone": "9876543210",
            "bloodGroup": "B+",
            "dob": "2007-10-26",
            "abcId": "ABC000001",
            "address": "Shirpur",
            "photoDataUrl": "",
            "qrDataUrl": "data:image/png;base64,test",
        }
        status, saved = self.request_json("/api/cards", "POST", card)
        self.assertEqual(status, 201)
        self.assertEqual(saved["status"], "Pending")
        self.assertEqual(self.request_json("/api/admin/cards")[0], 401)
        self.assertEqual(
            self.request_json("/api/student/login", "POST", {"name": card["name"], "prn": card["prn"]})[0],
            403,
        )

        status, _ = self.request_json(
            "/api/admin/login",
            "POST",
            {"username": "admin", "password": "admin123"},
            self.admin,
        )
        self.assertEqual(status, 200)
        status, listing = self.request_json("/api/admin/cards", client=self.admin)
        self.assertEqual(status, 200)
        self.assertEqual(listing["cards"][0]["status"], "Pending")

        status, verified = self.request_json(
            "/api/admin/cards/test-card-1/verify", "POST", {}, self.admin
        )
        self.assertEqual(status, 200)
        self.assertEqual(verified["card"]["status"], "Verified")

        status, blocked = self.request_json(
            "/api/admin/cards/test-card-1/block", "POST", {}, self.admin
        )
        self.assertEqual(status, 200)
        self.assertEqual(blocked["card"]["status"], "Blocked")
        self.assertEqual(blocked["card"]["statusBeforeBlock"], "Verified")
        status, admin_listing = self.request_json("/api/admin/cards", client=self.admin)
        self.assertEqual(status, 200)
        self.assertEqual(admin_listing["cards"][0]["status"], "Blocked")
        status, blocked_login = self.request_json(
            "/api/student/login",
            "POST",
            {"name": card["name"], "prn": card["prn"]},
            self.student,
        )
        self.assertEqual(status, 403)
        self.assertIn("blocked", blocked_login["error"].lower())

        status, unblocked = self.request_json(
            "/api/admin/cards/test-card-1/unblock", "POST", {}, self.admin
        )
        self.assertEqual(status, 200)
        self.assertEqual(unblocked["card"]["status"], "Verified")

        status, logged_in = self.request_json(
            "/api/student/login",
            "POST",
            {"name": "portal test", "prn": card["prn"]},
            self.student,
        )
        self.assertEqual(status, 200)
        self.assertEqual(logged_in["card"]["id"], card["id"])
        self.assertEqual(self.request_json("/api/student/card", client=self.student)[0], 200)
        self.assertEqual(self.request_json("/api/student/logout", "POST", {}, self.student)[0], 200)
        self.assertEqual(self.request_json("/api/student/card", client=self.student)[0], 401)

    def test_rejects_invalid_roll_number_and_prn(self):
        card = {
            "name": "Portal Test",
            "rollNo": "1234",
            "course": "B.E.",
            "department": "Data Science",
            "prn": "123456789",
        }
        self.assertEqual(self.request_json("/api/cards", "POST", card)[0], 400)
        card["rollNo"] = "80"
        card["prn"] = "12345"
        self.assertEqual(self.request_json("/api/cards", "POST", card)[0], 400)
        card["prn"] = "1234567890"
        self.assertEqual(self.request_json("/api/cards", "POST", card)[0], 400)

    def test_admin_signature_is_private_persistent_and_added_when_verifying(self):
        signature = "data:image/png;base64,aGVsbG8="
        self.assertEqual(self.request_json("/api/admin/signature")[0], 401)
        self.assertEqual(
            self.request_json("/api/admin/signature", "POST", {"signatureDataUrl": signature})[0],
            401,
        )
        self.assertEqual(
            self.request_json(
                "/api/admin/login", "POST",
                {"username": "admin", "password": "admin123"}, self.admin,
            )[0],
            200,
        )
        self.assertEqual(
            self.request_json(
                "/api/admin/signature", "POST", {"signatureDataUrl": signature}, self.admin
            )[0],
            200,
        )
        self.assertEqual(
            self.request_json("/api/admin/signature", client=self.admin)[1]["signatureDataUrl"],
            signature,
        )
        self.assertEqual(
            self.request_json(
                "/api/admin/signature", "POST", {"signatureDataUrl": "javascript:alert(1)"}, self.admin
            )[0],
            400,
        )
        card = {
            "id": "signature-card", "name": "Signed Student", "rollNo": "80",
            "course": "B.E.", "department": "Data Science", "prn": "251106090",
        }
        self.assertEqual(self.request_json("/api/cards", "POST", card)[0], 201)
        _, verified = self.request_json(
            "/api/admin/cards/signature-card/verify", "POST", {}, self.admin
        )
        self.assertEqual(verified["card"]["directorSignatureDataUrl"], signature)
        self.assertEqual(verified["card"]["status"], "Verified")

    def test_migrates_name_from_legacy_database(self):
        connection = sqlite3.connect(self.database_path)
        connection.execute(
            "CREATE TABLE student_cards ("
            "id TEXT PRIMARY KEY, roll_no TEXT NOT NULL, prn TEXT NOT NULL, "
            "status TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, signed_at TEXT)"
        )
        legacy_card = {
            "id": "legacy-card",
            "name": "Legacy Student",
            "rollNo": "80",
            "course": "B.E.",
            "department": "Data Science",
            "prn": "251106090",
            "status": "Verified",
            "createdAt": "2026-01-01T00:00:00+00:00",
        }
        connection.execute(
            "INSERT INTO student_cards VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                legacy_card["id"],
                legacy_card["rollNo"],
                legacy_card["prn"],
                legacy_card["status"],
                json.dumps(legacy_card),
                legacy_card["createdAt"],
                None,
            ),
        )
        connection.commit()
        connection.close()

        migrated = backend.connect_db()
        migrated.commit()
        row = migrated.execute(
            "SELECT name, status FROM student_cards WHERE id = ?", (legacy_card["id"],)
        ).fetchone()
        migrated.close()
        self.assertEqual(row["name"], "Legacy Student")
        self.assertEqual(row["status"], "Verified")

    def test_database_and_server_source_are_not_public_files(self):
        self.assertEqual(self.request_json("/api/health")[0], 200)
        self.assertEqual(self.request_json("/student_cards.db")[0], 404)
        self.assertEqual(self.request_json("/backend.py")[0], 404)


if __name__ == "__main__":
    unittest.main()
