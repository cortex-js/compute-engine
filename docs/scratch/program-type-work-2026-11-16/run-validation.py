import subprocess,pathlib,json,hashlib,time
repo=pathlib.Path('/Users/arno/dev/compute-engine'); wt=pathlib.Path('/tmp/wt-program-type-work-validation'); out=repo/'docs/scratch/program-type-work-2026-11-16'; rows=[]
files=['test/epsil/program.test.ts','test/epsil/check-epsil.test.ts','test/epsil/function-declaration-hoisting.test.ts','test/epsil/compiled-declared-function-type.test.ts','test/epsil/static-lambda-callee-arguments.test.ts','test/epsil/parameter-default-values.test.ts','test/epsil/nested-statement-diagnostics.test.ts','test/compute-engine/effects-read-from-literal-scope.test.ts','test/compute-engine/effects-seam.test.ts','test/compute-engine/tycho-item-336-nested-signature-derivation.test.ts','test/compute-engine/absent-cell-arithmetic-type.test.ts','test/compute-engine/absent-collection-operand.test.ts','test/compute-engine/absent-point-arithmetic.test.ts','test/compute-engine/point-union-arithmetic-type.test.ts','test/compute-engine/tycho-item-332-compiled-program-parity.test.ts','test/compute-engine/tycho-item-332-block-let-literal-type.test.ts','test/compute-engine/type-inference.test.ts','test/compute-engine/recursive-function-result-type.test.ts','test/compute-engine/ce-582-recursive-type-facts-hidden.test.ts']
for f in files:assert(repo/f).is_file(),f
def fp():
 r=subprocess.run(['find','src','test','-name','*.ts','-exec','stat','-f','%m %N','{}','+'],cwd=repo,capture_output=True,check=True).stdout
 return hashlib.sha256(b'\n'.join(sorted(r.splitlines()))).hexdigest()
start=fp()
for name,cmd,cwd,suites in [('typecheck-isolated',['npm','run','typecheck'],wt,False),('targeted',['node_modules/.bin/jest','-w','4','--watchman=false','--runTestsByPath',*files],repo,True),('core',['npm','run','test:core','--','--watchman=false'],repo,True),('full-isolated',['npm','test'],wt,True)]:
 subprocess.run(['node','/Users/arno/.claude/scripts/box-lock.mjs','check','codex-program-type-work:three-arm'],check=True,capture_output=True)
 with(out/(name+'.txt')).open('w')as log:r=subprocess.run(cmd,cwd=cwd,stdout=log,stderr=subprocess.STDOUT)
 text=(out/(name+'.txt')).read_text(); valid=not suites or 'Test Suites:' in text
 rows.append({'name':name,'command':cmd,'cwd':str(cwd),'exitCode':r.returncode,'validRun':valid,'tail':text.splitlines()[-9:]})
 (out/'validation.json').write_text(json.dumps({'mainBefore':start,'mainAfter':fp(),'untorn':start==fp(),'checks':rows},indent=2)+'\n');print(name,r.returncode,valid,flush=True)
 if r.returncode or not valid:raise SystemExit(1)
