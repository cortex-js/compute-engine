import subprocess,time,json
from pathlib import Path
p=Path(__file__).resolve().parent;owner='codex-program-accepted:matched-performance';lock=['node',str(Path.home()/'.claude/scripts/box-lock.mjs')]
print('Controller waiting for existing FIFO acquire; no duplicate enqueue.',flush=True)
while True:
 r=subprocess.run(lock+['check',owner],capture_output=True,text=True)
 if r.returncode==0:break
 time.sleep(2)
(p/'controller-acquired.json').write_text(json.dumps({'acquiredEpochSeconds':time.time(),'lockCheck':r.stdout},indent=2)+'\n');print('LOCK ACQUIRED: starting one final production build + matched matrix.',flush=True)
with (p/'matrix.log').open('w') as log:r=subprocess.run(['python3',str(p/'final-matrix.py')],cwd=p,stdout=log,stderr=subprocess.STDOUT)
(p/'controller-exit.json').write_text(json.dumps({'exitCode':r.returncode,'finishedEpochSeconds':time.time()},indent=2)+'\n');print('FINAL MATRIX DRIVER EXIT',r.returncode,flush=True);raise SystemExit(r.returncode)
