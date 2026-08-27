#!/usr/bin/env bash
# Cloud runner for the v3.1 full-corpus extraction (spec: docs/analysis/
# analysis-v3-spec.md, FROZEN). Runs on the sweep service, reading the
# original game logs from the persistent volume and writing extraction
# outputs beside them, so a redeploy resumes from the content-addressed
# cache instead of respending.
#
# Fail-closed before any API spend: every volume log is re-hashed against
# deploy-data/log-checksums.txt (generated from the frozen analysis
# manifest). One mismatched byte aborts the run — extraction must never
# read logs that differ from the manifest pins.
#
# deploy-data/ ships with `railway up` (it is deliberately not gitignored,
# and deliberately never committed): the archived v2 ledger used as a
# candidate source, plus any extraction outputs already completed
# elsewhere, which seed the cache via cp -n.
set -uo pipefail

LOGS="${SWEEP_OUT_DIR:-/data/sweep1}"
# extract-s5: the PF-1 sonnet run. /data/analysis-v3/extract holds the 16
# fable-config extractions — archived instrument readings for the published
# finder comparison — and must never be written again.
OUT="/data/analysis-v3/extract-s5"
mkdir -p "$OUT"

echo "== verifying volume logs against the frozen manifest pins =="
fail=0
while read -r sum file; do
  actual=$(sha256sum "$LOGS/$file" 2>/dev/null | cut -d' ' -f1)
  if [ "$actual" != "$sum" ]; then
    echo "HASH MISMATCH: $file (volume $actual != manifest $sum)"
    fail=1
  fi
done < deploy-data/log-checksums.txt
if [ "$fail" -ne 0 ]; then
  echo "refusing to extract: volume logs do not match the manifest"
  exit 1
fi
echo "all $(wc -l < deploy-data/log-checksums.txt) log hashes verified"

if [ -d deploy-data/v3-done ]; then
  echo "== seeding cache with completed extractions =="
  cp -nv deploy-data/v3-done/* "$OUT"/ || true
fi

# Stale locks from a previous crashed deploy would wedge their seeds; this
# service runs one process at a time, so clearing them here is safe.
rm -f "$OUT"/*.lock

echo "== extraction (frozen spec PF-1: sonnet finder, cached, capped) =="
node packages/seats/scripts/extract-v3.mjs "$LOGS"/sweep1-*.jsonl \
  --model claude-sonnet-5 --abort-dollars 45 \
  --out-dir "$OUT" --v2-dir deploy-data/v2-extract --concurrency 8
rc=$?
echo "== extraction exited rc=$rc =="

# Serve outputs either way (restartPolicy NEVER — no crashloop): success
# hands back the full set; failure hands back raws/rejects for diagnosis.
export SWEEP_DIR="$OUT"
exec node scripts/serve-results.mjs
