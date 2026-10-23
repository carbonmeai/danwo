"""
A small app outside Node for the runner's tests: Python's standard library only, so it has no
preload and reaches the proxy through the variables danwo sets. It listens on PORT, sends a
welcome email through Resend's API on POST /signup, and on GET /outside calls a host no route
answers, answering with the status it got.
"""

import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def call(url, body=None):
    """The status `url` answers with, POSTing `body` as JSON when given."""
    request = urllib.request.Request(
        url,
        data=None if body is None else json.dumps(body).encode(),
        headers={"authorization": "Bearer re_test_mail_app", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


class Handler(BaseHTTPRequestHandler):
    def answer(self, status, text):
        self.send_response(status)
        self.send_header("content-type", "text/plain")
        self.end_headers()
        self.wfile.write(text.encode())

    def do_POST(self):
        if self.path != "/signup":
            return self.answer(404, "not found")
        status = call(
            "https://api.resend.com/emails",
            {
                "from": "hello@mail-app.test",
                "to": "ada@example.com",
                "subject": "Welcome",
                "html": "<p>Your code is 482913</p>",
            },
        )
        self.answer(200 if status == 200 else 502, str(status))

    def do_GET(self):
        if self.path == "/outside":
            return self.answer(200, str(call("https://outside.mail-app.test/")))
        self.answer(200, "proxied: " + ("yes" if "HTTPS_PROXY" in os.environ else "no"))

    def log_message(self, format, *args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", int(os.environ["PORT"])), Handler)
print("listening", flush=True)
server.serve_forever()
