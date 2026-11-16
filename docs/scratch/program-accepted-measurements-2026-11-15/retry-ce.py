import subprocess,json
from pathlib import Path
b=Path(__file__).resolve().parent
for r in [4,5]:
 for label,jit in [('normal','auto'),('off','off')]:
  name=f'ce-{label}-repeat{r}'
  subprocess.run(['python3','run-one.py',name,'node','ce-time.mjs',name+'.json',jit],cwd=b)
