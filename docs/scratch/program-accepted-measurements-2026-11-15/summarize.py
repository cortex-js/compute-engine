import json,statistics,hashlib,gzip,shutil,collections
from pathlib import Path
b=Path(__file__).resolve().parent
summary={'ce':{},'tycho':{},'heap':{},'rejectedProcesses':[]}
def stats(xs):return {'n':len(xs),'median':statistics.median(xs),'min':min(xs),'max':max(xs),'spread':max(xs)-min(xs),'values':xs}
for mode in ['normal','off']:
 accepted=[]
 for p in sorted(b.glob(f'ce-{mode}-repeat*.monitor.json')):
  m=json.load(open(p))
  if m['accepted']:accepted.append((m['name'],json.load(open(b/(m['name']+'.json')))))
  else:summary['rejectedProcesses'].append({'name':m['name'],'reason':'transient external CPU or load','exitCode':m['exitCode']})
 summary['ce'][mode]={'processes':[n for n,d in accepted],'cases':{},'startup':{}}
 for name,d in accepted:
  for r in d['records']:
   x=summary['ce'][mode]['cases'].setdefault(r['id'],{'processMediansMs':[],'allSamplesMs':[]})
   x['processMediansMs'].append(r['medianMs']);x['allSamplesMs']+=r['samplesMs']
  for k,v in d['startup'].items():summary['ce'][mode]['startup'].setdefault(k,[]).append(v)
 for x in summary['ce'][mode]['cases'].values():
  x['processMedianEnvelope']=stats(x['processMediansMs']);x['sampleEnvelope']=stats(x['allSamplesMs'])
 for p in sorted(b.glob(f'tycho-{mode}-repeat*.monitor.json')):
  m=json.load(open(p));name=m['name']
  if 'startedEpochMs' not in m:continue
  data=json.load(open(b/(name+'.json')));windows=[];prior=0
  for h in m['monitor']:
   windows.append((m['startedEpochMs']+prior*1000-100,m['startedEpochMs']+h['atSeconds']*1000+100,bool(h['contenders']) or h['load'][0]>18));prior=h['atSeconds']
  for record in data['records']:
   groups=collections.defaultdict(list)
   for s in record['samples']:
    case=record['id']+(':'+s['phase'] if 'phase' in s else '')
    start,end=s.get('wallStartMs'),s.get('wallEndMs')
    if start is None:continue
    valid=not any(bad and lo<=end and hi>=start for lo,hi,bad in windows)
    row=summary['tycho'].setdefault(mode,{}).setdefault(case,{'acceptedSamples':[],'rejectedSamples':[],'processMediansMs':[],'processes':[]})
    observation={'process':name,'ms':s.get('totalMs',s.get('ms'))}
    row['acceptedSamples' if valid else 'rejectedSamples'].append(observation)
    if valid:groups[case].append(observation['ms'])
   for case,xs in groups.items():
    row=summary['tycho'][mode][case];row['processMediansMs'].append(statistics.median(xs));row['processes'].append(name)
 for row in summary['tycho'].get(mode,{}).values():
  if row['processMediansMs']:row['processMedianEnvelope']=stats(row['processMediansMs']);row['sampleEnvelope']=stats([x['ms'] for x in row['acceptedSamples']])
 for category in ['drop','retain-closures','allocating-control']:
  data=[json.load(open(p)) for p in sorted(b.glob(f'heap-{category}-{mode}-[123].json'))]
  if not data:continue
  metrics={}
  for k in ['allocatedSampleBytes','beforeHeapBytes','heldHeapBytes','afterDropEngineHeapBytes','afterDropAllHeapBytes','afterInspectorCleanupHeapBytes']:
   metrics[k]=stats([d[k] for d in data])
  for label,a,c in [('heldMinusBaseline','heldHeapBytes','beforeHeapBytes'),('releasedHeldObjects','heldHeapBytes','afterDropAllHeapBytes'),('postDropMinusBaseline','afterDropAllHeapBytes','beforeHeapBytes')]:metrics[label]=stats([d[a]-d[c] for d in data])
  summary['heap'].setdefault(mode,{})[category]={'processes':len(data),'closureControls':[d.get('closureControl') for d in data],**metrics}
(b/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print('CE accepted', {k:len(v['processes']) for k,v in summary['ce'].items()})
print('Tycho accepted-process counts',{mode:{case:len(row['processMediansMs']) for case,row in rows.items()} for mode,rows in summary['tycho'].items()})
