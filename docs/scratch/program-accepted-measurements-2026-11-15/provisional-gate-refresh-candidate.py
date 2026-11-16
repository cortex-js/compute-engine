from pathlib import Path
import shutil,json,hashlib,time
base=Path('/private/tmp/program-only-accepted-baseline-20261115');cand=Path('/private/tmp/program-only-accepted-candidate-20261115');work=Path('/tmp/wt-program-accepted-sol');out=Path('/private/tmp/program-matched-perf-20261115');durable=Path('/Users/arno/dev/compute-engine/docs/scratch/program-accepted-measurements-2026-11-15');tycho=Path('/Users/arno/dev/tycho')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def files(p):return {str(f.relative_to(p)):sha(f) for f in p.rglob('*') if f.is_file() and f.name!='.DS_Store'}
workBefore=files(work/'src');baselineBefore={p:files(base/p/'src') for p in ['ce','tycho']}
# The candidate is the original frozen snapshot plus final worktree source,
# and only the three inspected Program-container consumer patches in Tycho.
for rel in set(files(cand/'ce/src'))-set(workBefore):(cand/'ce/src'/rel).unlink()
for rel in workBefore:
 target=cand/'ce/src'/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(work/'src'/rel,target)
tychoAllowed=['src/graph-paper/notebook/ce-notebook-evaluator.ts','src/graph-paper/notebook/cortex-analysis.ts','src/plot-core/prelude-runner.ts']
for rel in files(base/'tycho/src'):
 target=cand/'tycho/src'/rel;source=tycho/'src'/rel if 'src/'+rel in tychoAllowed else base/'tycho/src'/rel
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
for rel in set(files(cand/'tycho/src'))-set(files(base/'tycho/src')):(cand/'tycho/src'/rel).unlink()
assert workBefore==files(work/'src'),'worktree changed during snapshot'
assert workBefore==files(cand/'ce/src'),'candidate source differs from final worktree'
assert baselineBefore=={p:files(base/p/'src') for p in ['ce','tycho']},'baseline changed'
rows=[]
for project in ['ce','tycho']:
 b=files(base/project/'src');c=files(cand/project/'src')
 for rel in sorted(set(b)|set(c)):rows.append({'project':project,'file':'src/'+rel,'baselineSha256':b.get(rel),'candidateSha256':c.get(rel)})
manifest={'baselineRoot':str(base),'candidateRoot':str(cand),'baseCommit':'ffff1d44fc566ef01fb52a0ce67b6797797f4dcf','snapshotEpochSeconds':time.time(),'worktreeSourceRoot':str(work/'src'),'tychoAllowedFiles':tychoAllowed,'files':rows}
assert {x['file'] for x in rows if x['project']=='tycho' and x['baselineSha256']!=x['candidateSha256']}==set(tychoAllowed)
for f in ['ce-time.mjs','tycho-time.mts','heap.mjs']:assert sha(base/f)==sha(cand/f),f
for f in ['package.json','package-lock.json','tsconfig.json']:assert sha(base/'ce'/f)==sha(cand/'ce'/f),f
assert files(base/'ce/scripts')==files(cand/'ce/scripts'),'build scripts differ'
old=durable/'candidate-source-manifest.json'
if old.exists():shutil.copy2(old,out/'candidate-source-manifest-pre-final.json')
for p in [out/'candidate-source-manifest-final.json',old]:p.write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'CEChangedFiles':sum(x['project']=='ce' and x['baselineSha256']!=x['candidateSha256'] for x in rows),'TychoChangedFiles':3,'candidateSourceMatchesFinalWorktree':True,'matchedAdapters':True,'matchedBuildInputs':True,'manifestSha256':sha(old)}))
