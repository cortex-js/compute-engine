from pathlib import Path
import json,subprocess,os,time,hashlib
p=Path(__file__).resolve().parent;repo=Path('/Users/arno/dev/compute-engine');child=repo/'benchmarks/program-regression-child.mjs';roots={'accepted':Path('/private/tmp/program-only-accepted-candidate-20261115'),'revision':Path('/private/tmp/program-only-profile-revision-20261116')};rows=[]
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
def identity():
 return {'epochSeconds':time.time(),'instrumentSha256':sha(child),'arms':{arm:{'root':str(root),'source':{str(f.relative_to(root)):sha(f)for project in ['ce','tycho']for f in sorted((root/project/'src').rglob('*'))if f.is_file()},'build':{str(f.relative_to(root)):sha(f)for f in sorted((root/'ce/dist').rglob('*'))if f.is_file()},'dependencies':{str(root/project/'node_modules'/name/'package.json'):sha(root/project/'node_modules'/name/'package.json')for project in ['ce','tycho']for name in ['esbuild','tsx']}}for arm,root in roots.items()}}
(p/'identity-timing-r2-start.json').write_text(json.dumps(identity(),indent=2)+'\n')
def run(mode,case,arm,tag=''):
 root=roots[arm];name=f'{mode}-{case}-{arm}'+tag;request=p/(name+'.request.json');out=p/(name+'.json');request.write_text(json.dumps({'root':str(root),'workload':case,'mode':mode,'warmup':1000,'iterations':20000},indent=2)+'\n');cmd=['node','--import',str(root/'ce/node_modules/tsx/dist/loader.mjs'),'--import',str(root/'tycho/scripts/repros/ce-alt-hook.mjs'),str(child),str(request),str(out)];env=os.environ.copy();env['CE_ALT_PKG']=str(root/'ce');started=time.time()
 if mode=='timing':
  cmd=['python3',str(p/'monitor.py'),name,'timeout','-k','10','120']+cmd;r=subprocess.run(cmd,cwd=repo,env=env)
 else:
  cmd=['timeout','-k','10','120']+cmd
  with (p/(name+'.log')).open('w')as log:r=subprocess.run(cmd,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
 row={'name':name,'arm':arm,'workload':case,'mode':mode,'command':cmd,'environment':{'CE_ALT_PKG':env['CE_ALT_PKG']},'cwd':str(repo),'driverExit':r.returncode,'seconds':time.time()-started};rows.append(row);(p/'status-timing-r2.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(row),flush=True)
 if mode=='timing' and json.load(open(p/(name+'.monitor.json')))['exitCode'] != 0:raise SystemExit('Timing child failed before acceptance')
 if r.returncode not in ([0,3]if mode=='timing'else[0]):raise SystemExit(r.returncode)

for case in ['box','check','notebook']:
 for i,arm in enumerate(['accepted','revision','revision','accepted'],1):run('timing',case,arm,f'-r2-{i}')
end=identity();(p/'identity-timing-r2-end.json').write_text(json.dumps(end,indent=2)+'\n');start=json.load(open(p/'identity-timing-r2-start.json'));assert start['arms']==end['arms'];print('identity_start_end_equal=True',flush=True)
