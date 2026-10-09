#!/usr/bin/env bash
set -euo pipefail

: "${FTP_SERVER:?Set the FTP_SERVER repository secret}"
: "${FTP_USERNAME:?Set the FTP_USERNAME repository secret}"
: "${FTP_PASSWORD:?Set the FTP_PASSWORD repository secret}"
: "${GITHUB_SHA:?A deployment commit SHA is required}"

if [[ ! "$FTP_SERVER" =~ ^[A-Za-z0-9.-]+$ ]] || [[ ! "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Use a plain FTP hostname and a valid deployment commit SHA.' >&2
  exit 1
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
config_temp=''
trap 'if [[ -n "$config_temp" ]]; then rm -f -- "$config_temp"; fi' EXIT

# Publish assets and the handler before the entry page; deploy website files only.
files=()
while IFS= read -r -d '' file; do
  files+=("$file")
done < <(find assets -type f -print0 | sort -z)
files+=(contact.php privacy.html robots.txt sitemap.xml styles.css script.js index.html)
private_files=(Exception.php SMTP.php PHPMailer.php LICENSE)

for file in "${files[@]}"; do
  if [[ ! -f "$file" || -L "$file" || "$file" == *$'\r'* || "$file" == *$'\n'* ]]; then
    echo 'A website file is missing or has an unsupported path.' >&2
    exit 1
  fi
done
if [[ -n "${SMTP_PASSWORD:-}" ]]; then
  for file in "${private_files[@]}"; do
    if [[ ! -f "vendor/phpmailer/$file" || -L "vendor/phpmailer/$file" ]]; then
      echo 'A required mail library file is missing.' >&2
      exit 1
    fi
  done
fi

upload_file() {
  local source="$1" destination="$2" permissions="${3:-}"
  local filename="${destination##*/}"
  local temporary=".${filename}.deploy-${GITHUB_SHA}.tmp"
  local remote="${destination%/*}/$temporary"
  local encoded
  encoded="$(python3 -c 'import sys; from urllib.parse import quote; print(quote(sys.argv[1], safe="/"))' "$remote")"
  local quotes=()
  if [[ "$permissions" == 'private' ]]; then
    quotes+=(--quote "-SITE CHMOD 600 $temporary")
  fi
  quotes+=(--quote "-RNFR $temporary" --quote "-RNTO $filename")

  curl --ipv4 --silent --show-error --fail --globoff \
    --ssl-reqd --tlsv1.2 --ftp-create-dirs \
    --connect-timeout 20 --max-time 120 \
    --retry 2 --retry-connrefused \
    --user "${FTP_USERNAME}:${FTP_PASSWORD}" \
    --upload-file "$source" \
    "${quotes[@]}" \
    "ftp://${FTP_SERVER}/${encoded}"
}

# A mailbox password is generated into a private file, never committed or uploaded to httpdocs.
if [[ -n "${SMTP_PASSWORD:-}" ]]; then
  config_temp="$(mktemp)"
  python3 - "$config_temp" <<'PY'
import json
import os
import sys
with open(sys.argv[1], "w") as out:
    json.dump({"host": "mail.mijndomein.nl", "port": 587,
               "username": "info@al-aqsa.eu", "password": os.environ["SMTP_PASSWORD"]}, out)
PY
  for file in "${private_files[@]}"; do
    upload_file "vendor/phpmailer/$file" "private/alaqsa-enquiry/$file"
  done
  upload_file "$config_temp" "private/alaqsa-enquiry/mail.json" 'private'
  printf 'Published private SMTP configuration\n'
fi

for file in "${files[@]}"; do
  upload_file "$file" "httpdocs/$file"
  printf 'Published %s\n' "$file"
done
