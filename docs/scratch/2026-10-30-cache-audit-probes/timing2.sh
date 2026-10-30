#!/bin/zsh
# Paired timing: each setting runs right after its own baseline run.
cd /tmp/wt-compute-engine-aa-cache
mkdir -p /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing2
for c in shared appmemo lazyvalue element facet materializedat slice storedvalue sequence contour approx limitprobe mapcompile eagersource factor typeparse dictionary settingspayload sgn effects; do
  for tag in base $c; do
    off=$c; [ $tag = base ] && off=
    CE_CACHE_OFF=$off RUNS=5 timeout 600 npx tsx /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/probes/workloads.mts /tmp/wt-compute-engine-aa-cache > /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing2/w-$c-$tag.txt 2>&1
    CE_CACHE_OFF=$off RUNS=3 timeout 300 npx tsx /tmp/wt-compute-engine-aa-cache/benchmarks/tycho-document-open/rebind.ts > /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing2/r-$c-$tag.txt 2>&1
  done
  echo "$c done"
done
