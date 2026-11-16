from pathlib import Path
import subprocess,json,hashlib,time,os,shutil,statistics
p=Path(__file__).resolve().parent;repo=Path('/Users/arno/dev/compute-engine');owner='codex-program-type-work:three-arm';lock=['node',str(Path.home()/'.claude/scripts/box-lock.mjs'),'check',owner];child=repo/'benchmarks/program-regression-child.mjs';rows=[];arms={'original':Path('/private/tmp/program-only-accepted-baseline-20261115'),'guard':Path('/private/tmp/program-only-profile-revision-20261116'),'revision':Path('/private/tmp/program-only-type-work-revision-20261116')};sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
def check():
 r=subprocess.run(lock,capture_output=True,text=True)
 if r.returncode:raise SystemExit(r.stdout+r.stderr)
def files(root):return {str(f.relative_to(root)):sha(f)for f in sorted(root.rglob('*'))if f.is_file()and f.name!='.DS_Store'}
def identity(label):
 d={'epochSeconds':time.time(),'instrument':{'path':str(child),'sha256':sha(child)},'arms':{}}
 for arm,root in arms.items():d['arms'][arm]={'root':str(root),'source':{project:files(root/project/'src')for project in ['ce','tycho']},'build':files(root/'ce/dist'),'configuration':{n:sha(root/'ce'/n)for n in ['scripts/build.mjs','package.json','package-lock.json','tsconfig.json']},'dependencies':{project:{n:{'sha256':sha(root/project/'node_modules'/n/'package.json'),'realpath':str((root/project/'node_modules'/n/'package.json').resolve())}for n in ['tsx','esbuild','typescript']if(root/project/'node_modules'/n/'package.json').exists()}for project in ['ce','tycho']}}
 (p/(label+'.json')).write_text(json.dumps(d,indent=2)+'\n');return d

def run(mode,case,arm,tag=''):
 check();root=arms[arm];name=f'{mode}-{case}-{arm}{tag}';req=p/(name+'.request.json');out=p/(name+'.json');req.write_text(json.dumps({'root':str(root),'workload':case,'mode':mode,'warmup':1000,'iterations':20000},indent=2)+'\n');cmd=['node','--import',str(root/'ce/node_modules/tsx/dist/loader.mjs'),'--import',str(root/'tycho/scripts/repros/ce-alt-hook.mjs'),str(child),str(req),str(out)];env=os.environ.copy();env['CE_ALT_PKG']=str(root/'ce');started=time.time()
 if mode=='timing':
  cmd=['python3',str(p/'monitor.py'),name,'timeout','-k','10','120']+cmd;r=subprocess.run(cmd,cwd=repo,env=env);m=json.load(open(p/(name+'.monitor.json')));assert m['exitCode']==0,m
 else:
  cmd=['timeout','-k','10','120']+cmd
  with(p/(name+'.log')).open('w')as log:r=subprocess.run(cmd,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
 row={'name':name,'mode':mode,'case':case,'arm':arm,'command':cmd,'cwd':str(repo),'environment':{'CE_ALT_PKG':env['CE_ALT_PKG']},'driverExit':r.returncode,'seconds':time.time()-started};rows.append(row);(p/'status.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(row),flush=True)
 if r.returncode not in([0,3]if mode=='timing'else[0]):raise SystemExit(r.returncode)
 return mode!='timing'or m['accepted']

check();before=identity('identity-before-build');revision=arms['revision'];assert len(json.load(open(p.parent/'causal-revision-source.json'))['changed'])==5
shutil.rmtree(revision/'ce/dist');started=time.time()
with(p/'build.log').open('w')as log:r=subprocess.run(['node','scripts/build.mjs'],cwd=revision/'ce',env={**os.environ,'BUILD':'production'},stdout=log,stderr=subprocess.STDOUT)
(p/'build-status.json').write_text(json.dumps({'command':['node','scripts/build.mjs'],'cwd':str(revision/'ce'),'environment':{'BUILD':'production'},'exitCode':r.returncode,'seconds':time.time()-started},indent=2)+'\n');assert r.returncode==0
start=identity('identity-timing-start');assert all(before['arms'][a]['source']==start['arms'][a]['source']for a in arms)
for case in ['box','parse-box','check','notebook']:
 for arm in arms:run('controls',case,arm)
coverage={}
for case in ['box','parse-box','check','notebook']:
 coverage[case]={arm:0 for arm in arms}
 for i,arm in enumerate(['original','guard','revision','revision','guard','original'],1):coverage[case][arm]+=run('timing',case,arm,f'-{i}')
 # At most two extra independent attempts per missing arm, in alternating order.
 for repair in range(2):
  order=list(arms)if repair%2 else list(reversed(arms))
  for arm in order:
   if coverage[case][arm]<2:coverage[case][arm]+=run('timing',case,arm,f'-repair{repair+1}')
 (p/'coverage.json').write_text(json.dumps(coverage,indent=2)+'\n')
print('ordinary_complete',json.dumps(coverage),flush=True)
for case in ['box','parse-box','check','notebook']:
 for arm in arms:run('allocation',case,arm)
end=identity('identity-timing-end');assert start['arms']==end['arms'];print('source_build_dependencies_unchanged=True',flush=True)
# Separate diagnostic builds and traces AFTER ordinary processes, never timed.
traceRows=[]
for arm in ['guard','revision']:
 root=p.parent/f'{arm}-final-diagnostic';check();started=time.time()
 with(p/f'{arm}-diagnostic-build.log').open('w')as log:r=subprocess.run(['node','scripts/build.mjs'],cwd=root/'ce',env={**os.environ,'BUILD':'production'},stdout=log,stderr=subprocess.STDOUT)
 traceRows.append({'arm':arm,'buildExit':r.returncode,'seconds':time.time()-started});assert r.returncode==0
 for case,edit in [('box',False),('parse-box',False),('check',False),('notebook',False),('notebook',True)]:
  check();name=f'trace-final-{case}'+('-edit'if edit else'')+f'-{arm}';req=p/(name+'.request.json');out=p/(name+'.json');req.write_text(json.dumps({'root':str(root),'workload':case,'mode':'trace','warmup':3,'iterations':3,'edit':edit},indent=2)+'\n');cmd=['node','--import',str(root/'ce/node_modules/tsx/dist/loader.mjs'),'--import',str(root/'tycho/scripts/repros/ce-alt-hook.mjs'),'--import',str(repo/'benchmarks/program-type-work-trace.mjs'),str(p.parent/'child.mjs'),str(req),str(out)];env={**os.environ,'CE_ALT_PKG':str(root/'ce')}
  with(p/(name+'.log')).open('w')as log:r=subprocess.run(cmd,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
  traceRows.append({'arm':arm,'case':case,'edit':edit,'command':cmd,'environment':{'CE_ALT_PKG':env['CE_ALT_PKG']},'cwd':str(repo),'exitCode':r.returncode});(p/'trace-status.json').write_text(json.dumps(traceRows,indent=2)+'\n');assert r.returncode==0,(name,r.returncode);assert json.load(open(out))['trace']['dropped']==0;print(name,'exit0',flush=True)
final=identity('identity-after-traces');assert end['arms']==final['arms'];print('ALL_MEASUREMENTS_AND_TRACES_COMPLETE',flush=True)
