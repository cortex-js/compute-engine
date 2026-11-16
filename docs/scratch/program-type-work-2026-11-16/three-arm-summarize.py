from pathlib import Path
import json,hashlib,statistics,collections,shutil,subprocess
p=Path(__file__).resolve().parent;dest=Path('/Users/arno/dev/compute-engine/docs/scratch/program-type-work-2026-11-16');dest.mkdir(exist_ok=True);sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();objsha=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest();status=json.load(open(p/'status.json'));summary={'timing':{},'rejections':[],'allocation':{},'traces':{},'controls':[]}
for case in ['box','parse-box','check','notebook']:summary['timing'][case]={'arms':{a:[]for a in['original','guard','revision']}}
for row in status:
 if row['mode']=='controls':
  r=json.load(open(p/(row['name']+'.json')));summary['controls'].append({'name':row['name'],'exitCode':row['driverExit'],'precision':r['precision'],'jit':r['jit'],'controls':r['controls']});continue
 if row['mode']!='timing':continue
 m=json.load(open(p/(row['name']+'.monitor.json')));r=json.load(open(p/(row['name']+'.json')));t=r['timing'];v={'name':row['name'],'arm':row['arm'],'case':row['case'],'exitCode':m['exitCode'],'accepted':m['accepted'],'warmup':r['warmup'],'iterationsPerSample':t['iterationsPerSample'],'samplesUs':[x['msPerOperation']*1000 for x in t['samples']],'medianUs':statistics.median(x['msPerOperation']*1000 for x in t['samples']),'maxLoad':max(x['load'][0]for x in m['monitor']),'rejectionIntervals':[{'seconds':x['atSeconds'],'load':x['load'],'contenders':x['contenders']}for x in m['monitor']if x['contenders']or x['load'][0]>18]}
 if v['accepted']:summary['timing'][row['case']]['arms'][row['arm']].append(v)
 else:summary['rejections'].append(v)
for case,v in summary['timing'].items():
 meds={a:statistics.median(x['medianUs']for x in rows)for a,rows in v['arms'].items()if rows};v['counts']={a:len(rows)for a,rows in v['arms'].items()};v['ratios']={n:meds[a]/meds[b]for n,a,b in [('guard/original','guard','original'),('revision/guard','revision','guard'),('revision/original','revision','original')]if len(v['arms'][a])>=2 and len(v['arms'][b])>=2}
for case in ['box','parse-box','check','notebook']:
 summary['allocation'][case]={}
 for arm in ['original','guard','revision']:
  r=json.load(open(p/f'allocation-{case}-{arm}.json'));control=json.load(open(p/f'allocation-{case}-{arm}.json.control.heapprofile'));summary['allocation'][case][arm]={'estimatedBytesPerOperation':r['estimatedBytesPerOperation'],'warmup':r['warmup'],'iterations':r['iterations'],'sampleIntervalBytes':32768,'samples':r['profileSamples'],'controlSamples':len(control['samples']),'cpuTimingAcceptance':'diagnostic, external monitor not attached; not a duration ratio'}
