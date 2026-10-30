#!/bin/zsh
# Timing runs of the evaluation-cache audit, under the box lock.
cd /tmp/wt-compute-engine-aa-cache
mkdir -p /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing
ALLBUT=shared,appmemo,lazyvalue,element,facet,materializedat,slice,storedvalue,sequence,contour,approx,limitprobe,mapcompile,eagersource,factor,typeparse,dictionary,settingspayload,sgn,effects
for c in none shared appmemo lazyvalue element facet materializedat slice storedvalue sequence contour approx limitprobe mapcompile eagersource factor typeparse dictionary settingspayload sgn effects $ALLBUT; do
  tag=${c//,/+}; [ ${#tag} -gt 30 ] && tag=allbuttype
  CE_CACHE_OFF=$c RUNS=5 timeout 600 npx tsx /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/probes/workloads.mts /tmp/wt-compute-engine-aa-cache > /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing/w-$tag.txt 2>&1; echo "w $tag EXIT=$?"
  CE_CACHE_OFF=$c RUNS=3 timeout 300 npx tsx /tmp/wt-compute-engine-aa-cache/benchmarks/tycho-document-open/rebind.ts > /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing/r-$tag.txt 2>&1; echo "r $tag EXIT=$?"
done
CE_CACHE_OFF=type RUNS=3 timeout 600 npx tsx /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/probes/workloads.mts /tmp/wt-compute-engine-aa-cache shared-max-22,recursion-fib,lazy-reads,accumulator,sequence,limits-series,compare-constants,simplify-factor,map-compile,stored-values,type-reads > /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing/w-type.txt 2>&1; echo "w type EXIT=$?"
/usr/bin/time -p node scripts/test-core.mjs > /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing/core-none.txt 2>&1; echo "core none EXIT=$?"
CE_CACHE_OFF=$ALLBUT /usr/bin/time -p node scripts/test-core.mjs > /private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad/timing/core-allbuttype.txt 2>&1; echo "core allbuttype EXIT=$?"
