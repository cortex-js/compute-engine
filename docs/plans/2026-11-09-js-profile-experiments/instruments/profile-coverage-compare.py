import json,hashlib,pathlib
p=pathlib.Path('/tmp/js-profile-next')
a=json.loads((p/'initial-coverage-full.json').read_text())
b=json.loads((p/'coverage-full.json').read_text())
def strip(x):return {k:v for k,v in x.items() if k not in ['durationMs','maxDurationMs','id']}
assert list(map(strip,a['records']))==list(map(strip,b['records']))
(p/'coverage-equivalence.json').write_text(json.dumps({'equal':True,'records':len(a['records']),'excluded':['durationMs','maxDurationMs','id'],'sha256Normalized':hashlib.sha256(json.dumps(list(map(strip,b['records'])),sort_keys=True).encode()).hexdigest()},indent=2)+'\n')
previous=p/'before-review-coverage-full.json'
if previous.exists():
 c=json.loads(previous.read_text())
 assert list(map(strip,c['records']))==list(map(strip,b['records']))
 (p/'coverage-review-equivalence.json').write_text(json.dumps({'equal':True,'records':len(c['records']),'excluded':['durationMs','maxDurationMs','id']},indent=2)+'\n')
