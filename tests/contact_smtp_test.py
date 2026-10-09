"""Exercise authenticated STARTTLS using real PHPMailer and a local fake SMTP server."""
import base64
import email.policy
from email.parser import BytesParser
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import socketserver
import ssl
import subprocess
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPCookieProcessor


class FakeSMTP(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Failed TLS checks must not log any submitted content or credentials.
        pass


class SMTPHandler(socketserver.BaseRequestHandler):
    def handle(self):
        connection = self.request
        connection.settimeout(15)
        reader = connection.makefile("rb")
        secured = False
        authenticated = False
        recipient = False

        def reply(line):
            connection.sendall((line + "\r\n").encode())

        reply("220 localhost integration test")
        try:
            while True:
                line = reader.readline(65536)
                if not line:
                    return
                command = line.decode("ascii", errors="replace").strip()
                upper = command.upper()
                if upper.startswith(("EHLO ", "HELO ")):
                    reply("250-localhost")
                    if not secured:
                        reply("250-STARTTLS")
                    reply("250-AUTH LOGIN")
                    reply("250 SIZE 32768")
                elif upper == "STARTTLS":
                    reply("220 Ready for TLS")
                    reader.close()
                    connection = self.server.tls_context.wrap_socket(connection, server_side=True)
                    reader = connection.makefile("rb")
                    secured = True
                elif upper == "AUTH LOGIN":
                    if not secured:
                        reply("538 Encryption required")
                        continue
                    reply("334 VXNlcm5hbWU6")
                    username = base64.b64decode(reader.readline().strip()).decode()
                    reply("334 UGFzc3dvcmQ6")
                    password = base64.b64decode(reader.readline().strip()).decode()
                    if username == "info@al-aqsa.eu" and password == "integration-only" and not self.server.reject_auth:
                        authenticated = True
                        reply("235 Authentication successful")
                    else:
                        reply("535 Authentication failed")
                elif upper.startswith("MAIL FROM:"):
                    if not authenticated:
                        reply("530 Authentication required")
                    elif "<info@al-aqsa.eu>" not in command:
                        reply("550 Unexpected envelope sender")
                    else:
                        recipient = False
                        reply("250 Sender accepted")
                elif upper.startswith("RCPT TO:"):
                    recipient = authenticated and "<info@al-aqsa.eu>" in command
                    reply("250 Recipient accepted" if recipient else "550 Unexpected recipient")
                elif upper == "DATA":
                    if not (secured and authenticated and recipient):
                        reply("530 Message rejected")
                        continue
                    reply("354 End with a period")
                    lines = []
                    while True:
                        value = reader.readline(65536)
                        if value == b".\r\n":
                            break
                        if not value:
                            return
                        lines.append(value[1:] if value.startswith(b"..") else value)
                    self.server.messages.append(b"".join(lines))
                    reply("250 Message accepted")
                elif upper == "RSET":
                    recipient = False
                    reply("250 Reset")
                elif upper == "QUIT":
                    reply("221 Goodbye")
                    return
                else:
                    reply("502 Command not supported")
        finally:
            reader.close()
            connection.close()


def certificate(directory, name):
    cert = directory / (name + ".crt")
    key = directory / (name + ".key")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                    "-keyout", str(key), "-out", str(cert), "-days", "1",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(cert, key)
    return cert, context


def main():
    root = Path(__file__).resolve().parents[1]
    php = os.environ.get("PHP_BINARY") or shutil.which("php")
    if not php:
        raise SystemExit("PHP and OpenSSL are required for the SMTP integration test.")
    with tempfile.TemporaryDirectory(prefix="alaqsa-smtp-test-") as folder:
        temp = Path(folder)
        web = temp / "web"
        web.mkdir()
        (temp / "sessions").mkdir()
        shutil.copy(root / "contact.php", web / "contact.php")
        private = temp / "private" / "alaqsa-enquiry"
        private.mkdir(parents=True)
        for name in ["Exception.php", "SMTP.php", "PHPMailer.php"]:
            shutil.copy(root / "vendor" / "phpmailer" / name, private / name)
        cert, context = certificate(temp, "trusted")
        _, untrusted = certificate(temp, "untrusted")
        smtp = FakeSMTP(("127.0.0.1", 0), SMTPHandler)
        smtp.messages = []
        smtp.reject_auth = False
        smtp.tls_context = context
        threading.Thread(target=smtp.serve_forever, daemon=True).start()
        (private / "mail.json").write_text(json.dumps({
            "host": "127.0.0.1", "port": smtp.server_address[1],
            "username": "info@al-aqsa.eu", "password": "integration-only"
        }))
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        log = (temp / "php.log").open("w+")
        command = [php, "-d", f"openssl.cafile={cert}", "-d",
                   f"session.save_path={temp / 'sessions'}", "-d", f"sys_temp_dir={temp}",
                   "-S", f"127.0.0.1:{port}", "-t", str(web)]
        server = subprocess.Popen(command, stdout=log, stderr=log)
        client = build_opener(HTTPCookieProcessor(CookieJar()))

        def request(fields=None):
            data = None if fields is None else urlencode(fields).encode()
            req = Request(origin + "/contact.php", data=data, headers={"Origin": origin})
            try:
                result = client.open(req, timeout=20)
            except HTTPError as error:
                result = error
            return result.status, json.loads(result.read())

        try:
            for _ in range(100):
                try:
                    status, ready = request()
                    break
                except URLError:
                    time.sleep(.05)
            else:
                raise AssertionError("PHP server failed to start")
            assert status == 200 and ready["ok"]
            fields = {"token": ready["token"], "request_id": secrets.token_hex(16), "website": "",
                      "name": "Test visitor — يامن", "email": "visitor@example.com",
                      "project": "Website design & development", "message": "SMTP test — مرحبا café"}
            status, result = request(fields)
            assert status == 200 and result["ok"], result
            assert len(smtp.messages) == 1
            message = BytesParser(policy=email.policy.default).parsebytes(smtp.messages[0])
            assert message["From"].addresses[0].addr_spec == "info@al-aqsa.eu"
            assert message["To"] == "info@al-aqsa.eu"
            assert message["Reply-To"] == fields["email"]
            assert fields["message"] in message.get_content()
            assert request(fields)[1]["ok"] and len(smtp.messages) == 1
            print("PASS: authenticated STARTTLS, fixed sender/recipient, Unicode, Reply-To and duplicate protection")

            smtp.reject_auth = True
            retry = {**fields, "request_id": secrets.token_hex(16)}
            status, result = request(retry)
            assert status == 503 and result["error_code"] == "smtp_rejected"
            assert len(smtp.messages) == 1 and "integration-only" not in json.dumps(result)
            smtp.reject_auth = False
            assert request(retry)[1]["ok"] and len(smtp.messages) == 2
            print("PASS: failed SMTP authentication remains a failure; a successful retry sends once")

            smtp.tls_context = untrusted
            status, result = request({**fields, "request_id": secrets.token_hex(16)})
            assert status == 503 and result["error_code"] == "smtp_rejected"
            assert len(smtp.messages) == 2
            log.flush()
            log.seek(0)
            content = log.read()
            assert "integration-only" not in content and fields["message"] not in content
            print("PASS: untrusted TLS certificate rejected; content and passwords excluded from error logs")
        finally:
            server.terminate()
            server.wait(timeout=5)
            log.close()
            smtp.shutdown()
            smtp.server_close()


if __name__ == "__main__":
    main()
