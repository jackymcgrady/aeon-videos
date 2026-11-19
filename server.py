#!/usr/bin/env python3
"""Aeon Videos — static files + a tiny shared-state API. Python 3 standard library only.

    python3 server.py                       # 0.0.0.0:7781, serves this folder
    python3 server.py --port 7781 --bind 0.0.0.0

Static: GET/HEAD of the site files (.html .js .css .svg .png .ico .webmanifest) in this
folder; dot-files, other extensions and anything outside the folder are 404.
API:    GET /api/state  -> {"version":1,"updated_at":..,"devices":{..},"videos":{url:{favorite,watched,updated_at,device}}}
        PUT /api/state  <- {"device":"..","videos":{url:{favorite,watched,updated_at}}}
        Merged per video, last write wins on updated_at (epoch ms); returns the full state.
State lives in state.json next to this file (git-ignored; update.sh never touches it).
"""
import argparse
import gzip
import json
import os
import sys
import tempfile
import threading
import time
from email.utils import formatdate, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.realpath(__file__))
STATE_PATH = os.path.join(ROOT, "state.json")
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
}
MAX_BODY = 4 * 1024 * 1024
MAX_VIDEOS = 50000
MAX_KEY = 600
MAX_DEVICE = 64
FUTURE_SLACK_MS = 60 * 1000  # a device with a fast clock cannot win forever

LOCK = threading.Lock()
GZ_CACHE = {}  # path -> (mtime_ns, size, gzipped bytes)


def now_ms():
    return int(time.time() * 1000)


def iso(ms):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))


def empty_state():
    return {"version": 1, "updated_at": None, "devices": {}, "videos": {}}


def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as fh:
            st = json.load(fh)
        if not isinstance(st, dict) or not isinstance(st.get("videos"), dict):
            raise ValueError("unexpected shape")
        st.setdefault("version", 1)
        st.setdefault("updated_at", None)
        st.setdefault("devices", {})
        return st
    except FileNotFoundError:
        return empty_state()
    except (ValueError, OSError) as exc:
        # Refuse to start rather than overwrite saved marks with an empty state.
        sys.exit("state.json is unreadable (%s) — fix or move it, then restart" % exc)


def save_state(st):
    fd, tmp = tempfile.mkstemp(prefix=".state-", suffix=".tmp", dir=ROOT)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(st, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, STATE_PATH)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def clean_incoming(body):
    """Validate a PUT body; return (device, {key: entry}) or raise ValueError."""
    if not isinstance(body, dict):
        raise ValueError("body must be an object")
    device = body.get("device", "")
    if not isinstance(device, str) or not device or len(device) > MAX_DEVICE:
        raise ValueError("device must be a non-empty string of at most %d chars" % MAX_DEVICE)
    videos = body.get("videos", {})
    if not isinstance(videos, dict):
        raise ValueError("videos must be an object")
    if len(videos) > MAX_VIDEOS:
        raise ValueError("too many videos")
    out = {}
    cap = now_ms() + FUTURE_SLACK_MS
    for key, e in videos.items():
        if not isinstance(key, str) or not key or len(key) > MAX_KEY or not isinstance(e, dict):
            raise ValueError("bad entry for %r" % (key[:80] if isinstance(key, str) else key))
        fav, wat, ts = e.get("favorite", False), e.get("watched", False), e.get("updated_at")
        if not isinstance(fav, bool) or not isinstance(wat, bool):
            raise ValueError("favorite/watched must be booleans (%s)" % key[:80])
        if isinstance(ts, bool) or not isinstance(ts, int) or ts <= 0:
            raise ValueError("updated_at must be epoch milliseconds (%s)" % key[:80])
        out[key] = {"favorite": fav, "watched": wat, "updated_at": min(ts, cap), "device": device}
    return device, out


def merge(st, device, incoming):
    """Last write wins per video. Returns the number of entries that changed."""
    changed = 0
    vids = st["videos"]
    for key, e in incoming.items():
        cur = vids.get(key)
        if cur is None or e["updated_at"] > cur.get("updated_at", 0):
            if cur is None or cur.get("favorite") != e["favorite"] or cur.get("watched") != e["watched"] \
                    or cur.get("updated_at") != e["updated_at"]:
                changed += 1
            vids[key] = e
    t = now_ms()
    st["devices"][device] = iso(t)
    if changed:
        st["updated_at"] = iso(t)
    return changed


def log(msg):
    sys.stderr.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    sys.stderr.flush()


