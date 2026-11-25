import concurrent.futures
import hashlib
import http.client
import json
import secrets
import sqlite3
import sys
import tempfile
import threading
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Server


class OnlineSessionTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "sessions.sqlite3"
        self.html = Path(temp.name) / "index.html"
        self.html.write_text("<title>SailLens</title>")
        self.key = secrets.token_urlsafe(32)
        self.session_id = str(uuid.uuid4())
        self.route = "/api/sessions/" + self.session_id
        self.start()
        self.addCleanup(self.stop)

    def start(self):
        self.server = Server(("127.0.0.1", 0), self.path, self.html)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02})
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()

    def request(self, method, path, data=None, token=True, headers=None, with_headers=False):
        headers = dict(headers or {})
        if token:
            headers["Authorization"] = "Bearer " + (self.key if token is True else token)
        if isinstance(data, bytes):
            headers["Content-Type"] = "application/octet-stream"
        elif data is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(data)
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request(method, path, data, headers)
            resp = connection.getresponse()
            body = resp.read()
            if body and resp.getheader("Content-Type", "").startswith("application/json"):
                body = json.loads(body)
            if with_headers:
                return resp.status, body, dict(resp.getheaders())
            return resp.status, body
        finally:
            connection.close()

    def create(self, **opts):
        return self.request("POST", "/api/sessions", {"id": self.session_id}, **opts)

    def save(self, base, value, hashes):
        return self.request("PUT", self.route,
                            {"baseRevision": base, "manifest": {"value": value}, "hashes": hashes})

    def test_old_client_cannot_replace_committed_state(self):
        self.assertEqual(self.create(), (200, {"revision": 0}))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda value: self.save(0, value, []), ("a", "b")))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        winner = "a" if results[0][0] == 200 else "b"
        self.assertEqual(self.request("GET", self.route), (200, {"revision": 1, "manifest": {"value": winner}}))
        self.assertEqual(self.create(), (200, {"revision": 1}))

    def test_missing_upload_verify_and_restart(self):
        self.create()
        blob = b"log" * 100
        key = hashlib.sha256(blob).hexdigest()
        path = self.route + "/blobs/" + key
        self.assertEqual(self.save(0, "v1", [key])[0], 422)
        self.assertEqual(self.request("POST", self.route + "/missing", {"hashes": [key, key]}),
                         (200, {"missing": [key]}))
        self.assertEqual(self.request("PUT", path, b"wrong")[0], 422)
        self.assertEqual(self.request("GET", path)[0], 404)
        self.assertEqual(self.request("PUT", path, blob)[0], 200)
        self.assertEqual(self.request("PUT", path, blob)[0], 200)
        self.assertEqual(self.request("POST", self.route + "/missing", {"hashes": [key]}),
                         (200, {"missing": []}))
        self.assertEqual(self.save(0, "v1", [key]), (200, {"revision": 1}))
        self.stop()
        self.start()
        self.assertEqual(self.request("GET", self.route), (200, {"revision": 1, "manifest": {"value": "v1"}}))
        self.assertEqual(self.request("GET", path), (200, blob))

    def test_access_is_scoped_to_token_and_session(self):
        self.assertEqual(self.create(token=False)[0], 401)
        self.assertEqual(self.create(headers={"Origin": "https://another.example"})[0], 403)
        self.create()
        wrong = secrets.token_urlsafe(32)
        self.assertEqual(self.create(token=wrong)[0], 404)
        self.assertEqual(self.request("GET", self.route, token=False)[0], 401)
        self.assertEqual(self.request("GET", self.route, token=wrong)[0], 404)
        key = hashlib.sha256(b"a").hexdigest()
        self.request("PUT", self.route + "/blobs/" + key, b"a")
        other = str(uuid.uuid4())
        self.request("POST", "/api/sessions", {"id": other}, token=wrong)
        self.assertEqual(self.request("GET", "/api/sessions/" + other + "/blobs/" + key, token=wrong)[0], 404)
        self.assertEqual(self.request("GET", self.route, headers={"Origin": "https://another.example"})[0], 403)
        self.assertEqual(self.request("GET", "/api/health", token=False), (200, {"ok": True}))
        self.assertEqual(self.request("HEAD", "/api/health", token=False), (200, b""))
        self.assertEqual(self.request("GET", "/", token=False), (200, self.html.read_bytes()))

    def test_revision_head_and_lost_success_retry(self):
        self.create()
        def probe(token=True):
            status, body, headers = self.request("HEAD", self.route, token=token, with_headers=True)
            return status, body, headers.get("X-Session-Revision")
        self.assertEqual(probe(), (200, b"", "0"))
        self.assertEqual(probe(secrets.token_urlsafe(32)), (404, b"", None))
        self.assertEqual(self.save(0, "same", []), (200, {"revision": 1}))
        self.assertEqual(self.save(0, "same", []), (200, {"revision": 1}))
        self.assertEqual(self.save(0, "different", [])[0], 409)
        self.assertEqual(probe(), (200, b"", "1"))

    def test_abandoned_blocks_expire_and_old_snapshots_remain_readable(self):
        self.create()
        def add(data):
            key = hashlib.sha256(data).hexdigest()
            self.assertEqual(self.request("PUT", self.route + "/blobs/" + key, data)[0], 200)
            return key
        old, abandoned, resumed = [add(k) for k in (b"old", b"abandoned", b"resumed")]
        self.assertEqual(self.save(0, "first", [old])[0], 200)
        self.assertEqual(self.save(1, "second", [])[0], 200)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE staging SET touched=0 WHERE session_id=? AND hash!=?", (self.session_id, old))
        self.assertEqual(self.request("POST", self.route + "/missing", {"hashes": [resumed]}),
                         (200, {"missing": []}))
        add(b"new")
        self.assertEqual(self.request("GET", self.route + "/blobs/" + old), (200, b"old"))
        self.assertEqual(self.request("GET", self.route + "/blobs/" + resumed), (200, b"resumed"))
        self.assertEqual(self.request("GET", self.route + "/blobs/" + abandoned)[0], 404)
        with sqlite3.connect(self.path) as db:
            used, = db.execute("SELECT blob_bytes FROM sessions WHERE id=?", (self.session_id,)).fetchone()
        self.assertEqual(used, len(b"oldresumednew"))
        # Resuming the same blocks in a new revision protects them again. A
        # stale request cannot retire current data or resurrect its old blocks.
        self.assertEqual(self.save(2, "third", [resumed])[0], 200)
        self.assertEqual(self.save(1, "stale", [old])[0], 409)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE staging SET touched=0 WHERE session_id=?", (self.session_id,))
        add(b"latest")
        self.assertEqual(self.request("GET", self.route + "/blobs/" + resumed), (200, b"resumed"))
        self.assertEqual(self.request("GET", self.route + "/blobs/" + old)[0], 404)
        with sqlite3.connect(self.path) as db:
            used, = db.execute("SELECT blob_bytes FROM sessions WHERE id=?", (self.session_id,)).fetchone()
        self.assertEqual(used, len(b"resumedlatest"))

    def test_create_limit_preserves_existing_access(self):
        self.create()
        with sqlite3.connect(self.path) as db:
            db.executemany("INSERT INTO sessions(id,secret) VALUES(?,?)",
                           ((str(uuid.uuid4()), b"digest") for _ in range(239)))
        self.assertEqual(self.request("POST", "/api/sessions", {"id": str(uuid.uuid4())})[0], 429)
        self.assertEqual(self.create(), (200, {"revision": 0}))
        self.assertEqual(self.save(0, "first", []), (200, {"revision": 1}))

    def test_session_quota_does_not_break_idempotent_upload(self):
        self.create()
        self.server.session_limit = 2
        first = self.route + "/blobs/" + hashlib.sha256(b"ok").hexdigest()
        self.assertEqual(self.request("PUT", first, b"ok")[0], 200)
        self.assertEqual(self.request("PUT", first, b"ok")[0], 200)
        key = hashlib.sha256(b"x").hexdigest()
        self.assertEqual(self.request("PUT", self.route + "/blobs/" + key, b"x")[0], 507)
        self.assertEqual(self.save(0, "v1", [key])[0], 422)


if __name__ == "__main__":
    unittest.main()
