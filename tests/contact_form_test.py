"""Exercise the real PHP endpoint using a local fake mail transport. No email is sent."""
import email.policy
from email.parser import BytesParser
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import secrets
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPCookieProcessor


def main():
    php = os.environ.get("PHP_BINARY") or shutil.which("php")
    if not php:
        raise SystemExit("PHP 8.x is required. Install it or set PHP_BINARY.")
    with tempfile.TemporaryDirectory(prefix="alaqsa-test-") as folder:
        temp = Path(folder)
        web = temp / "web"
        web.mkdir()
        (temp / "sessions").mkdir()
        shutil.copy(Path(__file__).resolve().parents[1] / "contact.php", web / "contact.php")
        transport = temp / "fake-sendmail.py"
        transport.write_text(
            "import sys, pathlib, json, uuid\n"
            f"root = pathlib.Path({str(temp)!r})\n"
            "body = sys.stdin.buffer.read()\n"
            "if (root / 'fail-mail').exists(): sys.exit(1)\n"
            "target = root / (uuid.uuid4().hex + '.eml')\n"
            "target.write_bytes(body)\n"
            "target.with_suffix('.args').write_text(json.dumps(sys.argv[1:]))\n"
        )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        url = origin + "/contact.php"
        log = (temp / "server.log").open("w+")
        command = [php, "-n", "-d", f"session.save_path={temp / 'sessions'}", "-d",
                   f"sys_temp_dir={temp}", "-d",
                   f"sendmail_path={shlex.quote(sys.executable)} {shlex.quote(str(transport))}",
                   "-S", f"127.0.0.1:{port}", "-t", str(web)]
        server = subprocess.Popen(command, stdout=log, stderr=log)
        client = build_opener(HTTPCookieProcessor(CookieJar()))

        def request(fields=None, method=None, headers=None, opener=None):
            data = urlencode(fields).encode() if fields is not None else None
            req = Request(url, data, {"Accept": "application/json", "Origin": origin,
                                     **(headers or {})}, method=method)
            try:
                result = (opener or client).open(req, timeout=5)
            except HTTPError as error:
                result = error
            return result.status, json.loads(result.read()), result.headers

        def payload(token):
            return {"token": token, "request_id": secrets.token_hex(16), "website": "",
                    "name": "Test visitor — يامن", "email": "visitor@example.com",
                    "project": "Website design & development",
                    "message": "I need a new website.\nمرحبا — café"}

        try:
            for _ in range(100):
                if server.poll() is not None:
                    log.seek(0)
                    raise AssertionError(log.read())
                try:
                    code, ready, headers = request()
                    break
                except URLError:
                    time.sleep(.05)
            else:
                raise AssertionError("PHP server did not start")
            assert code == 200 and ready["ok"] and len(ready["token"]) == 64
            assert "no-store" in headers["Cache-Control"]
            assert "HttpOnly" in headers["Set-Cookie"]
            assert "SameSite=Strict" in headers["Set-Cookie"]
            fields = payload(ready["token"])
            assert request(method="DELETE")[0] == 405
            assert request(fields, headers={"Origin": "https://unrelated.example"})[0] == 403
            assert request(fields, headers={"Sec-Fetch-Site": "cross-site"})[0] == 403
            assert request({**fields, "token": "incorrect"})[0] == 403
            other = build_opener(HTTPCookieProcessor(CookieJar()))
            assert request(fields, opener=other)[0] == 403
            for key, value in [("website", "https://spam.example"), ("email", "not-an-email"),
                               ("email", "visitor@example.com\r\nBcc: other@example.com"),
                               ("name", "\r\n"), ("name", "a" * 161),
                               ("project", "unlisted"), ("message", "   "),
                               ("message", "a" * 5001), ("request_id", "invalid")]:
                assert request({**fields, key: value})[0] == 422, key
            malformed = {k: v for k, v in fields.items() if k != "name"}
            malformed["name[]"] = "array input"
            assert request(malformed)[0] == 422
            assert request({**fields, "message": "a" * 40000})[0] == 413
            assert not list(temp.glob("*.eml")), "Invalid requests must not send email"
            print("PASS: validation, injection rejection, CSRF, origins and size limits")

            code, body, _ = request(fields)
            assert code == 200 and body["ok"], body
            sent = list(temp.glob("*.eml"))
            assert len(sent) == 1
            message = BytesParser(policy=email.policy.default).parsebytes(sent[0].read_bytes())
            assert message["To"] == "info@al-aqsa.eu"
            assert message["Reply-To"] == fields["email"]
            assert message["From"].addresses[0].addr_spec == "info@al-aqsa.eu"
            assert message["Bcc"] is None
            assert "-finfo@al-aqsa.eu" in json.loads(sent[0].with_suffix(".args").read_text())
            decoded = message.get_content().replace("\r\n", "\n")
            for key in ["name", "email", "project", "message"]:
                assert fields[key] in decoded, key
            assert request(fields)[1]["ok"]
            assert len(list(temp.glob("*.eml"))) == 1, "Retry duplicated a message"
            assert request({**fields, "message": "Changed payload, reused ID"})[0] == 409
            print("PASS: recipient, Reply-To, Unicode body and duplicate protection")

            (temp / "fail-mail").touch()
            retry = payload(ready["token"])
            code, body, _ = request(retry)
            assert code == 503 and body["ok"] is False and body["error_code"] == "mail_rejected"
            assert len(list(temp.glob("*.eml"))) == 1
            (temp / "fail-mail").unlink()
            assert request(retry)[1]["ok"]
            assert len(list(temp.glob("*.eml"))) == 2
            print("PASS: transport failure is not reported as success; retry works")

            # A new browser session cannot bypass the network-address limit.
            code, ready2, _ = request(opener=other)
            for _ in range(2):
                assert request(payload(ready2["token"]), opener=other)[1]["ok"]
            code, body, headers = request(payload(ready2["token"]), opener=other)
            assert code == 429 and not body["ok"] and int(headers["Retry-After"]) > 0
            assert len(list(temp.glob("*.eml"))) == 4
            state = next(temp.glob("alaqsa-enquiries-*/limits.json")).read_text()
            assert "127.0.0.1" not in state and "visitor@example.com" not in state
            assert request(fields)[1]["ok"], "A duplicate needs no new rate-limit allowance"
            print("PASS: limits persist across sessions; security records exclude raw addresses and content")
        finally:
            server.terminate()
            server.wait(timeout=5)
            log.close()


if __name__ == "__main__":
    main()
