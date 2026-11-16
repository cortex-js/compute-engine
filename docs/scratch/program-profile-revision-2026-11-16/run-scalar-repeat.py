from pathlib import Path
import subprocess,json,time,os
p=Path(__file__).resolve().parent;repo=Path('/Users/arno/dev/compute-engine');child=repo/'benchmarks/program-regression-child.mjs';rows=[]
for i,arm in enumerate(['baseline','candidate','candidate','baseline'],5):
 root=Path('/private/tmp/program-only-accepted-'+arm+'-20261115');name=f'scalar-{arm}-{i}';req={'root':str(root),'workload':'scalar','mode':'scalar'};request=p/(name+'.request.json');request.write_text(json.dumps(req,indent=2)+'\n');env=os.environ.copy();env['CE_ALT_PKG']=str(root/'ce');cmd=['python3',str(p/'monitor.py'),name,'timeout','-k','10','120','node',str(child),str(request),str(p/(name+'.json'))];r=subprocess.run(cmd,cwd=p,env=env);row={'name':name,'arm':arm,'command':cmd,'driverExit':r.returncode};rows.append(row);(p/'scalar-repeat-status.json').write_text(json.dumps(rows,indent=2)+'\n');print(row,flush=True)
 if r.returncode not in [0,3]:raise SystemExit(r.returncode)
