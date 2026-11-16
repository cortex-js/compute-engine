import os,subprocess,json,time,statistics,collections,sys
from pathlib import Path
p=Path(__file__).resolve().parent
roots={'baseline':Path('/private/tmp/program-only-accepted-baseline-20261115'),'candidate':Path('/private/tmp/program-only-accepted-candidate-20261115')}
owner='codex-program-accepted:matched-performance';lock=['node',str(Path.home()/'.claude/scripts/box-lock.mjs')]
# Controllers resume the already certified artifact; never rebuild unchanged source.
if (p/'production-build-status.json').exists() and (p/'matrix-status.json').exists():
 for flag in ['--reuse-build','--resume']:
  if flag not in sys.argv:sys.argv.append(flag)
records=json.loads((p/'matrix-status.json').read_text()) if '--resume' in sys.argv else [];counter=collections.Counter()
for row in records:counter[row['kind'],row['mode'],row['arm']]=max(counter[row['kind'],row['mode'],row['arm']],int(row['name'].rsplit('-',1)[1]))
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
 if '--reuse-build' not in sys.argv:
  beforeBuild=identity('identity-before-build')
  env=os.environ.copy();env['BUILD']='production';cmd=['timeout','-k','30','600','node','scripts/build.mjs'];t=time.time()
  with (p/'production-build.log').open('w') as f:build=subprocess.run(cmd,cwd=roots['candidate']/'ce',env=env,stdout=f,stderr=subprocess.STDOUT)
  (p/'production-build-status.json').write_text(json.dumps({'command':cmd,'environment':{'BUILD':'production'},'cwd':str(roots['candidate']/'ce'),'exitCode':build.returncode,'seconds':time.time()-t},indent=2)+'\n');print('PRODUCTION BUILD',build.returncode,flush=True)
  if build.returncode:raise RuntimeError('Build failure')
  start=identity('identity-timing-start')
 else:
  original=json.loads((p/'attempt1-identity-timing-start.json').read_text());start=identity('identity-build-reuse');certify(original,start)
  assert json.loads((p/'production-build-status.json').read_text())['exitCode']==0
  (p/'build-reuse.json').write_text(json.dumps({'reusedExistingProductionBuild':True,'sourceBuildDepsUnchanged':True,'newBuildExecuted':False},indent=2)+'\n')
 if sourceProduction(start['arms']['candidate']['source']['ce'])!=sourceProduction(start['finalWorktreeSource']):raise RuntimeError('Candidate production source differs from final worktree before timing')
 if '--resume' not in sys.argv:
  with (p/'runtime-witnesses.log').open('w') as f:witness=subprocess.run(['node',str(p/'runtime-witnesses.mjs')],cwd=p,stdout=f,stderr=subprocess.STDOUT)
  (p/'runtime-witnesses-status.json').write_text(json.dumps({'exitCode':witness.returncode},indent=2)+'\n')
  if witness.returncode:raise RuntimeError('Runtime consumer witness failed; STOP before timings')
 else:
  assert json.loads((p/'runtime-witnesses-status.json').read_text())['exitCode']==0
  assert len(json.loads((p/'runtime-witnesses.json').read_text()))==16

 # CE: preserve counterbalancing within each independent CE JIT mode.
 for mode,order in [('normal',['baseline','candidate','candidate','baseline']),('off',['candidate','baseline','baseline','candidate'])]:
  accepted=collections.Counter({a:sum(x['kind']=='ce' and x['mode']==mode and x['arm']==a and x['accepted'] for x in records) for a in roots})
  if all(accepted[a]>=2 for a in roots):
   print('CE REUSE ACCEPTED',mode,dict(accepted),flush=True);continue
  for cycle in range(1,4):
   for arm in order:
    row,data,m=run('ce',mode,arm)
    accepted[arm]+=row['accepted']
   print('CE ACCEPTED',mode,dict(accepted),'cycle',cycle,flush=True)
   if min(accepted.values(),default=0)>=2 and len(accepted)==2:break
   if cycle<3:print('REJECTION_COOLDOWN_SECONDS',5,flush=True);time.sleep(5)
  if min(accepted.values(),default=0)<2 or len(accepted)!=2:raise RuntimeError('CE repeatability incomplete after bounded3 counterbalanced cycles '+mode)
 certify(start,identity('identity-after-ce'))
 # Tycho: full unchanged adapter, full showcase initialization, real evaluator.
 digests={};tychoCoverage={};incompleteTycho=[]
 for mode,order in [('normal',['baseline','candidate','candidate','baseline']),('off',['candidate','baseline','baseline','candidate'])]:
  coverage={arm:collections.Counter() for arm in roots};allCases=None
  for prior in [r for r in records if r['kind']=='tycho'and r['mode']==mode]:
   data=json.loads((p/(prior['name']+'.json')).read_text());m=json.loads((p/(prior['name']+'.monitor.json')).read_text());good,bad=tychoCases(data,m)
   allCases={rec['id']+(':'+x['phase']if'phase'in x else '')for rec in data['records']for x in rec['samples']}
   for case in good:coverage[prior['arm']][case]+=1
   for rec in data['records']:
    hashes={x['valueSha256']for x in rec['samples']if'valueSha256'in x}
    if hashes:
     assert len(hashes)==1;key=(mode,rec['id']);value=next(iter(hashes))
     if key in digests:assert digests[key]==value
     digests[key]=value
  if allCases and all(coverage[a][k]>=2 for a in roots for k in allCases):
   print('TYCHO REUSE ACCEPTED',mode,{a:min(c[k]for k in allCases)for a,c in coverage.items()},flush=True);tychoCoverage[mode]={a:dict(c)for a,c in coverage.items()};continue
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
  if not all(coverage[a][k]>=2 for a in roots for k in allCases):
   incompleteTycho.append({'mode':mode,'missing':{a:{k:coverage[a][k]for k in allCases if coverage[a][k]<2}for a in roots}})
   print('TYCHO TIMING GAPS RETAINED; CONTINUE INDEPENDENT HEAP',mode,flush=True)
 certify(start,identity('identity-after-tycho'))
 # Heap byte controls are independent of duration timing acceptance.
 for mode in ['normal','off']:
  for control in ['drop','retain-closures','allocating-control']:
   valid=collections.Counter({a:sum(r['kind']=='heap-'+control and r['mode']==mode and r['arm']==a and r['exitCode']==0 for r in records)for a in roots})
   for arm in ['baseline','candidate','candidate','baseline','baseline','candidate']:
    if valid[arm]>=3:continue
    row,data,m=run('heap-'+control,mode,arm,control)
    if control=='retain-closures':assert data['closureControl']==5
    assert data['count']==400
    row['memoryControlValid']=True;row['durationTimingAccepted']=row['accepted'];valid[arm]+=1;save()
   assert all(valid[a]>=3 for a in roots)
   print('HEAP VALID BYTE CONTROLS',mode,control,dict(valid),'CPU flags retained separately',flush=True)
 certify(start,identity('identity-timing-end'))
 (p/'COMPLETE.json').write_text(json.dumps({'complete':not incompleteTycho,'memoryControlsComplete':True,'tychoTimingGaps':incompleteTycho,'records':len(records),'sourceUnchanged':True,'allControlsPassed':True,'completedAtEpochSeconds':time.time()},indent=2)+'\n')
 print('FINAL MATRIX COMPLETE',len(records),flush=True)
except BaseException as e:
 (p/'STOP.json').write_text(json.dumps({'error':str(e),'records':len(records),'atEpochSeconds':time.time()},indent=2)+'\n');raise
finally:
 r=subprocess.run(lock+['release',owner],capture_output=True,text=True);(p/'release.log').write_text(r.stdout+r.stderr);print('LOCK RELEASE',r.returncode,r.stdout,flush=True)
