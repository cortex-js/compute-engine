from pathlib import Path
import os,subprocess,json,time,sys
p=Path(__file__).resolve().parent;owner='codex-program-accepted:matched-performance';lock=['node',str(Path.home()/'.claude/scripts/box-lock.mjs')];records=[]
def call(name,command,cwd=p,env=None):
 start=time.time()
 with (p/(name+'.log')).open('w') as log:r=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 record={'name':name,'command':command,'cwd':str(cwd),'exitCode':r.returncode,'durationSeconds':time.time()-start};records.append(record);(p/'build-ce-gate-chain-status.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(record),flush=True);return r.returncode
code=call('lock-final-gate',lock+['acquire',owner,'12','Program candidate production build + normal/off interleaved CE gate','--wait=60','--pid='+str(os.getpid())])
if code:raise SystemExit(code)
try:
 code=call('identity-source-start',['python3','identity.py','identity-source-start'])
 if code:raise SystemExit(code)
 env=os.environ.copy();env['BUILD']='production';code=call('candidate-production-build',['timeout','-k','30','600','node','scripts/build.mjs'],Path('/private/tmp/program-only-accepted-candidate-20261115/ce'),env)
 if code:raise SystemExit(code)
 code=call('identity-timing-start',['python3','identity.py','identity-timing-start'])
 if code:raise SystemExit(code)
 code=call('ce-gate-chain',['python3','ce-gate.py'])
 if code:raise SystemExit(code)
 code=call('identity-timing-end',['python3','identity.py','identity-timing-end'])
 if code:raise SystemExit(code)
 a=json.loads((p/'identity-timing-start.json').read_text());b=json.loads((p/'identity-timing-end.json').read_text());changes=[]
 for arm in a['arms']:
  for section in ['source','build','adapters','dependencies']:
   if a['arms'][arm][section]!=b['arms'][arm][section]:changes.append(arm+'/'+section)
 for rel,v in a['finalWorktreeSource'].items():
  if rel.endswith(('.ts','.js','.mjs')) and b['finalWorktreeSource'].get(rel)!=v:changes.append('finalWorktreeSource/'+rel)
 (p/'ce-gate-certification.json').write_text(json.dumps({'changedDuringTimings':changes,'certifiedUnchanged':not changes},indent=2)+'\n')
 if changes:raise SystemExit('STOP: meaningful source/build/dependency identity changed '+str(changes))
finally:
 release=call('release-final-gate',lock+['release',owner])
