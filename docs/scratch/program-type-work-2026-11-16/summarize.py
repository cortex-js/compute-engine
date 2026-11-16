from pathlib import Path
import json,collections,hashlib,shutil,subprocess
p=Path(__file__).resolve().parent;out=Path('/Users/arno/dev/compute-engine/docs/scratch/program-type-work-2026-11-16');out.mkdir(exist_ok=True)
summary={}
for case in ['box','parse-box','check','notebook','notebook-edit','notebook-refined']:
 d=json.load(open(p/f'trace-{case}.json'));ev=d['trace']['events'];by={e['id']:e for e in ev};counts=collections.Counter(e['kind']for e in ev);reasons={};repeats={}
 for e in ev:
  if e['kind']!='operand-map':continue
  k=e['reason'];row=reasons.setdefault(k,{'calls':0,'heads':collections.Counter(),'functionTypeQueries':0,'bindingTypeReads':0,'boundCallType':0,'fullSignature':0});row['calls']+=1;row['heads'][e.get('operator')]+=1
  for q in ev:
   parent=q.get('parent')
   while parent:
    if parent==e['id']:
     if q['kind']=='expression-read'and q.get('read')=='type':row['functionTypeQueries']+=1
     if q['kind']=='binding-read'and q.get('read')in['type','declaredType']:row['bindingTypeReads']+=1
     if q['kind']=='boundCallType':row['boundCallType']+=1
     if q['kind']=='functionLiteralSignatureType':row['fullSignature']+=1
     break
    parent=by[parent].get('parent')
 for kind in ['boundCallType','functionLiteralSignatureType']:
  seen={};rows=[]
  for e in ev:
   if e['kind']!=kind:continue
   key=(e['operation'],e.get('expr'));old=seen.get(key);seen[key]=e
   if old:
    a=old.get('context',{});b=e.get('context',{});diff=[]
    for k in ['scope','context','stack']:
     if a.get(k)!=b.get(k):diff.append(k)
    for k in ['_anyVersion','_typeVersion','_semanticVersion','_worldVersion','_callableVersion','_definitionVersion','_evaluationVersion','_factSuppressionDepth']:
     if a.get('lifecycle',{}).get(k)!=b.get('lifecycle',{}).get(k):diff.append(k)
    rows.append({'operation':e['operation'],'operator':e.get('operator'),'expr':e.get('expr'),'first':old['id'],'second':e['id'],'observedChanges':diff,'classification':'changed observed context/versions'if diff else'unknown: matching observed state does not prove all hidden inputs'})
  repeats[kind]={'pairs':len(rows),'changedObserved':sum(bool(r['observedChanges'])for r in rows),'unknownSameObserved':sum(not r['observedChanges']for r in rows),'examples':rows[:3]}
 timeline=[]
 if case=='notebook-refined':
  for e in ev:
   if e['operation']==0 and e['kind']in ['boundCallType','evidence-target','joinEvidenceOnBinding','writeEvidenceType','evidence-rejoin']:
    timeline.append({k:e[k]for k in ['id','parent','kind','expr','operator','target','before','after','assignedType','proposed','result','pass','coarse','context','contextAfter']if k in e})
 summary[case]={'operations':3,'dropped':d['trace']['dropped'],'counts':counts,'boundHeads':collections.Counter(e.get('operator')for e in ev if e['kind']=='boundCallType'),'signatureDemandReasons':collections.Counter(e.get('reason')for e in ev if e['kind']=='signature-demand'),'maps':reasons,'evidencePasses':collections.Counter(str((e.get('pass'),e.get('coarse'),e.get('result')))for e in ev if e['kind']=='evidence-rejoin'),'repeats':repeats,'notebookOperation0Timeline':timeline}
(out/'SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n')
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
source=json.load(open(p/'source-copy-identity.json'));guard=Path(source['source']);now={str(f.relative_to(guard/'ce/src')):sha(f)for f in sorted((guard/'ce/src').rglob('*'))if f.is_file()};assert now==source['ceSource']
probe=p/'diagnostic/ce/trace-instrumentation.json';shutil.copy2(probe,out/'INSTRUMENTATION.json')
cert={'originalGuard':str(guard),'sourceCopyIdentityPrivate':str(p/'source-copy-identity.json'),'sourceCopyIdentitySha256':sha(p/'source-copy-identity.json'),'guardSourceUnchangedAtEnd':True,'guardSourceMapSha256':hashlib.sha256(json.dumps(now,sort_keys=True).encode()).hexdigest(),'finalProbeManifestSha256':sha(probe),'canonicalInstruments':{str(f):sha(f)for f in [Path('/Users/arno/dev/compute-engine/benchmarks/program-type-work-instrument.mjs'),Path('/Users/arno/dev/compute-engine/benchmarks/program-type-work-trace.mjs')]},'rawTraceHashes':{f.name:sha(f)for f in sorted(p.glob('trace-*.json'))if'.request.'not in f.name},'privateBuildHashes':{str(f.relative_to(p/'diagnostic/ce/dist')):sha(f)for f in sorted((p/'diagnostic/ce/dist/esm-min').rglob('*.js'))}}
(out/'IDENTITY.json').write_text(json.dumps(cert,indent=2)+'\n')
for n in ['status.json','status-notebook-refined.json','lock-release.log','run.py','run-notebook-refined.py','summarize.py']:shutil.copy2(p/n,out/n)
# Exact private observational delta, not a production patch.
parts=[]
for v in json.load(open(probe)):
 original=guard/'ce/src'/v['file'];changed=p/'diagnostic/ce/src'/v['file'];r=subprocess.run(['diff','-u','--label','a/src/'+v['file'],'--label','b/src/'+v['file'],str(original),str(changed)],capture_output=True,text=True);assert r.returncode in[0,1];parts.append(r.stdout)
(out/'instrumentation.diff').write_text(''.join(parts))
# Compact controls only, no raw event arrays.
controls=[]
for f in sorted(p.glob('control-*.json')):
 if'.request.'not in f.name:
  j=json.load(open(f));controls.append({'file':f.name,'status':j['status'],'precision':j.get('precision'),'jit':j.get('jit'),'controls':j['controls']})
(out/'CONTROLS.json').write_text(json.dumps(controls,indent=2)+'\n')
print('summary saved',out)
