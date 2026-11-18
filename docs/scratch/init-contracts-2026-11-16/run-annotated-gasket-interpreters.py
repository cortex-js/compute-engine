"""Run serially under the coordinator's held lock, after the paired compiler probes."""
import json
import pathlib
import subprocess
import sys
import time
root = pathlib.Path(__file__).resolve().parent
loader = '/Users/arno/dev/compute-engine/node_modules/tsx/dist/loader.mjs'
fixture = '/private/tmp/ce-init-contracts-20261116/test/compute-engine/fixtures/epsil-gasket/a-user-functions.epsil'
arms = [
    ('original', '/private/tmp/program-only-accepted-baseline-20261115/ce'),
    ('control', '/private/tmp/ce-init-contracts-current-measurement-20261118/current/ce'),
    ('candidate', str(pathlib.Path.cwd())),
]
results = []
for label, engine in arms:
    command = ['node', '--import', loader, str(root / 'annotated-gasket-interpreter.mjs'), engine, fixture]
    began = time.monotonic()
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=30)
    except subprocess.TimeoutExpired:
        timed_out = True
        process.kill()
        stdout, stderr = process.communicate()
    entry = dict(arm=label,root=engine,command=command,wallCapSeconds=30,
                 timedOut=timed_out,processExitCode=process.returncode,
                 wallSeconds=time.monotonic()-began)
    try:
        entry['result'] = json.loads(stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        entry['stdout'] = stdout
    entry['stderr'] = stderr
    (root / f'annotated-gasket-interpreter-{label}.json').write_text(json.dumps(entry, indent=2)+'\n')
    results.append(entry)
    print(json.dumps({k:entry[k] for k in ['arm','timedOut','processExitCode','wallSeconds']}), flush=True)
(root / 'annotated-gasket-interpreters.json').write_text(json.dumps(results, indent=2)+'\n')
sys.exit(0 if all(not r['timedOut'] and r['processExitCode']==0 for r in results) else 1)
