#!/usr/bin/env python3
"""Dev server for the landscape build.

Same static file server as serve.py, plus a POST /shot?name=xxx endpoint that
writes a base64 PNG (a canvas data URL) to shots/<name>.png. That lets the
page hand its rendered frame to the disk so it can be inspected.

Usage: python3 shotserver.py [port] [root]
"""
import base64
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SHOTS = "shots"


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        if not self.path.startswith("/shot"):
            self.send_error(404)
            return
        name = "shot"
        if "?" in self.path:
            for part in self.path.split("?", 1)[1].split("&"):
                if part.startswith("name="):
                    name = part[5:]
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", "replace")
        if "," in body:
            body = body.split(",", 1)[1]
        try:
            data = base64.b64decode(body)
        except Exception:
            self.send_error(400, "bad base64")
            return
        os.makedirs(SHOTS, exist_ok=True)
        path = os.path.join(SHOTS, name if name.endswith(".png") else name + ".png")
        with open(path, "wb") as f:
            f.write(data)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        # never cache during development, or a stale script looks like a bug
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    root = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    os.chdir(root)
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("serving %s on http://localhost:%d (with /shot)" % (root, port))
    server.serve_forever()


if __name__ == "__main__":
    main()
