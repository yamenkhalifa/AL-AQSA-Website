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

# Publish assets and the handler before the entry page; deploy website files only.
files=()
while IFS= read -r -d '' file; do
  files+=("$file")
done < <(find assets -type f -print0 | sort -z)
files+=(contact.php privacy.html robots.txt sitemap.xml styles.css script.js index.html)

for file in "${files[@]}"; do
  if [[ ! -f "$file" || -L "$file" || "$file" == *$'\r'* || "$file" == *$'\n'* ]]; then
    echo 'A website file is missing or has an unsupported path.' >&2
    exit 1
  fi
done

for file in "${files[@]}"; do
  filename="${file##*/}"
  temporary=".${filename}.deploy-${GITHUB_SHA}.tmp"
  if [[ "$file" == */* ]]; then
    remote="${file%/*}/${temporary}"
  else
    remote="$temporary"
  fi
  encoded="$(python3 -c 'import sys; from urllib.parse import quote; print(quote(sys.argv[1], safe="/"))' "$remote")"

  # TLS is mandatory and certificates are verified. Rename only after upload succeeds.
  # This replaces individual files without deleting other files on the hosting account.
  curl --ipv4 --silent --show-error --fail --globoff \
    --ssl-reqd --tlsv1.2 --ftp-create-dirs \
    --connect-timeout 20 --max-time 120 \
    --retry 2 --retry-connrefused \
    --user "${FTP_USERNAME}:${FTP_PASSWORD}" \
    --upload-file "$file" \
    --quote "-RNFR $temporary" \
    --quote "-RNTO $filename" \
    "ftp://${FTP_SERVER}/httpdocs/${encoded}"
  printf 'Published %s\n' "$file"
done
