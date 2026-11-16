import argparse,subprocess,time,json,os,re
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('name');parser.add_argument('command',nargs=argparse.REMAINDER);args=parser.parse_args()
root=Path(__file__).resolve().parent
lock=['node',str(Path.home()/'.claude/scripts/box-lock.mjs'),'check','codex-program-accepted:matched-performance']
check=subprocess.run(lock,capture_output=True,text=True)
if check.returncode:raise SystemExit(check.stdout+check.stderr)
def snapshot():
 text=subprocess.check_output(['ps','-Ao','pid=,ppid=,time=,pcpu=,comm='],text=True)
 rows=[]
 for line in text.splitlines():
  v=line.strip().split(None,4)
  if len(v)!=5:continue
  pid,ppid,clock,cpu,command=v
  fields=clock.split(':');seconds=sum(float(v)*60**i for i,v in enumerate(reversed(fields)))
  rows.append({'pid':int(pid),'ppid':int(ppid),'seconds':seconds,'cpu':float(cpu),'command':command})
 return rows
before=snapshot();started=time.time();log=open(root/(args.name+'.log'),'w');proc=subprocess.Popen(args.command,cwd=root,stdout=log,stderr=subprocess.STDOUT,env=os.environ.copy());history=[];previous={r['pid']:r for r in before};last=started
while True:
 time.sleep(.4);now=time.time();rows=snapshot();mine={proc.pid,os.getpid()};changed=True
 while changed:
  changed=False
  for r in rows:
   if r['ppid'] in mine and r['pid'] not in mine:mine.add(r['pid']);changed=True
 contenders=[];background=[]
 for r in rows:
  prior=previous.get(r['pid']);actual=100*(r['seconds']-prior['seconds'])/(now-last) if prior else r['cpu']
  if r['pid'] in mine:continue
  known=bool(re.search(r'node|esbuild|tsc|jest|vitest',r['command'],re.I))
  if re.search(r'Chrome Helper|firefox|Safari Web Content',r['command'],re.I) and actual>10:background.append({**r,'intervalCpu':actual})
  if known and actual>80:contenders.append({**r,'intervalCpu':actual})
  elif re.search(r'jest-worker|/bin/jest|check-corpus|ci-nightly',r['command']) and actual>5:contenders.append({**r,'intervalCpu':actual})
 contenderArguments=''
 if contenders:
  ids=sorted({v for r in contenders for v in [r['pid'],r['ppid']]})
  details=subprocess.run(['ps','-p',','.join(map(str,ids)),'-o','pid=,ppid=,command='],capture_output=True,text=True)
  contenderArguments=details.stdout
 history.append({'atSeconds':now-started,'load':os.getloadavg(),'contenders':contenders,'browserBackground':background,'rejectedIntervalCommandLines':contenderArguments})
 previous={r['pid']:r for r in rows};last=now
 if proc.poll() is not None:break
code=proc.wait();log.close();after=subprocess.run(lock,capture_output=True,text=True)
result={'name':args.name,'command':args.command,'cwd':str(root),'exitCode':code,'durationSeconds':time.time()-started,'startedEpochMs':started*1000,'lockBefore':check.stdout,'lockAfter':after.stdout,'maxLoad':18,'maxExternalIntervalCpu':80,'samplingSeconds':.4,'browserPolicy':'record fixed browser activity; acceptance requires matched repeated controls per orchestrator','before':before,'monitor':history,'accepted':code==0 and after.returncode==0 and all(not h['contenders'] and h['load'][0]<=18 for h in history)}
(root/(args.name+'.monitor.json')).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['name','exitCode','durationSeconds','accepted']}),flush=True)
raise SystemExit(0 if result['accepted'] else 3)
