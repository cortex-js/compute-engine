#!/bin/zsh
# Timed runs: for each probe, cache on then cache off, back to back.
P=/private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/origin-probes
cd /tmp/wt-compute-engine-aa-cache2
run() { # name file [env...]
  local name=$1 file=$2; shift 2
  for o in "" $name; do
    echo "== $file off=${o:-none} $* load=$(sysctl -n vm.loadavg)"
    env "$@" CE_CACHE_OFF=$o npx tsx $P/$file 2>&1 | grep -v '^compiles=\|^factorizations=' | uniq -c | cut -c1-400
  done
}
run slice probe-slice.mts
run contour probe-contour.mts
run approx probe-approx.mts APPROX_N=40
run limitprobe probe-limit.mts
run factor probe-factor.mts FACTOR_ORDER=2
run factor probe-factor.mts FACTOR_ORDER=3
run settingspayload probe-settingspayload.mts
run settingspayload probe-settingspayload.mts ENC_COSTLY=1 ENC_TERMS=20
run mapcompile probe-mapcompile.mts
