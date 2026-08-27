#!/usr/bin/env bash
# Sweep 1 on a hosted box: three lanes over the precommitted schedule
# (docs/sweeps/sweep1.plan.md), plus a token-gated status/results server that
# keeps the service alive after the lanes finish.
set -u
SCHEDULE="${SWEEP_SCHEDULE:-docs/sweeps/sweep1.schedule.json}"
CAP="${ABORT_TOKENS_PER_LANE:-40000000}"
OUT="${SWEEP_OUT_DIR:-runs/sweep1}"
export SWEEP_DIR="$OUT"
mkdir -p "$OUT"

node scripts/serve-results.mjs &

lane() { # games offset name
  node scripts/run-sweep.mjs --schedule "$SCHEDULE" --deadline 300 \
    --games "$1" --offset "$2" --out-dir "$OUT" \
    --abort-tokens "$CAP" > "$OUT/lane-$3.log" 2>&1
  local rc=$?
  echo "lane $3 done (exit $rc)"
  return $rc
}

lane 14 0  a & PA=$!
lane 13 14 b & PB=$!
lane 13 27 c & PC=$!
FAILED=0
wait $PA || FAILED=1
wait $PB || FAILED=1
wait $PC || FAILED=1
if [ "$FAILED" -eq 0 ]; then
  echo "SWEEP COMPLETE — results server stays up for retrieval"
else
  echo "SWEEP FINISHED WITH FAILURES — check lane logs and the manifest; results server stays up"
fi
wait
