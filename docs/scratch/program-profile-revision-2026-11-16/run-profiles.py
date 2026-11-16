from pathlib import Path
import subprocess,json,os,time,hashlib
p=Path(__file__).resolve().parent;repo=Path('/Users/arno/dev/compute-engine');child=repo/'benchmarks/program-regression-child.mjs';records=[]
for mode in ['controls','cpu','allocation','counts']:
 for workload in ['box','parse-box','check','notebook']:
  for arm in ['baseline','candidate']:
   root=Path('/private/tmp/program-only-accepted-'+arm+'-20261115');name=f'{mode}-{workload}-{arm}';req={'root':str(root),'workload':workload,'mode':mode,'warmup':1000 if mode!='controls'else 20,'iterations':20000};request=p/(name+'.request.json');request.write_text(json.dumps(req,indent=2)+'\n');env=os.environ.copy();env['CE_ALT_PKG']=str(root/'ce');cmd=['timeout','-k','10','120','node','--import','tsx','--import',str(root/'tycho/scripts/repros/ce-alt-hook.mjs'),str(child),str(request),str(p/(name+'.json'))];t=time.time()
   with (p/(name+'.log')).open('w')as log:r=subprocess.run(cmd,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
   row={'name':name,'command':cmd,'environment':{'CE_ALT_PKG':env['CE_ALT_PKG']},'exitCode':r.returncode,'seconds':time.time()-t};records.append(row);(p/'profile-status.json').write_text(json.dumps(records,indent=2)+'\n');print(row,flush=True)
   if r.returncode:raise SystemExit(r.returncode)
