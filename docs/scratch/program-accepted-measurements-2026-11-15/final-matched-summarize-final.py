from pathlib import Path
import json,statistics,collections
p=Path(__file__).resolve().parent
records=json.loads((p/'matrix-status.json').read_text())
def stats(xs):return {'n':len(xs),'median':statistics.median(xs),'min':min(xs),'max':max(xs),'spread':max(xs)-min(xs),'values':xs} if xs else {'n':0}
def envelope(base,candidate):
 r={'baseline':stats(base),'candidate':stats(candidate),'ratioAvailable':len(base)>=2 and len(candidate)>=2}
 if r['ratioAvailable']:r.update(candidateOverBaseline=statistics.median(candidate)/statistics.median(base),candidateMedianAboveBaselineMax=statistics.median(candidate)>max(base),candidateMinimumAboveBaselineMax=min(candidate)>max(base))
 return r

def windows(m):
 result=[];prior=0
 for h in m['monitor']:
  result.append((m['startedEpochMs']+prior*1000-100,m['startedEpochMs']+h['atSeconds']*1000+100,bool(h['contenders']) or h['load'][0]>18));prior=h['atSeconds']
 return result
summary={'ce':{},'tycho':{},'heap':{},'rejectedProcesses':[],'rawProcesses':records,'sourceCertification':json.loads((p/'matrix-certification.json').read_text())}
for mode in ['normal','off']:
 arms={arm:[r for r in records if r['kind']=='ce' and r['mode']==mode and r['arm']==arm and r['accepted']]for arm in ['baseline','candidate']};summary['ce'][mode]={'acceptedProcesses':{a:[r['name']for r in rs]for a,rs in arms.items()},'cases':{},'startup':{}}
 for arm,rs in arms.items():
  for row in rs:row['data']=json.loads((p/(row['name']+'.json')).read_text())
 if all(arms.values()):
  for entry in arms['baseline'][0]['data']['records']:
   id=entry['id'];values={a:[next(v['medianMs']for v in r['data']['records']if v['id']==id)for r in rs]for a,rs in arms.items()};out=envelope(values['baseline'],values['candidate']);out['allSamples']={a:[v for r in rs for v in next(v['samplesMs']for v in r['data']['records']if v['id']==id)]for a,rs in arms.items()};summary['ce'][mode]['cases'][id]=out
  for k in ['importMs','firstEngineMs','coldFullRunMs']:summary['ce'][mode]['startup'][k]=envelope([r['data']['startup'][k]for r in arms['baseline']],[r['data']['startup'][k]for r in arms['candidate']])
 for arm,rs in arms.items():
  for row in rs:del row['data']
 # Full Tycho control hashes and accepted/rejected per-case windows.
 cases={};hashes={}
 for row in [r for r in records if r['kind']=='tycho'and r['mode']==mode]:
  data=json.loads((p/(row['name']+'.json')).read_text());monitor=json.loads((p/(row['name']+'.monitor.json')).read_text());w=windows(monitor);grouped=collections.defaultdict(list)
  for rec in data['records']:
   for s in rec['samples']:
    case=rec['id']+(':'+s['phase']if'phase'in s else '');c=cases.setdefault(case,{'baseline':{'acceptedSamples':[],'rejectedSamples':[],'processMedians':[]},'candidate':{'acceptedSamples':[],'rejectedSamples':[],'processMedians':[]}});good=not any(b and lo<=s['wallEndMs']and hi>=s['wallStartMs']for lo,hi,b in w);ms=s.get('totalMs',s.get('ms'));observation={'process':row['name'],'ms':ms,'timings':s.get('timings')};c[row['arm']]['acceptedSamples'if good else'rejectedSamples'].append(observation)
    if good:grouped[case].append(ms)
    if'valueSha256'in s:hashes.setdefault(rec['id'],{}).setdefault(row['arm'],set()).add(s['valueSha256'])
  for case,xs in grouped.items():cases[case][row['arm']]['processMedians'].append({'process':row['name'],'ms':statistics.median(xs),'samples':len(xs)})
 for case,c in cases.items():c['comparison']=envelope([r['ms']for r in c['baseline']['processMedians']],[r['ms']for r in c['candidate']['processMedians']])
 summary['tycho'][mode]={'cases':cases,'hashes':{case:{'baseline':sorted(h.get('baseline',set())),'candidate':sorted(h.get('candidate',set())),'equal':h.get('baseline',set())==h.get('candidate',set())and len(h.get('baseline',set()))==1}for case,h in hashes.items()}}
 for control in ['drop','retain-closures','allocating-control']:
  arms={arm:[r for r in records if r['kind']=='heap-'+control and r['mode']==mode and r['arm']==arm and r['exitCode']==0]for arm in ['baseline','candidate']};out={'validMemoryProcesses':{a:[r['name']for r in rs]for a,rs in arms.items()},'durationTimingAccepted':{a:[r['name']for r in rs if r['accepted']]for a,rs in arms.items()},'metrics':{}}
  data={a:[json.loads((p/(r['name']+'.json')).read_text())for r in rs]for a,rs in arms.items()}
  for metric in ['allocatedSampleBytes','beforeHeapBytes','heldHeapBytes','afterDropEngineHeapBytes','afterDropAllHeapBytes','afterInspectorCleanupHeapBytes']:
   out['metrics'][metric]=envelope([r[metric]for r in data['baseline']],[r[metric]for r in data['candidate']])
  for label,x,y in [('heldMinusBaseline','heldHeapBytes','beforeHeapBytes'),('releasedHeldObjects','heldHeapBytes','afterDropAllHeapBytes'),('postDropMinusBaseline','afterDropAllHeapBytes','beforeHeapBytes')]:out['metrics'][label]=envelope([r[x]-r[y]for r in data['baseline']],[r[x]-r[y]for r in data['candidate']])
  summary['heap'].setdefault(mode,{})[control]=out
for row in records:
 if not row['accepted']:
  m=json.loads((p/(row['name']+'.monitor.json')).read_text());summary['rejectedProcesses'].append({'name':row['name'],'kind':row['kind'],'mode':row['mode'],'arm':row['arm'],'exitCode':row['exitCode'],'badIntervals':[h for h in m['monitor']if h['contenders']or h['load'][0]>18]})
summary['completion']=json.loads((p/'COMPLETE.json').read_text()) if (p/'COMPLETE.json').exists() else {'complete':False,'status':'remaining Tycho-off timing and heap queued'}
(p/'final-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print('CE accepted',{mode:{a:len(xs)for a,xs in d['acceptedProcesses'].items()}for mode,d in summary['ce'].items()});print('Tycho hash parity',{mode:all(x['equal']for x in d['hashes'].values())for mode,d in summary['tycho'].items()});print('Heap valid byte controls',{mode:{c:{a:len(xs)for a,xs in d['validMemoryProcesses'].items()}for c,d in cs.items()}for mode,cs in summary['heap'].items()});print('Rejected processes',len(summary['rejectedProcesses']))
