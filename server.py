"""Serve SailLens and its capability-protected session database."""
import gzip
import hashlib
import hmac
import json
import logging
import os
import re
import shutil
import sqlite3
import threading
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

SESSION = r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"
HASH = r"[0-9a-f]{64}"
ROUTE = re.compile(rf"/api/sessions/({SESSION})(?:/(missing)|/blobs/({HASH}))?")
CHUNK_LIMIT = 4 * 1024**2
MANIFEST_LIMIT = 16 * 1024**2
HASH_LIMIT = 65536
RESERVE = 64 * 1024**2
STAGING_TTL = 7 * 86400


class Problem(Exception):
    def __init__(self, status, message, **detail):
        super().__init__(message)
        self.status = status
        self.detail = detail


def connect(path):
    return sqlite3.connect(path, timeout=10)


def init_database(path):
    with closing(connect(path)) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, secret BLOB NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0, manifest TEXT,
                blob_bytes INTEGER NOT NULL DEFAULT 0,
                created INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE INDEX IF NOT EXISTS sessions_created ON sessions(created);
            CREATE TABLE IF NOT EXISTS blobs (
                session_id TEXT NOT NULL, hash TEXT NOT NULL, data BLOB NOT NULL,
                PRIMARY KEY(session_id, hash)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS staging (
                session_id TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL,
                touched INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY(session_id, hash)
            ) WITHOUT ROWID;
            CREATE INDEX IF NOT EXISTS staging_touched ON staging(touched);
        """)


def reject_json_constant(value):
    raise ValueError("Invalid JSON number")


def check_space(path, size):
    if shutil.disk_usage(path.parent).free < RESERVE + size * 2:
        raise Problem(507, "Onvoldoende opslagruimte op de server.")


def clear_unused_blocks(db):
    # A grace period allows interrupted uploads to resume and readers to finish
    # fetching a revision that another computer has since replaced.
    rows = db.execute("SELECT session_id,hash,size FROM staging WHERE touched < unixepoch()-? "
                      "ORDER BY touched LIMIT 64", (STAGING_TTL,)).fetchall()
    for session_id, key, size in rows:
        db.execute("DELETE FROM blobs WHERE session_id=? AND hash=?", (session_id, key))
        db.execute("DELETE FROM staging WHERE session_id=? AND hash=?", (session_id, key))
        db.execute("UPDATE sessions SET blob_bytes=blob_bytes-? WHERE id=?", (size, session_id))


def validated_hashes(hashes):
    if (not isinstance(hashes, list) or len(hashes) > HASH_LIMIT or
            any(not isinstance(key, str) or not re.fullmatch(HASH, key) for key in hashes)):
        raise Problem(400, "Ongeldige lijst met gegevensblokken.")
    return list(dict.fromkeys(hashes))


def missing_hashes(db, session_id, hashes):
    unique = validated_hashes(hashes)
    found = set()
    for start in range(0, len(unique), 500):
        batch = unique[start:start + 500]
        slots = ",".join("?" for _ in batch)
        rows = db.execute(f"SELECT hash FROM blobs WHERE session_id=? AND hash IN ({slots})",
                          (session_id, *batch))
        found.update(row[0] for row in rows)
        db.execute(f"UPDATE staging SET touched=unixepoch() WHERE session_id=? "
                   f"AND hash IN ({slots}) AND touched < unixepoch()-86400", (session_id, *batch))
    return [key for key in unique if key not in found]


def replace_references(db, session_id, hashes):
    # This table lives only in the request's connection. Protect all current
    # references and retire superseded blocks atomically with the manifest.
    db.execute("CREATE TEMP TABLE next_hashes(hash TEXT PRIMARY KEY) WITHOUT ROWID")
    db.executemany("INSERT INTO next_hashes VALUES(?)", ((key,) for key in validated_hashes(hashes)))
    missing = db.execute("""
        SELECT 1 FROM next_hashes AS n WHERE NOT EXISTS (
            SELECT 1 FROM blobs AS b WHERE b.session_id=? AND b.hash=n.hash
        ) LIMIT 1
    """, (session_id,)).fetchone()
    if missing:
        raise Problem(422, "Upload eerst alle gegevensblokken.")
    db.execute("""
        INSERT OR IGNORE INTO staging(session_id,hash,size)
        SELECT session_id,hash,length(data) FROM blobs
        WHERE session_id=? AND hash NOT IN (SELECT hash FROM next_hashes)
    """, (session_id,))
    db.execute("DELETE FROM staging WHERE session_id=? AND hash IN (SELECT hash FROM next_hashes)", (session_id,))


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def __init__(self, address, database, html, session_limit=2 * 1024**3):
        self.database = Path(database)
        self.session_limit = session_limit
        self.slots = threading.BoundedSemaphore(24)
        init_database(self.database)
        self.html = Path(html).read_bytes()
        self.compressed_html = gzip.compress(self.html, compresslevel=5, mtime=0)
        super().__init__(address, Handler)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        request.settimeout(30)
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "SailLens"

    def log_message(self, fmt, *args):
        # Session URLs, Authorization headers and payloads are private.
        pass

    def reply(self, status, body, kind="application/json; charset=utf-8", compressed=False, revision=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", kind)
        if revision is None:
            self.send_header("Content-Length", str(len(body)))
        else:
            self.send_header("X-Session-Revision", str(revision))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        if compressed:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def body(self, limit, mime):
        if self.headers.get_content_type() != mime:
            raise Problem(415, "Onjuist inhoudstype.")
        length = self.headers.get("Content-Length", "")
        if self.headers.get("Transfer-Encoding") or not length.isdecimal() or len(length) > 10:
            raise Problem(411, "Geef de berichtgrootte op.")
        size = int(length)
        if size > limit:
            raise Problem(413, "Gegevensblok of sessiebeschrijving te groot.")
        data = self.rfile.read(size)
        if len(data) != size:
            raise Problem(400, "Onvolledig bericht.")
        return data

    def payload(self, limit):
        try:
            obj = json.loads(self.body(limit, "application/json").decode(),
                             parse_constant=reject_json_constant)
        except (ValueError, RecursionError) as exc:
            raise Problem(400, "Ongeldige JSON.") from exc
        if not isinstance(obj, dict):
            raise Problem(400, "Ongeldig bericht.")
        return obj

    def credential(self):
        token = re.fullmatch(r"Bearer ([A-Za-z0-9_-]{43})", self.headers.get("Authorization", ""))
        if not token:
            raise Problem(401, "Open de volledige privélink van de sessie.")
        return hashlib.sha256(token[1].encode("ascii")).digest()

    def session(self, db, session_id, secret):
        row = db.execute("SELECT secret,revision FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not row or not hmac.compare_digest(row[0], secret):
            raise Problem(404, "Sessie niet gevonden met deze privélink.")
        return row[1]

    def create_session(self, db, secret):
        session_id = self.payload(512).get("id")
        if not isinstance(session_id, str) or not re.fullmatch(SESSION, session_id):
            raise Problem(400, "Ongeldige sessie-ID.")
        db.execute("BEGIN IMMEDIATE")
        if not db.execute("SELECT 1 FROM sessions WHERE id=?", (session_id,)).fetchone():
            clear_unused_blocks(db)
            count, = db.execute("SELECT count(*) FROM sessions WHERE created >= unixepoch()-3600").fetchone()
            if count >= 240:
                raise Problem(429, "Te veel nieuwe sessies. Probeer het later opnieuw.")
            check_space(self.server.database, 4096)
            db.execute("INSERT INTO sessions(id,secret) VALUES(?,?)", (session_id, secret))
        revision = self.session(db, session_id, secret)
        db.commit()
        self.reply(200, {"revision": revision})

    def blob(self, db, session_id, key):
        if self.command == "GET":
            row = db.execute("SELECT data FROM blobs WHERE session_id=? AND hash=?", (session_id, key)).fetchone()
            if row is None:
                raise Problem(404, "Gegevensblok ontbreekt.")
            self.reply(200, row[0], "application/octet-stream")
            return
        if self.command != "PUT":
            raise Problem(405, "Methode niet toegestaan.")
        data = self.body(CHUNK_LIMIT, "application/octet-stream")
        if hashlib.sha256(data).hexdigest() != key:
            raise Problem(422, "Controlegetal van het gegevensblok klopt niet.")
        db.execute("BEGIN IMMEDIATE")
        db.execute("UPDATE staging SET touched=unixepoch() WHERE session_id=? AND hash=? "
                   "AND touched < unixepoch()-86400", (session_id, key))
        clear_unused_blocks(db)
        if not db.execute("SELECT 1 FROM blobs WHERE session_id=? AND hash=?", (session_id, key)).fetchone():
            check_space(self.server.database, len(data))
            used, = db.execute("SELECT blob_bytes FROM sessions WHERE id=?", (session_id,)).fetchone()
            if used + len(data) > self.server.session_limit:
                raise Problem(507, "Opslaglimiet voor deze sessie bereikt.")
            db.execute("INSERT INTO blobs(session_id,hash,data) VALUES(?,?,?)", (session_id, key, data))
            db.execute("INSERT INTO staging(session_id,hash,size) VALUES(?,?,?)", (session_id, key, len(data)))
            db.execute("UPDATE sessions SET blob_bytes=blob_bytes+? WHERE id=?", (len(data), session_id))
        db.commit()
        self.reply(200, {"ok": True})

    def save_manifest(self, db, session_id):
        payload = self.payload(MANIFEST_LIMIT)
        version = payload.get("baseRevision")
        if type(version) is not int or version < 0 or payload.get("manifest") is None:
            raise Problem(400, "Geef de basisversie en de sessiebeschrijving op.")
        try:
            manifest = json.dumps(payload["manifest"], allow_nan=False, separators=(",", ":"))
        except (ValueError, RecursionError) as exc:
            raise Problem(400, "Ongeldige sessiebeschrijving.") from exc
        db.execute("BEGIN IMMEDIATE")
        current, = db.execute("SELECT revision FROM sessions WHERE id=?", (session_id,)).fetchone()
        retry = current == version + 1 and db.execute(
            "SELECT 1 FROM sessions WHERE id=? AND manifest=?", (session_id, manifest)).fetchone()
        if current != version and not retry:
            raise Problem(409, "De online sessie heeft inmiddels een nieuwere versie.", revision=current)
        if not retry:
            replace_references(db, session_id, payload.get("hashes"))
            check_space(self.server.database, len(manifest))
            current += 1
            db.execute("UPDATE sessions SET manifest=?, revision=? WHERE id=?", (manifest, current, session_id))
        db.commit()
        self.reply(200, {"revision": current})

    def dispatch(self):
        path = urlsplit(self.path).path
        read = self.command in ("GET", "HEAD")
        if path in ("/", "/SailLens.html", "/index.html") and read:
            compressed = "gzip" in self.headers.get("Accept-Encoding", "").lower()
            self.reply(200, self.server.compressed_html if compressed else self.server.html,
                       "text/html; charset=utf-8", compressed)
            return
        if path == "/api/health" and read:
            with closing(connect(self.server.database)) as db:
                db.execute("SELECT revision FROM sessions LIMIT 1").fetchone()
            self.reply(200, {"ok": True})
            return
        if not path.startswith("/api/"):
            raise Problem(404, "Niet gevonden.")
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in ("http", "https") or parsed.netloc.lower() != self.headers.get("Host", "").lower():
                raise Problem(403, "Open SailLens op hetzelfde adres.")
        secret = self.credential()
        with closing(connect(self.server.database)) as db:
            if path == "/api/sessions" and self.command == "POST":
                self.create_session(db, secret)
                return
            route = ROUTE.fullmatch(path)
            if not route:
                raise Problem(404, "Niet gevonden.")
            session_id, missing, key = route.groups()
            revision = self.session(db, session_id, secret)
            if key:
                self.blob(db, session_id, key)
            elif missing and self.command == "POST":
                hashes = self.payload(5 * 1024**2).get("hashes")
                db.execute("BEGIN IMMEDIATE")
                missing_keys = missing_hashes(db, session_id, hashes)
                db.commit()
                self.reply(200, {"missing": missing_keys})
            elif not missing and self.command == "HEAD":
                self.reply(200, b"", revision=revision)
            elif not missing and self.command == "GET":
                rev, manifest = db.execute("SELECT revision,manifest FROM sessions WHERE id=?", (session_id,)).fetchone()
                self.reply(200, {"revision": rev, "manifest": json.loads(manifest) if manifest else None})
            elif not missing and self.command == "PUT":
                self.save_manifest(db, session_id)
            else:
                raise Problem(405, "Methode niet toegestaan.")

    def handle_api(self):
        try:
            self.dispatch()
        except Problem as exc:
            self.reply(exc.status, {"error": str(exc), **exc.detail})
        except sqlite3.Error as exc:
            code = getattr(exc, "sqlite_errorname", type(exc).__name__)
            logging.error("Database operation failed (%s)", code)
            if code == "SQLITE_FULL":
                self.reply(507, {"error": "Onvoldoende opslagruimte op de server."})
            else:
                self.reply(503, {"error": "Online opslag tijdelijk niet beschikbaar."})
        except (TimeoutError, BrokenPipeError, ConnectionResetError):
            return

    do_GET = do_HEAD = do_PUT = do_POST = handle_api


if __name__ == "__main__":
    directory = Path(os.environ.get("SAILLENS_DATA_DIR", "/data")).resolve()
    if os.environ.get("RAILWAY_PROJECT_ID") or os.environ.get("RAILWAY_ENVIRONMENT_ID"):
        mounts = {line.split()[4] for line in Path("/proc/self/mountinfo").read_text().splitlines()}
        if str(directory) not in mounts:
            raise SystemExit(f"A persistent Railway volume must be mounted at {directory}.")
    directory.mkdir(parents=True, exist_ok=True)
    with Server(("0.0.0.0", int(os.environ.get("PORT", 8080))),
                directory / "saillens.sqlite3", Path(__file__).with_name("SailLens.html")) as server:
        print("SailLens HTTP service ready.", flush=True)
        server.serve_forever()
