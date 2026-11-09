import json,collections,re,hashlib
from pathlib import Path
root=Path('/tmp/js-profile-audit-results');rs=[json.loads(s) for s in (root/'typed-records.jsonl').read_text().splitlines()]; d=json.loads((root/'core-full.json').read_text())
families={
'arithmetic':set('Add Multiply Divide Power Negate Abs Sign Mod Floor Ceil Round Sqrt'.split()),
'elementary_functions':set('Sin Cos Tan Cot Sec Csc Tanh Ln Log Exp Arctan2'.split()),
'comparison_boolean':set('Equal NotEqual Less LessEqual Greater GreaterEqual And Or Not'.split()),
'selection':set('If Which When'.split()),
'block_binding_assignment':set('Block Declare Assign'.split()),
'explicit_loops_exits':set('Loop ParallelLoop Break Continue Return'.split()),
'collection_operations':set('At List PointList Comprehension Range Sum Product Length ListJoin ReplaceAt Map Filter Reduce Scan'.split()),
'collection_consumers':set('At Comprehension Sum Product Length ListJoin ReplaceAt Map Filter Reduce Scan'.split()),
'numeric_tuple':{'Tuple','PointX','PointY','PointZ'},
'color':set('AsOklab Rgb Oklch Color'.split()),
'special_numeric':set('Mandelbrot BesselJ GCD'.split()),
'dictionary_or_string_nodes':{'Dictionary','String'},
}
builtin=set.union(*families.values())|set('Integer Real Rational Symbol Complex NaN Element Limits ElementMin ElementMax Max Min'.split())
def heads(r):return {h.split(' :: ',1)[0] for h in r['headTypes']}
def group(t):
 for p in ['tuple','list','vector','matrix','tensor','function','dictionary']:
  if t==p or t.startswith(p+'<') or t.startswith(p+'('):return p
 if t=='color':return 'color'
 if t in ['boolean','true','false']:return 'boolean'
 if t in ['unknown','any','error','nothing','missing']:return t
 if re.fullmatch(r'[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?',t):return 'numeric scalar literal'
 if re.match(r'^(?:real|integer|rational|number|complex|imaginary|nan|infinity|signed_infinity|missing)(?:<| |$)',t):return 'numeric scalar or absence union'
 return 'other'
out={'capture':{'sha256':hashlib.sha256((root/'typed-records.jsonl').read_bytes()).hexdigest(),'calls':len(rs),'truncated':sum(r['truncated'] for r in rs),'runMetadata':{k:d[k] for k in ['generatedAt','computeEngine','tychoCommit','desmosScope']}},'families':{k:sorted(v) for k,v in families.items()},'targets':{}}
for t in sorted({r['target'] for r in rs}):
 rr=[r for r in rs if r['target']==t];dd=[r for r in d['records'] if r['target']==t];hc=collections.Counter(h for r in rr for h in heads(r)); nodec=collections.Counter()
 for r in rr:
  for ht,n in r['headTypes'].items():nodec[ht.split(' :: ',1)[0]]+=n
 out['targets'][t]={'calls':len(rr),'modes':dict(collections.Counter(r['mode'] for r in rr)),'auditRecords':len(dd),'successRecords':sum(r['success'] for r in dd),'failureRecords':sum(not r['success'] for r in dd),'auditOccurrences':sum(r.get('occurrences',1) for r in dd),'successOccurrences':sum(r.get('occurrences',1) for r in dd if r['success']),'failureOccurrences':sum(r.get('occurrences',1) for r in dd if not r['success']),'resultGroups':dict(collections.Counter(group(r['resultType']) for r in rr)),'resultTypes':dict(collections.Counter(r['resultType'] for r in rr)),'familyCalls':{k:sum(bool(heads(r)&v) for r in rr) for k,v in families.items()},'headCalls':dict(hc.most_common()),'uniqueNodeOccurrences':dict(nodec.most_common()),'noncatalogueCallCandidates':sum(bool(heads(r)-builtin) for r in rr),'noncatalogueHeads':sorted(set.union(*(heads(r)-builtin for r in rr))),'tychoCertificateCalls':sum(any(h.startswith('TychoCertificate') for h in heads(r)) for r in rr),'unknownSymbolCalls':sum(any(i['type'] in ['unknown','any'] for i in r['unknownSymbolTypes']) for r in rr),'unknownSymbolExamples':[{'doc':r['doc'],'row':r['row'],'symbols':[i for i in r['unknownSymbolTypes'] if i['type'] in ['unknown','any']]} for r in rr if any(i['type'] in ['unknown','any'] for i in r['unknownSymbolTypes'])],'preludeCalls':sum(r['row']=='(prelude)' for r in rr),'distinctObservedRows':len({(r['corpus'],r['doc'],r['row']) for r in rr})}
for v in out['targets'].values():
 v['topResultTypes']=dict(sorted(v.pop('resultTypes').items(),key=lambda x:-x[1])[:15]); v['uniqueNodeTotal']=sum(v['uniqueNodeOccurrences'].values()); v['realNodeOccurrences']=v['uniqueNodeOccurrences'].get('Real',0); del v['uniqueNodeOccurrences']; v['topHeadCalls']=dict(list(v.pop('headCalls').items())[:30])
(root/'live-census.json').write_text(json.dumps(out,indent=2)+'\n')
for t,v in out['targets'].items():
 print(t,{k:v[k] for k in ['calls','successRecords','failureRecords','successOccurrences','failureOccurrences','resultGroups','familyCalls','noncatalogueCallCandidates','tychoCertificateCalls','unknownSymbolCalls','preludeCalls']});print('heads',list(v['topHeadCalls'].items())[:30])
