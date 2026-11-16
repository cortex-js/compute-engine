import subprocess,json,os
from pathlib import Path
root=Path(__file__).resolve().parent;results=[]
# One pilot was rejected before the protocol explicitly allowed recorded fixed browser load.
for round in range(1,4):
 for label,jit in [('normal','auto'),('off','off')]:
  for kind in ['ce','tycho']:
   name=f'{kind}-{label}-repeat{round}'
   if kind=='ce':command=['node','ce-time.mjs',name+'.json',jit]
   else:command=['node','--import','tsx','--import','./tycho/scripts/repros/ce-alt-hook.mjs','tycho-time.mts',name+'.json',jit]
   env=os.environ.copy();env['CE_ALT_PKG']=str(root/'ce')
   result=subprocess.run(['python3','run-one.py',name]+command,cwd=root,env=env)
   results.append({'name':name,'returncode':result.returncode})
   (root/'matrix-status.json').write_text(json.dumps(results,indent=2)+'\n')
   if result.returncode not in [0,3]:raise SystemExit(result.returncode)
