import subprocess,json,hashlib,time,os
from pathlib import Path
r=Path('/Users/arno/dev/compute-engine');w=Path('/tmp/wt-program-accepted-sol')
b=r/'docs/scratch/program-accepted-measurements-2026-11-15';name='accepted-program-test-six'
files=json.loads(Path('/private/tmp/program-test-six-before-20261115/files.json').read_text())
assert len(files)==6
for f in files: assert (r/f).read_bytes()==(w/f).read_bytes(), f

def fingerprint():
 paths=sorted([p for base in ['src','test'] for p in (r/base).rglob('*.ts') if p.is_file()])
 stats={str(p.relative_to(r)):p.stat().st_mtime_ns for p in paths}
 content={str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_relative_to(r/'src') or str(p.relative_to(r)) in files or p==r/'test/utils.ts'}
 for f in ['package.json','package-lock.json','jest.config.cjs','tsconfig.json']:
  p=r/f
  if p.exists(): content[f]=hashlib.sha256(p.read_bytes()).hexdigest()
 return {'mtimeNanoseconds':stats,'sha256':content}

check=subprocess.run(['node',str(Path.home()/'.claude/scripts/box-lock.mjs'),'check','codex-program-accepted:test-consumers'],capture_output=True,text=True)
assert check.returncode==0,check.stdout+check.stderr
before=fingerprint();(b/(name+'-before.json')).write_text(json.dumps(before,indent=2)+'\n')
command=['timeout','-k','30','600','npx','jest','-w','4','--watchman=false','--json','--outputFile='+str(b/(name+'-jest.json')),'--']+files
start=time.time()
with (b/(name+'-log.txt')).open('w') as log: run=subprocess.run(command,cwd=r,stdout=log,stderr=subprocess.STDOUT)
after=fingerprint();(b/(name+'-after.json')).write_text(json.dumps(after,indent=2)+'\n')
changed={kind:[p for p in sorted(set(before[kind])|set(after[kind])) if before[kind].get(p)!=after[kind].get(p)] for kind in before}
result={'cwd':str(r),'command':command,'exitCode':run.returncode,'durationSeconds':time.time()-start,'lockCheck':check.stdout,'files':files,'sourceStable':not any(changed.values()),'changedInputs':changed,'mainWorktreeTestsIdenticalBeforeRun':True}
(b/(name+'-run.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(run.returncode)
