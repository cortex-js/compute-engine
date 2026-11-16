import subprocess,os,json,sys
from pathlib import Path
p=Path(__file__).resolve().parent;roots={'baseline':Path('/private/tmp/program-only-accepted-baseline-20261115'),'candidate':Path('/private/tmp/program-only-accepted-candidate-20261115')};records=[]
for label,jit,order in [('normal','auto',['baseline','candidate','candidate','baseline']),('off','off',['candidate','baseline','baseline','candidate'])]:
 for i,arm in enumerate(order,1):
  name=f'ce-{label}-{arm}-gate{i}';root=roots[arm];env=os.environ.copy();env['CE_ROOT']=str(root/'ce')
  command=['python3','monitor.py',name,'timeout','-k','5','120','node',str(root/'ce-time.mjs'),str(p/(name+'.json')),jit]
  result=subprocess.run(command,cwd=p,env=env)
  records.append({'name':name,'arm':arm,'mode':label,'returncode':result.returncode,'command':command,'environment':{'CE_ROOT':env['CE_ROOT']}});(p/'ce-gate-status.json').write_text(json.dumps(records,indent=2)+'\n')
  if result.returncode not in [0,3]:raise SystemExit(result.returncode)
  monitor=json.loads((p/(name+'.monitor.json')).read_text())
  if monitor['exitCode']!=0:raise SystemExit(monitor['exitCode'])
