"""Check the upload boundary with a fake curl executable. Never connects to hosting."""
import json
import os
from pathlib import Path
import shutil
import shlex
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
        for filename in ["contact.php", "privacy.html", "robots.txt", "sitemap.xml",
                         "styles.css", "script.js", "index.html"]:
            shutil.copy(root / filename, project / filename)
        (project / "unrelated-private.txt").write_text("Must not be published")
        log = temp / "calls.jsonl"
        bin_dir = temp / "bin"
        bin_dir.mkdir()
        mock = bin_dir / "curl"
        mock_source = "import json,os,sys\n" + (
                        "with open(os.environ['TEST_LOG'],'a') as out:\n"
                        " out.write(json.dumps(sys.argv[1:])+'\\n')\n"
                        "sys.exit(7 if os.environ.get('TEST_FAIL') else 0)\n")
        if os.name == "nt":
            # Git Bash cannot interpret a Windows path in a Python shebang.
            python_mock = bin_dir / "mock_curl.py"
            python_mock.write_text(mock_source)
            mock.write_text("#!/usr/bin/env bash\nexec "
                            + shlex.quote(Path(sys.executable).as_posix()) + " "
                            + shlex.quote(python_mock.as_posix()) + ' "$@"\n')
            (bin_dir / "python3").write_text("#!/usr/bin/env bash\nexec "
                                            + shlex.quote(Path(sys.executable).as_posix()) + ' "$@"\n')
        else:
            mock.write_text(f"#!{sys.executable}\n" + mock_source)
        mock.chmod(0o755)
        env = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
               "TEST_LOG": str(log), "FTP_SERVER": "hosting.example.com",
               "FTP_USERNAME": "test-user", "FTP_PASSWORD": "test-password",
               "GITHUB_SHA": "a" * 40}
        command = [shutil.which("bash") or "bash", (project / "scripts/deploy-ftps.sh").as_posix()]
        if os.name == "nt":
            # Git Bash prepends its own tools to the Windows PATH. Keep mocks first.
            env["TEST_BIN"] = str(bin_dir)
            command = [command[0], "-c",
                       'export PATH="$(cygpath -u "$TEST_BIN"):$PATH"; exec bash "$1"',
                       "test", command[1]]
        result = subprocess.run(command, env=env, text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        calls = [json.loads(line) for line in log.read_text().splitlines()]
        assert len(calls) == 7 + sum(item.is_file() for item in (root / "assets").rglob("*"))
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
        assert "assets/language.js" in published
        assert "unrelated-private.txt" not in published
        assert env["FTP_PASSWORD"] not in result.stdout + result.stderr

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