class Handler(BaseHTTPRequestHandler):
    server_version = "AeonVideos/2"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ── plumbing ──
    def log_message(self, fmt, *args):
        if os.environ.get("AEON_QUIET") != "1":
            log("%s %s" % (self.address_string(), fmt % args))

    def send_bytes(self, status, body, ctype, extra=None, head=False):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head and body:
            self.wfile.write(body)

    def send_json(self, status, obj, head=False):
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8", {"Cache-Control": "no-store"}, head)

    def not_found(self, head=False):
        self.send_bytes(404, b"Not found\n", "text/plain; charset=utf-8", head=head)

    # ── routing ──
    def route(self):
        return unquote(urlsplit(self.path).path)

    def do_GET(self, head=False):
        path = self.route()
        if path == "/api/state":
            with LOCK:
                body = json.dumps(STATE, ensure_ascii=False, separators=(",", ":"))
            return self.send_bytes(200, body.encode("utf-8"), "application/json; charset=utf-8",
                                   {"Cache-Control": "no-store"}, head)
        if path.startswith("/api/"):
            return self.send_json(404, {"error": "unknown endpoint"}, head)
        return self.serve_static(path, head)

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_PUT(self):
        if self.route() != "/api/state":
            return self.send_json(404 if not self.route().startswith("/api/") else 405, {"error": "PUT only on /api/state"})
        try:
            n = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self.send_json(411, {"error": "Content-Length required"})
        if n < 0 or n > MAX_BODY:
            return self.send_json(413, {"error": "body too large"})
        raw = self.rfile.read(n)
        try:
            device, incoming = clean_incoming(json.loads(raw.decode("utf-8")))
        except (ValueError, UnicodeDecodeError) as exc:
            return self.send_json(400, {"error": str(exc)})
        with LOCK:
            changed = merge(STATE, device, incoming)
            try:
                save_state(STATE)
            except OSError as exc:
                log("could not write state.json: %s" % exc)
                return self.send_json(500, {"error": "could not save state"})
            body = json.dumps(STATE, ensure_ascii=False, separators=(",", ":"))
        if changed:
            log("state: %d change(s) from %s" % (changed, device))
        self.send_bytes(200, body.encode("utf-8"), "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    def do_POST(self):
        self.send_json(405, {"error": "use PUT /api/state"})

    do_DELETE = do_PATCH = do_POST

    # ── static files (no traversal, allow-listed types, no dot-files) ──
    def serve_static(self, path, head):
        if path.endswith("/"):
            path += "index.html"
        parts = [p for p in path.split("/") if p]
        if not parts or any(p.startswith(".") or "\\" in p or "\x00" in p for p in parts):
            return self.not_found(head)
        full = os.path.realpath(os.path.join(ROOT, *parts))
        if os.path.commonpath([full, ROOT]) != ROOT or not os.path.isfile(full):
            return self.not_found(head)
        ext = os.path.splitext(full)[1].lower()
        if ext not in TYPES:
            return self.not_found(head)
        st = os.stat(full)
        etag = '"%x-%x"' % (st.st_mtime_ns, st.st_size)
        hdrs = {"Cache-Control": "no-cache", "ETag": etag, "Last-Modified": formatdate(st.st_mtime, usegmt=True),
                "Vary": "Accept-Encoding"}
        if self.headers.get("If-None-Match") == etag or self.not_modified_since(st.st_mtime):
            self.send_response(304)
            for k, v in hdrs.items():
                self.send_header(k, v)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        with open(full, "rb") as fh:
            data = fh.read()
        if len(data) > 1024 and "gzip" in self.headers.get("Accept-Encoding", "") and ext != ".png":
            c = GZ_CACHE.get(full)
            if not c or c[0] != st.st_mtime_ns or c[1] != st.st_size:
                c = (st.st_mtime_ns, st.st_size, gzip.compress(data, 6, mtime=0))
                GZ_CACHE[full] = c
            data = c[2]
            hdrs["Content-Encoding"] = "gzip"
        self.send_bytes(200, data, TYPES[ext], hdrs, head)

    def not_modified_since(self, mtime):
        ims = self.headers.get("If-Modified-Since")
        if not ims or self.headers.get("If-None-Match"):
            return False
        try:
            return int(mtime) <= parsedate_to_datetime(ims).timestamp()
        except (TypeError, ValueError):
            return False


def main():
    global STATE
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=7781)
    a = ap.parse_args()
    STATE = load_state()
    httpd = ThreadingHTTPServer((a.bind, a.port), Handler)
    httpd.daemon_threads = True
    log("Aeon Videos on http://%s:%d/ (root %s, %d saved video marks)" % (a.bind, a.port, ROOT, len(STATE["videos"])))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


STATE = empty_state()

if __name__ == "__main__":
    main()
