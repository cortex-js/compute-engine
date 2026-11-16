import subprocess,os
from pathlib import Path
b=Path(__file__).resolve().parent
for r in [4,5]:
 for label,jit in [('normal','auto'),('off','off')]:
  name=f'tycho-{label}-repeat{r}';env=os.environ.copy();env['CE_ALT_PKG']=str(b/'ce')
  subprocess.run(['python3','run-one.py',name,'node','--import','tsx','--import','./tycho/scripts/repros/ce-alt-hook.mjs','tycho-time.mts',name+'.json',jit],cwd=b,env=env)
