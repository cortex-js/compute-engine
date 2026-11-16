from pathlib import Path
import json,hashlib,statistics,shutil
p=Path(__file__).resolve().parent;out=Path('/Users/arno/dev/compute-engine/docs/scratch/program-profile-revision-2026-11-16/revision');out.mkdir(exist_ok=True)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();summary={'allocation':{},'timing':{},'counts':{},'rawCPU':{},'controls':{},'rejected':[]}
for case in ['box','parse-box','check','notebook']:
 summary['allocation'][case]={};summary['counts'][case]={};summary['rawCPU'][case]={}
 for arm in ['accepted','revision']:
  a=json.load(open(p/f'allocation-{case}-{arm}.json'));c=json.load(open(p/f'cpu-{case}-{arm}.json'));k=json.load(open(p/f'counts-{case}-{arm}.json'));summary['allocation'][case][arm]={'estimatedBytesPerOperation':a['estimatedBytesPerOperation'],'samplingBytes':32768,'warmup':a['warmup'],'iterations':a['iterations']};summary['counts'][case][arm]=k['counts'];summary['rawCPU'][case][arm]={'path':c['profile'],'sha256':sha(Path(c['profile'])),'samples':c['profileSamples'],'diagnosticWallMs':c['diagnosticWallMs']};summary['controls'][f'{case}-{arm}']=json.load(open(p/f'controls-{case}-{arm}.json'))
for f in sorted(p.glob('timing-*.monitor.json')):
 m=json.load(open(f));row={'name':m['name'],'accepted':m['accepted'],'childExit':m['exitCode'],'maxLoad':max(x['load'][0]for x in m['monitor']),'rejectedIntervals':[x for x in m['monitor']if x['contenders']]};r=Path(str(f).replace('.monitor.json','.json'))
 if r.exists():
  d=json.load(open(r));t=d['timing'];row.update({'iterationsPerSample':t['iterationsPerSample'],'warmup':d['warmup'],'precision':d['precision'],'jit':d['jit'],'samplesUs':[x['msPerOperation']*1000 for x in t['samples']],'medianUs':statistics.median(x['msPerOperation']*1000 for x in t['samples'])})
 else:row['unavailable']='instrument module resolution failed before CE import; not a runtime control failure'
 if m['accepted']:
  case=m['name'].split('-')[1];arm=m['name'].split('-')[2];summary['timing'].setdefault(case,{}).setdefault(arm,[]).append(row)
 else:summary['rejected'].append(row)
for case,arms in summary['timing'].items():
 base=statistics.median(r['medianUs']for r in arms['accepted']);rev=statistics.median(r['medianUs']for r in arms['revision']);arms['ratioOfProcessMedians']=rev/base;print(case,'accepted',[(r['medianUs'])for r in arms['accepted']],'revision',[r['medianUs']for r in arms['revision']],'ratio',rev/base)
(out/'SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n')
for n in ['status.json','status-timing-r2.json','status-timing-r3.json','run.py','run-timings-r2.py','run-timings-r3.py','monitor.py','summarize.py']:
 shutil.copy2(p/n,out/n)
for f in p.glob('*.json'):
 if f.name.startswith(('controls-','counts-','allocation-','cpu-'))and'.request.'not in f.name:shutil.copy2(f,out/f.name)
start=json.load(open(p/'identity-start.json'));end=json.load(open(p/'identity-end.json'));timing=json.load(open(p/'identity-timing-r3-end.json'));assert start['arms']==end['arms']==timing['arms'];shutil.copy2(p/'identity-start.json',out/'IDENTITY-START.json')
(out/'IDENTITY-END-CERTIFICATE.json').write_text(json.dumps({'start':str(p/'identity-start.json'),'startSha256':sha(p/'identity-start.json'),'end':str(p/'identity-end.json'),'endSha256':sha(p/'identity-end.json'),'finalTimingEnd':str(p/'identity-timing-r3-end.json'),'finalTimingEndSha256':sha(p/'identity-timing-r3-end.json'),'sourceBuildDependenciesEqualStartEnd':True,'instrumentSha256':start['instrumentSha256']},indent=2)+'\n')
for n in ['revision-copy-identity.json','revision-patch-identity.json']:
 shutil.copy2(p.parent/n,out/n)
shutil.copy2(p.parent/'revision-build.log',out/'build.log')
(out/'RAW-HASHES.json').write_text(json.dumps({str(f.relative_to(p)):sha(f)for f in sorted(p.iterdir())if f.is_file()},indent=2)+'\n')
print(out)
