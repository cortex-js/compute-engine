from pathlib import Path
import json,statistics,hashlib,shutil,tarfile,time
p=Path(__file__).resolve().parent;dest=Path('/Users/arno/dev/compute-engine/docs/scratch/program-profile-revision-2026-11-16');dest.mkdir(exist_ok=True)
functions=['canonicalSequence','canonicalBlock','boundCallType','functionLiteralSignatureType','recordInitializerEvidence','withEvidenceSession','beforeDefinitionWrite','BoxedFunction.constructor','BoxedSymbol.constructor','documentBindings','canonicalizationDiagnostics','diagnosticFlow','_setType','_writeType']
summary={'profiles':{},'scalar':[]}
for case in ['box','parse-box','check','notebook']:
 summary['profiles'][case]={}
 for arm in ['baseline','candidate']:
  cpu=json.load(open(p/f'cpu-{case}-{arm}.attribution.json'));alloc=json.load(open(p/f'allocation-{case}-{arm}.attribution.json'));raw=json.load(open(p/f'allocation-{case}-{arm}.json'));d={'estimatedBytesPerOperation':raw['estimatedBytesPerOperation'],'sampledCpuMicrosecondsPerOperation':cpu['totalSelf']/20000,'mappedCpuSelfFraction':cpu['mappedSelf']/cpu['totalSelf'],'mappedAllocationSelfFraction':alloc['mappedSelf']/alloc['totalSelf'],'groups':{},'topCpuSelf':cpu['rows'][:25],'topAllocationSelf':alloc['rows'][:25],'topAllocationStacks':alloc['allocationStacks'][:15],'boundCallTypeStacks': [r for r in alloc['allocationStacks'] if any(f['function']=='boundCallType' for f in r['frames'])][:10]}
  for fn in functions:
   cr=[r for r in cpu['rows'] if r['function']==fn];ar=[r for r in alloc['rows'] if r['function']==fn]
   d['groups'][fn]={'cpuSelfUsPerOperation':sum(r['self'] for r in cr)/20000,'cpuInclusiveMaxUsPerOperation':max([r['inclusive'] for r in cr]or[0])/20000,'allocationSelfBytesPerOperation':sum(r['self'] for r in ar)/20000,'allocationInclusiveUnionBytesPerOperation':sum(r['bytes'] for r in alloc['allocationStacks'] if any(f['function']==fn for f in r['frames']))/20000,'matchedCpuEntries':len(cr),'matchedAllocationEntries':len(ar)}
  summary['profiles'][case][arm]=d
for f in sorted(p.glob('scalar-*.monitor.json')):
 m=json.load(open(f));d=json.load(open(str(f).replace('.monitor.json','.json')))
 summary['scalar'].append({'name':m['name'],'accepted':m['accepted'],'childExit':m['exitCode'],'maxLoad':max(v['load'][0]for v in m['monitor']),'rejectedIntervals':[v for v in m['monitor'] if v['contenders']],'loops':[{ 'id':v['id'],'n':v['n'],'medianNs':statistics.median(x['nsPerCall']for x in v['samples']),'minNs':min(x['nsPerCall']for x in v['samples']),'maxNs':max(x['nsPerCall']for x in v['samples'])}for v in d['scalar']]})
(dest/'PROFILE-SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n')
# Keep raw reproducible evidence, not the much larger derived expanded stack trees.
files=[f for f in p.iterdir() if f.is_file() and '.attribution.' not in f.name]
proof=json.load(open(p/'verified-source-map-proof.json'))
for v in proof['mappings']:
 files.extend(Path(v[k])for k in ['rawAuxiliary','verifiedAuxiliary','map'])
for arm in ['baseline','candidate']:
 files.extend([p/f'maps-{arm}/scripts/build.mjs',p/f'maps-{arm}/package.json'])
for name in ['program-regression-child.mjs','program-regression-map.mjs','program-regression-symbolize.mjs']:
 shutil.copy2(Path('/Users/arno/dev/compute-engine/benchmarks')/name,dest/name)
# Archive only relative paths under private diagnostic root, no symlink traversal.
with tarfile.open(dest/'raw-profiles-and-maps.tar.gz','w:gz',compresslevel=1)as t:
 for f in sorted(set(files)):
  t.add(f,arcname=str(f.relative_to(p)),recursive=False)
for name in ['profile-status.json','attribution-status.json','scalar-status.json','scalar-repeat-status.json','verified-source-map-proof.json','source-map-proof.json','identity-profile-end.json','identity-comparison-to-final-frozen.json','lock-release.log','run-profiles.py','run-scalar.py','run-scalar-repeat.py','monitor.py','summarize.py']:
 shutil.copy2(p/name,dest/name)
print('durable evidence:',dest)
