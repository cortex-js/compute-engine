#!/bin/zsh
# Paired timing of the two corrected workloads (lazy-reads, map-compile) at
# HEAD d7c8fe8b902fbee7d5fe64d79aefe9079e992b6f: each setting runs right after its own baseline.
cd /tmp/wt-compute-engine-aa-cache2
mkdir -p /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing3
for c in shared appmemo lazyvalue element facet materializedat slice storedvalue sequence contour approx limitprobe mapcompile eagersource factor typeparse dictionary settingspayload sgn effects; do
  for tag in base $c; do
    off=$c; [ $tag = base ] && off=
    CE_CACHE_OFF=$off RUNS=5 timeout 600 npx tsx /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/probes/workloads.mts /tmp/wt-compute-engine-aa-cache2 lazy-reads,map-compile > /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing3/w-$c-$tag.txt 2>&1
  done
  echo "$c done"
done