for case in ['box','parse-box','check','notebook','notebook-edit']:
 summary['traces'][case]={}
 for arm in ['guard','revision']:
  r=json.load(open(p/f'trace-final-{case}-{arm}.json'));ev=r['trace']['events'];by={e['id']:e for e in ev};counts=collections.Counter(x['kind']for x in ev);reads=collections.Counter(str((e['kind'],e.get('read')))for e in ev if e['kind']in['expression-read','binding-read']);maps={};repeats={}
  for e in ev:
   if e['kind']!='operand-map':continue
   row=maps.setdefault(e['reason'],{'executions':0,'heads':collections.Counter(),'functionTypeQueries':0,'bindingTypeReads':0,'boundCallType':0,'fullSignature':0});row['executions']+=1;row['heads'][e.get('operator')]+=1
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
   seen={};pairs=[]
   for e in ev:
    if e['kind']!=kind:continue
    key=e['operation'],e.get('expr');old=seen.get(key);seen[key]=e
    if old:
     a=old.get('context',{});b=e.get('context',{});changes=[k for k in ['scope','context','stack']if a.get(k)!=b.get(k)]+[k for k in ['_anyVersion','_typeVersion','_semanticVersion','_worldVersion','_callableVersion','_definitionVersion','_evaluationVersion','_factSuppressionDepth']if a.get('lifecycle',{}).get(k)!=b.get('lifecycle',{}).get(k)];pairs.append({'operator':e.get('operator'),'expr':e.get('expr'),'first':old['id'],'second':e['id'],'observedChanges':changes,'classification':'changed observation; unchanged-input equivalence unproved'if changes else'unknown: observed match incomplete'})
   repeats[kind]={'pairs':len(pairs),'changedObserved':sum(bool(v['observedChanges'])for v in pairs),'unknownObservedMatch':sum(not v['observedChanges']for v in pairs),'examples':pairs[:2]}
  timeline=[]
  if case=='notebook':
   for e in ev:
    if e['operation']==0 and e['kind']in['joinEvidenceOnBinding','writeEvidenceType','boundCallType','evidence-rejoin']:
     before=e.get('before')or{};after=e.get('after')or{};l=e.get('context',{}).get('lifecycle',{});al=e.get('contextAfter',{}).get('lifecycle',{});timeline.append({'event':e['id'],'kind':e['kind'],'expr':e.get('expr'),'operator':e.get('operator'),'binding':before.get('targetIdentity'),'name':before.get('name'),'assignedType':e.get('assignedType'),'proposed':e.get('proposed'),'before':{k:before.get(k)for k in['_type','_writeVersion','_assignmentEvidence','_value','_placeholderSkeleton','_signatureSkeleton']},'after':{k:after.get(k)for k in['_type','_writeVersion','_assignmentEvidence','_value','_placeholderSkeleton','_signatureSkeleton']},'versionsBefore':{k:l.get(k)for k in['_typeVersion','_anyVersion']},'versionsAfter':{k:al.get(k)for k in['_typeVersion','_anyVersion']},'result':e.get('result')})
  summary['traces'][case][arm]={'operations':3,'dropped':r['trace']['dropped'],'counts':counts,'reads':reads,'signatureDemandReasons':collections.Counter(e.get('reason')for e in ev if e['kind']=='signature-demand'),'boundHeads':collections.Counter(e.get('operator')for e in ev if e['kind']=='boundCallType'),'maps':maps,'evidencePasses':collections.Counter(str((e.get('pass'),e.get('coarse'),e.get('result')))for e in ev if e['kind']=='evidence-rejoin'),'repeats':repeats,'notebookTimeline':timeline}
(dest/'FINAL-SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n')
start=json.load(open(p/'identity-timing-start.json'));end=json.load(open(p/'identity-after-traces.json'));assert start['arms']==end['arms'];cert={'privateRoot':str(p),'sourceBuildDependencyUnchangedStartEnd':True,'startIdentitySha256':sha(p/'identity-timing-start.json'),'endIdentitySha256':sha(p/'identity-after-traces.json'),'runtime':{'node':'v26.13.0','v8':'14.6.202.34-node.40','platform':'darwin-arm64'},'arms':{},'instruments':{str(f):sha(f)for f in [Path('/Users/arno/dev/compute-engine/benchmarks/program-regression-child.mjs'),Path('/Users/arno/dev/compute-engine/benchmarks/program-type-work-instrument.mjs'),Path('/Users/arno/dev/compute-engine/benchmarks/program-type-work-trace.mjs'),p.parent/'child.mjs']}}
for arm,v in start['arms'].items():cert['arms'][arm]={'root':v['root'],'sourceManifestsSha256':{k:objsha(x)for k,x in v['source'].items()},'buildManifestSha256':objsha(v['build']),'configuration':v['configuration'],'dependencies':v['dependencies']}
(dest/'FINAL-IDENTITY.json').write_text(json.dumps(cert,indent=2)+'\n')
for n in ['status.json','trace-status.json','coverage.json','build-status.json','run.py','monitor.py','summarize.py']:shutil.copy2(p/n,dest/('three-arm-'+n))
for arm in ['guard','revision']:
 root=p.parent/f'{arm}-final-diagnostic/ce';manifest=root/'trace-instrumentation.json';shutil.copy2(manifest,dest/f'final-{arm}-INSTRUMENTATION.json');src=Path(start['arms'][arm]['root'])/'ce';diff=[]
 for item in json.load(open(manifest)):
  r=subprocess.run(['diff','-u','--label','a/src/'+item['file'],'--label','b/src/'+item['file'],str(src/'src'/item['file']),str(root/'src'/item['file'])],capture_output=True,text=True);assert r.returncode in[0,1];diff.append(r.stdout)
 (dest/f'final-{arm}-instrumentation.diff').write_text(''.join(diff))
shutil.copy2(p.parent/'causal-revision-source.json',dest/'causal-revision-source.json');shutil.copy2('/private/tmp/program-type-work-sol.patch',dest/'production-revision.patch')
raws={str(f.relative_to(p)):sha(f)for f in sorted(p.iterdir())if f.is_file()};(dest/'FINAL-RAW-HASHES.json').write_text(json.dumps(raws,indent=2)+'\n');print('Saved compact final summary',dest)
