from pathlib import Path
import json,hashlib,gzip,shutil
p=Path(__file__).resolve().parent;b=Path('/Users/arno/dev/compute-engine/docs/scratch/program-accepted-measurements-2026-11-15');items=[]
for f in sorted(p.iterdir()):
 if not f.is_file()or f.is_symlink():continue
 name='final-matched-'+f.name;target=b/name;compress=f.suffix=='.json'and f.stat().st_size>100000
 if compress:
  target=target.with_name(target.name+'.gz')
  with gzip.open(target,'wb')as out:out.write(f.read_bytes())
 else:shutil.copy2(f,target)
 items.append({'original':f.name,'archived':target.name,'originalSha256':hashlib.sha256(f.read_bytes()).hexdigest(),'archivedSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'originalBytes':f.stat().st_size,'archivedBytes':target.stat().st_size,'gzip':compress})
(b/'final-matched-artifacts.json').write_text(json.dumps({'root':str(p),'artifacts':items,'sourceBuildsRetained':True,'baselineReportPreserved':True},indent=2)+'\n');print('Archived',len(items),'files',sum(x['archivedBytes']for x in items),'bytes')
