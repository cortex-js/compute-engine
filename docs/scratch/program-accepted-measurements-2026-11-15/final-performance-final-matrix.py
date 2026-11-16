import os,subprocess,json,time,statistics,collections,sys
from pathlib import Path
p=Path(__file__).resolve().parent
roots={'baseline':Path('/private/tmp/program-only-accepted-baseline-20261115'),'candidate':Path('/private/tmp/program-only-accepted-candidate-20261115')}
owner='codex-program-accepted:matched-performance';lock=['node',str(Path.home()/'.claude/scripts/box-lock.mjs')]
records=[];counter=collections.Counter()
def save(): (p/'matrix-status.json').write_text(json.dumps(records,indent=2)+'\n')
def run(kind,mode,arm,extra=None):
 counter[kind,mode,arm]+=1;n=counter[kind,mode,arm];name=f'{kind}-{mode}-{arm}-{n}';root=roots[arm];jit='off' if mode=='off' else 'auto';env=os.environ.copy();env['CE_ROOT']=str(root/'ce');env['CE_ALT_PKG']=str(root/'ce');dest=str(p/(name+'.json'))
 if kind=='ce': cmd=['node',str(root/'ce-time.mjs'),dest,jit]
 elif kind=='tycho': cmd=['node','--import','tsx','--import',str(root/'tycho/scripts/repros/ce-alt-hook.mjs'),str(root/'tycho-time.mts'),dest,jit]
 else: cmd=['node','--expose-gc',str(root/'heap.mjs'),dest,extra,jit]
 cmd=['python3',str(p/'monitor.py'),name,'timeout','-k','10','180']+cmd
 r=subprocess.run(cmd,cwd=p,env=env);monitor=json.loads((p/(name+'.monitor.json')).read_text());row={'kind':kind,'mode':mode,'arm':arm,'name':name,'command':cmd,'environment':{'CE_ROOT':env['CE_ROOT'],'CE_ALT_PKG':env['CE_ALT_PKG']},'driverExit':r.returncode,'exitCode':monitor['exitCode'],'accepted':monitor['accepted']};records.append(row);save()
 if monitor['exitCode']!=0 or r.returncode not in [0,3]:raise RuntimeError('CONTROL/PROCESS FAILURE '+name+'; STOP, no expectation migration')
 return row,json.loads(Path(dest).read_text()),monitor

def windows(m):
 prior=0;out=[]
 for x in m['monitor']:
  out.append((m['startedEpochMs']+prior*1000-100,m['startedEpochMs']+x['atSeconds']*1000+100,bool(x['contenders']) or x['load'][0]>18));prior=x['atSeconds']
 return out

def tychoCases(data,m):
 good=collections.defaultdict(list);bad=collections.defaultdict(list);w=windows(m)
 for rec in data['records']:
  for s in rec['samples']:
   case=rec['id']+(':'+s['phase'] if 'phase' in s else '');valid=not any(b and lo<=s['wallEndMs'] and hi>=s['wallStartMs'] for lo,hi,b in w)
   (good if valid else bad)[case].append(s.get('totalMs',s.get('ms')))
 return good,bad

def identity(name):
 r=subprocess.run(['python3',str(p/'identity.py'),name],cwd=p)
 if r.returncode:raise RuntimeError('Identity recorder failed')
 return json.loads((p/(name+'.json')).read_text())

def sourceProduction(data):return {f:v for f,v in data.items() if not f.endswith('.md')}

def certify(initial,after):
 changed=[]
 for arm in initial['arms']:
  for section in ['source','build','adapters','dependencies']:
   if initial['arms'][arm][section]!=after['arms'][arm][section]:changed.append(arm+'/'+section)
 if sourceProduction(initial['finalWorktreeSource'])!=sourceProduction(after['finalWorktreeSource']):changed.append('final worktree production source')
 (p/'matrix-certification.json').write_text(json.dumps({'changed':changed,'frozenArmsUnchanged':not changed},indent=2)+'\n')
 if changed:raise RuntimeError('STOP SOURCE/BUILD/DEPENDENCY CHANGE '+str(changed))

