"""Check the upload boundary with a fake curl executable. Never connects to hosting."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlparse


def main():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="alaqsa-deploy-test-") as folder:
        temp = Path(folder)
        project = temp / "project"
        project.mkdir()
        shutil.copytree(root / "scripts", project / "scripts")
        shutil.copytree(root / "assets", project / "assets")
        shutil.copytree(root / "vendor", project / "vendor")
        for filename in ["contact.php", "privacy.html", "robots.txt", "sitemap.xml",
                         "styles.css", "script.js", "index.html"]:
            shutil.copy(root / filename, project / filename)
        (project / "unrelated-private.txt").write_text("Must not be published")
        log = temp / "calls.jsonl"
        bin_dir = temp / "bin"
        bin_dir.mkdir()
        mock = bin_dir / "curl"
        mock.write_text(f"#!{sys.executable}\n"
                        "import json,os,sys,pathlib\n"
                        "with open(os.environ['TEST_LOG'],'a') as out:\n"
                        " out.write(json.dumps(sys.argv[1:])+'\\n')\n"
                        "if '/private/alaqsa-enquiry/.mail.json.' in sys.argv[-1]:\n"
                        " source=pathlib.Path(sys.argv[sys.argv.index('--upload-file')+1])\n"
                        " assert source.stat().st_mode & 0o777 == 0o600\n"
                        " pathlib.Path(os.environ['TEST_CONFIG_CAPTURE']).write_text(source.read_text())\n"
                        "sys.exit(7 if os.environ.get('TEST_FAIL') else 0)\n")
        mock.chmod(0o755)
        env = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
               "TEST_LOG": str(log), "TEST_CONFIG_CAPTURE": str(temp / "smtp-config.json"),
               "SMTP_PASSWORD": "", "FTP_SERVER": "hosting.example.com",
               "FTP_USERNAME": "test-user", "FTP_PASSWORD": "test-password",
               "GITHUB_SHA": "a" * 40}
        command = ["bash", str(project / "scripts/deploy-ftps.sh")]
        result = subprocess.run(command, env=env, text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        calls = [json.loads(line) for line in log.read_text().splitlines()]
        assert len(calls) == 8
        published = []
        for args in calls:
            assert "--ipv4" in args and "--ssl-reqd" in args and "--tlsv1.2" in args
            assert "--insecure" not in args
            assert not any(arg.startswith("DELE ") for arg in args)
            source = args[args.index("--upload-file") + 1]
            published.append(source)
            url = urlparse(args[-1])
            assert url.hostname == env["FTP_SERVER"] and url.path.startswith("/httpdocs/")
            name = Path(source).name
            temporary = f".{name}.deploy-{env['GITHUB_SHA']}.tmp"
            assert unquote(url.path).endswith("/" + temporary)
            assert "-RNFR " + temporary in args and "-RNTO " + name in args
        assert published[-1] == "index.html"
        assert "unrelated-private.txt" not in published
        assert env["FTP_PASSWORD"] not in result.stdout + result.stderr

        log.unlink()
        smtp_env = {**env, "SMTP_PASSWORD": 'test-only-smtp-"$password'}
        smtp_result = subprocess.run(command, env=smtp_env, text=True, capture_output=True)
        assert smtp_result.returncode == 0, smtp_result.stderr
        smtp_calls = [json.loads(line) for line in log.read_text().splitlines()]
        assert len(smtp_calls) == 13
        private_calls = smtp_calls[:5]
        assert all(urlparse(args[-1]).path.startswith("/private/alaqsa-enquiry/") for args in private_calls)
        config_call = private_calls[-1]
        temporary = f".mail.json.deploy-{env['GITHUB_SHA']}.tmp"
        assert "-SITE CHMOD 600 " + temporary in config_call
        assert "-RNFR " + temporary in config_call and "-RNTO mail.json" in config_call
        config = json.loads((temp / "smtp-config.json").read_text())
        assert config == {"host": "mail.mijndomein.nl", "port": 587,
                          "username": "info@al-aqsa.eu", "password": smtp_env["SMTP_PASSWORD"]}
        assert smtp_env["SMTP_PASSWORD"] not in smtp_result.stdout + smtp_result.stderr
        assert "httpdocs/.index.html." in smtp_calls[-1][-1]
        print("PASS: SMTP libraries and protected configuration stay outside httpdocs; password is never logged")

        log.unlink()
        result = subprocess.run(command, env={**env, "TEST_FAIL": "1"}, text=True, capture_output=True)
        assert result.returncode != 0 and len(log.read_text().splitlines()) == 1
        log.unlink()
        result = subprocess.run(command, env={**env, "FTP_PASSWORD": ""}, text=True, capture_output=True)
        assert result.returncode != 0 and not log.exists()

        (project / "contact.php").unlink()
        result = subprocess.run(command, env=env, text=True, capture_output=True)
        assert result.returncode != 0 and not log.exists()
        print("PASS: only website files upload; TLS and post-upload renames required; homepage last")
        print("PASS: upload failure, missing credentials and missing files stop publishing")


if __name__ == "__main__":
    main()
