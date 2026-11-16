from pathlib import Path
import hashlib,json,subprocess,sys,time
roots={'baseline':Path('/private/tmp/program-only-accepted-baseline-20261115'),'candidate':Path('/private/tmp/program-only-accepted-candidate-20261115')};work=Path('/tmp/wt-program-accepted-sol');out=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def files(root):return {str(p.relative_to(root)):sha(p) for p in sorted(root.rglob('*')) if p.is_file() and p.name!='.DS_Store'}
def deps(root,packages):
 result={}
 for name in packages:
  p=root/'node_modules'/name/'package.json';j=json.loads(p.read_text());result[name]={'version':j['version'],'sha256':sha(p),'realpath':str(p.resolve())}
 return result
result={'epochSeconds':time.time(),'node':subprocess.check_output(['node','-p','JSON.stringify({node:process.version,v8:process.versions.v8,arch:process.arch,platform:process.platform,execArgv:process.execArgv})'],text=True).strip(),'arms':{}}
for arm,root in roots.items():
 a={'root':str(root),'source':{},'build':{},'adapters':{},'dependencies':{}}
 for project in ['ce','tycho']:
  a['source'][project]=files(root/project/'src');a['dependencies'][project]=deps(root/project,['esbuild','tsx','typescript'] if project=='ce' else ['esbuild','tsx'])
 for name in ['ce-time.mjs','tycho-time.mts','heap.mjs']:a['adapters'][name]=sha(root/name)
 a['build']={'scripts':files(root/'ce/scripts'),'config':{f:sha(root/'ce'/f) for f in ['package.json','package-lock.json','tsconfig.json']},'bundles':files(root/'ce/dist')};result['arms'][arm]=a
result['finalWorktreeSource']=files(work/'src')
result['verification']={'CECandidateMatchesFinalWorktree':result['arms']['candidate']['source']['ce']==result['finalWorktreeSource'],'adapterIdentity':result['arms']['candidate']['adapters']==result['arms']['baseline']['adapters'],'dependenciesIdentity':result['arms']['candidate']['dependencies']==result['arms']['baseline']['dependencies']}
path=out/(sys.argv[1]+'.json');path.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'identity':str(path),'sha256':sha(path),'verification':result['verification']}))
