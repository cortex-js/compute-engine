from pathlib import Path
import subprocess,json,os,time,hashlib
p=Path(__file__).resolve().parent;repo=Path('/Users/arno/dev/compute-engine');roots={'guard':Path('/private/tmp/program-only-profile-revision-20261116'),'diagnostic':p/'diagnostic'};rows=[]
def run(name,arm,case,mode,source=False,edit=False):
 root=roots[arm];request={'root':str(root),'workload':case,'mode':mode,'warmup':3,'iterations':3,'edit':edit}
 if source:request['entry']=str(root/'ce/src/epsil.ts')
 req=p/(name+'.request.json');out=p/(name+'.json');req.write_text(json.dumps(request,indent=2)+'\n');cmd=['node','--import',str(root/'ce/node_modules/tsx/dist/loader.mjs'),'--import',str(root/'tycho/scripts/repros/ce-alt-hook.mjs'),'--import',str(repo/'benchmarks/program-type-work-trace.mjs'),str(p/'child.mjs'),str(req),str(out)];env=os.environ.copy();env['CE_ALT_PKG']=str(root/'ce');started=time.time()
 with(p/(name+'.log')).open('w')as log:r=subprocess.run(cmd,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
 row={'name':name,'arm':arm,'request':request,'command':cmd,'environment':{'CE_ALT_PKG':env['CE_ALT_PKG']},'cwd':str(repo),'exitCode':r.returncode,'seconds':time.time()-started};rows.append(row);(p/'status.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
for case in ['box','parse-box','check','notebook']:
 for arm in roots:run(f'control-{case}-{arm}',arm,case,'controls')
for case in ['box','check']:run(f'control-source-{case}','diagnostic',case,'controls',source=True)
for case in ['box','parse-box','check','notebook']:run(f'trace-{case}','diagnostic',case,'trace')
run('trace-notebook-edit','diagnostic','notebook','trace',edit=True)
