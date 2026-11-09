import json,collections,hashlib,pathlib
p=pathlib.Path('/tmp/js-profile-next');rows=[json.loads(l) for l in (p/'coverage.jsonl').read_text().splitlines()]
def counts(items):return dict(collections.Counter(items).most_common())
summary={'calls':len(rows),'targets':counts(r['target'] for r in rows),'success':counts(str(r['success']) for r in rows),'classification':counts(r['classification'] for r in rows),'documents':{},'unknownReasons':counts(x.split(':')[0] for r in rows for x in r['unknown']),'outsideReasons':counts(x for r in rows for x in r['outside']),'functions':counts(f['name'] for r in rows for f in r['functions']),'functionBodies':len({f['bodyHash'] for r in rows for f in r['functions']}),'uniqueInputTrees':len({r['inputHash'] for r in rows}),'sha256':hashlib.sha256((p/'coverage.jsonl').read_bytes()).hexdigest()}
for doc in sorted({r['doc'] for r in rows}):
 rr=[r for r in rows if r['doc']==doc];summary['documents'][doc]={'calls':len(rr),'targets':counts(r['target'] for r in rr),'classification':counts(r['classification'] for r in rr),'resolvedFunctions':sorted({f['name'] for r in rr for f in r['functions']}),'heads':sorted({h for r in rr for h in r['heads']}),'unknown':counts(x for r in rr for x in r['unknown']),'effects':counts(x for r in rr for x in r['effects'])}
summary['captureAmbientMismatch']=sum(any(not s['ambientAgrees'] for s in r['symbols']) for r in rows)
summary['callsWithResolvedBody']=sum(bool(r['functions']) for r in rows)
summary['loopCalls']=sum(any(h in r['heads'] for h in ['Loop','ParallelLoop']) for r in rows)
(p/'coverage-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['documents','functions']},indent=2))