try:
 c=subprocess.run(lock+['check',owner],capture_output=True,text=True);assert c.returncode==0,c.stdout+c.stderr
 beforeBuild=identity('identity-before-build')
 env=os.environ.copy();env['BUILD']='production';cmd=['timeout','-k','30','600','node','scripts/build.mjs'];t=time.time()
 with (p/'production-build.log').open('w') as f:build=subprocess.run(cmd,cwd=roots['candidate']/'ce',env=env,stdout=f,stderr=subprocess.STDOUT)
 (p/'production-build-status.json').write_text(json.dumps({'command':cmd,'environment':{'BUILD':'production'},'cwd':str(roots['candidate']/'ce'),'exitCode':build.returncode,'seconds':time.time()-t},indent=2)+'\n');print('PRODUCTION BUILD',build.returncode,flush=True)
 if build.returncode:raise RuntimeError('Build failure')
 start=identity('identity-timing-start')
 if sourceProduction(start['arms']['candidate']['source']['ce'])!=sourceProduction(start['finalWorktreeSource']):raise RuntimeError('Candidate production source differs from final worktree before timing')
 with (p/'runtime-witnesses.log').open('w') as f:witness=subprocess.run(['node',str(p/'runtime-witnesses.mjs')],cwd=p,stdout=f,stderr=subprocess.STDOUT)
 (p/'runtime-witnesses-status.json').write_text(json.dumps({'exitCode':witness.returncode},indent=2)+'\n')
 if witness.returncode:raise RuntimeError('Runtime consumer witness failed; STOP before timings')
 # CE: preserve counterbalancing within each independent CE JIT mode.
 for mode,order in [('normal',['baseline','candidate','candidate','baseline']),('off',['candidate','baseline','baseline','candidate'])]:
  accepted=collections.Counter()
  for cycle in range(1,4):
   for arm in order:
    row,data,m=run('ce',mode,arm)
    accepted[arm]+=row['accepted']
   print('CE ACCEPTED',mode,dict(accepted),'cycle',cycle,flush=True)
   if min(accepted.values(),default=0)>=2 and len(accepted)==2:break
  if min(accepted.values(),default=0)<2 or len(accepted)!=2:raise RuntimeError('CE repeatability incomplete after bounded3 counterbalanced cycles '+mode)
 certify(start,identity('identity-after-ce'))
 # Tycho: full unchanged adapter, full showcase initialization, real evaluator.
 digests={};tychoCoverage={}
 for mode,order in [('normal',['baseline','candidate','candidate','baseline']),('off',['candidate','baseline','baseline','candidate'])]:
  coverage={arm:collections.Counter() for arm in roots};allCases=None
  for cycle in range(1,4):
   for arm in order:
    row,data,m=run('tycho',mode,arm);good,bad=tychoCases(data,m)
    observedCases={rec['id']+(':'+s['phase'] if 'phase'in s else '') for rec in data['records'] for s in rec['samples']}
    if allCases is None:allCases=observedCases
    assert allCases==observedCases,'Tycho fixture case inventory changed'
    showcase=[rec for rec in data['records'] if 'sourceSha256'in rec];assert len(showcase)==15,'Expected full15 nonempty showcase preludes'
    for rec in data['records']:
     hashes={s['valueSha256'] for s in rec['samples'] if 'valueSha256'in s}
     if not hashes:continue
     assert len(hashes)==1,'Non-deterministic full values: '+rec['id'];digest=next(iter(hashes));key=(mode,rec['id'])
     if key in digests and digests[key]!=digest:raise RuntimeError('BASELINE/CANDIDATE VALUE HASH DIFFERENCE '+str(key)+'; STOP for semantic witness, no expectation migration')
     digests[key]=digest
    for case in good:coverage[arm][case]+=1
    row['acceptedCaseSamples']={k:len(v)for k,v in good.items()};row['rejectedCaseSamples']={k:len(v)for k,v in bad.items()};save()
   tychoCoverage[mode]={a:dict(c) for a,c in coverage.items()};(p/'tycho-coverage.json').write_text(json.dumps(tychoCoverage,indent=2)+'\n');print('TYCHO MIN ACCEPTED PROCESSES',mode,{a:min((c[k]for k in allCases),default=0)for a,c in coverage.items()},'cycle',cycle,flush=True)
   if all(coverage[a][k]>=2 for a in roots for k in allCases):break
  if not all(coverage[a][k]>=2 for a in roots for k in allCases):raise RuntimeError('Tycho per-case envelope incomplete after bounded3 cycles '+mode)
 certify(start,identity('identity-after-tycho'))
 # Calibrated heap is separate from ordinary timings: explicit GC + sampling.
 for mode in ['normal','off']:
  for control in ['drop','retain-closures','allocating-control']:
   accepted=collections.Counter()
   for arm in ['baseline','candidate','candidate','baseline','baseline','candidate']*2:
    if accepted[arm]>=3:continue
    row,data,m=run('heap-'+control,mode,arm,control);accepted[arm]+=row['accepted']
    if control=='retain-closures':assert data['closureControl']==5
    assert data['count']==400
    if all(accepted[a]>=3 for a in roots):break
   print('HEAP ACCEPTED',mode,control,dict(accepted),flush=True)
   if not all(accepted[a]>=3 for a in roots):raise RuntimeError('Heap envelope incomplete after bounded retries '+mode+'/'+control)
 certify(start,identity('identity-timing-end'))
 (p/'COMPLETE.json').write_text(json.dumps({'complete':True,'records':len(records),'sourceUnchanged':True,'allControlsPassed':True,'completedAtEpochSeconds':time.time()},indent=2)+'\n')
 print('FINAL MATRIX COMPLETE',len(records),flush=True)
except BaseException as e:
 (p/'STOP.json').write_text(json.dumps({'error':str(e),'records':len(records),'atEpochSeconds':time.time()},indent=2)+'\n');raise
finally:
 r=subprocess.run(lock+['release',owner],capture_output=True,text=True);(p/'release.log').write_text(r.stdout+r.stderr);print('LOCK RELEASE',r.returncode,r.stdout,flush=True)
