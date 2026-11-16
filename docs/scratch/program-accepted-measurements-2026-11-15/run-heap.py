import subprocess,json
from pathlib import Path
b=Path(__file__).resolve().parent;records=[]
for r in range(1,4):
 for label,jit in [('normal','auto'),('off','off')]:
  for mode in ['drop','retain-closures','allocating-control']:
   name=f'heap-{mode}-{label}-{r}'
   # Preserve the already-calibrated retained-closure control as the first normal record.
   if mode=='retain-closures' and label=='normal' and r==1:continue
   with open(b/(name+'.log'),'w') as output:
    result=subprocess.run(['node','--expose-gc','heap.mjs',name+'.json',mode,jit],cwd=b,stdout=output,stderr=subprocess.STDOUT)
   records.append({'name':name,'exitCode':result.returncode})
   (b/'heap-status.json').write_text(json.dumps(records,indent=2)+'\n')
   print(json.dumps(records[-1]),flush=True)
   if result.returncode:raise SystemExit(result.returncode)
