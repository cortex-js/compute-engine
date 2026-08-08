// End-to-end tests for the Epsil debug adapter, driven over stdio DAP —
// the same wire protocol VS Code speaks. Run with `npm test` (which builds
// first); each scenario spawns a fresh adapter process.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { DapClient } from './dap-client.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => join(FIXTURES, name);

let failures = 0;
let current = '';
function check(label, ok, detail) {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}: [${current}] ${label}${ok ? '' : ` — ${detail}`}`
  );
  if (!ok) failures += 1;
}

async function scenario(name, body) {
  current = name;
  const client = new DapClient();
  try {
    await body(client);
  } catch (error) {
    check('scenario completed', false, error.message);
  } finally {
    client.kill();
  }
}

// ── S1: basics — breakpoints, variables, watch, hover, step, output ──────
await scenario('basics', async (c) => {
  const init = await c.start(fixture('sample.epsil'));
  check(
    'capabilities',
    init.body.supportsConfigurationDoneRequest === true &&
      init.body.supportsConditionalBreakpoints === true &&
      init.body.supportsLogPoints === true &&
      init.body.supportsRestartRequest === true &&
      init.body.exceptionBreakpointFilters?.[0]?.filter === 'error-values',
    JSON.stringify(init.body)
  );

  const bp = await c.send('setBreakpoints', {
    source: { path: fixture('sample.epsil') },
    breakpoints: [{ line: 4 }, { line: 99 }],
  });
  check(
    'bp on line 4 verified, line 99 rejected',
    bp.body.breakpoints[0].verified === true &&
      bp.body.breakpoints[0].line === 4 &&
      bp.body.breakpoints[1].verified === false,
    JSON.stringify(bp.body)
  );

  await c.send('configurationDone');
  const stopped = await c.waitEvent('stopped');
  check('stopped at breakpoint', stopped.body.reason === 'breakpoint');
  check('at line 4', (await c.frames())[0] === 'top level@4');

  const vars = await c.variables();
  check('x = 30', vars.x?.value === '30', JSON.stringify(vars.x));
  check('y = 5 with type', vars.y?.value === '5' && vars.y?.type === 'integer', JSON.stringify(vars.y));
  check('z not yet declared', vars.z === undefined);
  const locals = await c.scopeVariables('Locals');
  check('locals empty at top level', Object.keys(locals).length === 0, JSON.stringify(locals));

  const evalResp = await c.send('evaluate', { expression: 'x + 100', context: 'repl' });
  check('evaluate x + 100 = 130', evalResp.body?.result === '130', JSON.stringify(evalResp.body));
  const hover = await c.send('evaluate', { expression: 'x', context: 'hover' });
  check('hover x = 30', hover.success && hover.body.result === '30');
  const hoverCall = await c.send('evaluate', { expression: 'Random(1,10)', context: 'hover' });
  check('hover on a call declined', hoverCall.success === false);

  await c.send('next', { threadId: 1 });
  const stepStop = await c.waitEvent('stopped');
  check('step stops', stepStop.body.reason === 'step');
  const vars2 = await c.variables();
  check('z = [35, 2, 3] after step', vars2.z?.value === '[35, 2, 3]', JSON.stringify(vars2.z));
  check('z expandable', (vars2.z?.variablesReference ?? 0) > 0);
  if (vars2.z?.variablesReference) {
    const kids = await c.send('variables', { variablesReference: vars2.z.variablesReference });
    check(
      'z children 1-based',
      kids.body.variables[0]?.name === '[1]' && kids.body.variables[0]?.value === '35',
      JSON.stringify(kids.body.variables)
    );
  }

  await c.send('continue', { threadId: 1 });
  await c.waitEvent('terminated');
  const final = c.outputs.find((o) => o.category === 'stdout');
  check('program result 36 printed', final?.output.trim() === '36', JSON.stringify(c.outputs));
});

// ── S2: parse error stops launch; stopOnEntry; statement time limit ──────
await scenario('parse error', async (c) => {
  await c.send('initialize', { adapterID: 'epsil', pathFormat: 'path', linesStartAt1: true });
  const launch = c.send('launch', { program: fixture('bad.epsil') });
  await c.waitEvent('terminated');
  await launch;
  check('terminated without running', true);
  check(
    'diagnostics on stderr',
    c.outputs.some((o) => o.category === 'stderr' && /error/i.test(o.output))
  );
});

await scenario('stopOnEntry', async (c) => {
  await c.start(fixture('sample.epsil'), { stopOnEntry: true });
  await c.send('configurationDone');
  const stopped = await c.waitEvent('stopped');
  check('entry stop', stopped.body.reason === 'entry');
  check('at line 1', (await c.frames())[0] === 'top level@1');
  await c.send('continue', { threadId: 1 });
  await c.waitEvent('terminated');
});

await scenario('time limit', async (c) => {
  await c.start(fixture('loop.epsil'), { statementTimeLimit: 500 });
  await c.send('configurationDone');
  await c.waitEvent('terminated');
  check(
    'cancellation reported on line 2',
    c.outputs.some((o) => o.category === 'stderr' && o.line === 2),
    JSON.stringify(c.outputs)
  );
});

// ── S3: body breakpoints, locals, stepping inside a body ─────────────────
await scenario('body breakpoints', async (c) => {
  await c.start(fixture('body-bp.epsil'));
  const bp = await c.send('setBreakpoints', {
    source: { path: fixture('body-bp.epsil') },
    breakpoints: [{ line: 2 }, { line: 7 }],
  });
  check(
    'body lines verified in place',
    bp.body.breakpoints[0].line === 2 && bp.body.breakpoints[1].line === 7,
    JSON.stringify(bp.body)
  );
  await c.send('configurationDone');

  // Loop body: stops each iteration with the loop variable advancing.
  for (const expected of ['0', '1', '2']) {
    const stopped = await c.waitEvent('stopped');
    check(`loop stop, x = ${expected}`, stopped.body.reason === 'breakpoint');
    const vars = await c.variables();
    check(`x is ${expected}`, vars.x?.value === expected, JSON.stringify(vars.x));
    if (expected === '1') {
      const watch = await c.send('evaluate', { expression: 'x * 100', context: 'watch' });
      check('watch mid-loop', watch.body?.result === '100');
    }
    await c.send('continue', { threadId: 1 });
  }

  // Function body: parameter in Locals; step reveals the local.
  const fnStop = await c.waitEvent('stopped');
  check('function body stop', fnStop.body.reason === 'breakpoint');
  check('frame double@2', (await c.frames())[0] === 'double@2');
  const locals = await c.scopeVariables('Locals');
  check('param n = 3 in Locals', locals.n?.value === '3', JSON.stringify(locals));
  await c.send('next', { threadId: 1 });
  await c.waitEvent('stopped');
  const locals2 = await c.scopeVariables('Locals');
  check('local a = 6 after step', locals2.a?.value === '6', JSON.stringify(locals2));
  await c.send('stepOut', { threadId: 1 });
  await c.waitEvent('terminated');
  check('result 7', c.outputs.some((o) => o.category === 'stdout' && o.output.trim() === '7'));
});

// ── S4: call stack — names, one frame per activation, recursion ──────────
await scenario('call stack', async (c) => {
  await c.start(fixture('frames.epsil'));
  await c.send('setBreakpoints', {
    source: { path: fixture('frames.epsil') },
    breakpoints: [{ line: 6 }, { line: 10 }],
  });
  await c.send('configurationDone');

  await c.waitEvent('stopped');
  check(
    'outer→inner chain',
    JSON.stringify(await c.frames()) ===
      JSON.stringify(['inner@6', 'outer@2', 'top level@13']),
    JSON.stringify(await c.frames())
  );
  await c.send('continue', { threadId: 1 });

  await c.waitEvent('stopped');
  check(
    'fact first activation',
    JSON.stringify(await c.frames()) ===
      JSON.stringify(['fact@10', 'inner@7', 'outer@2', 'top level@13'])
  );
  const locals = await c.scopeVariables('Locals');
  check('fact locals n = 2', locals.n?.value === '2', JSON.stringify(locals));
  await c.send('continue', { threadId: 1 });

  await c.waitEvent('stopped');
  const frames = await c.frames();
  check('direct recursion: two fact frames', frames.filter((f) => f.startsWith('fact@')).length === 2, JSON.stringify(frames));
  check('recursive call site line 11', frames[1] === 'fact@11');
  await c.send('continue', { threadId: 1 });
  await c.waitEvent('terminated');
});

// ── S5: conditional breakpoints ──────────────────────────────────────────
await scenario('conditional breakpoint', async (c) => {
  await c.start(fixture('features-loop.epsil'));
  await c.send('setBreakpoints', {
    source: { path: fixture('features-loop.epsil') },
    breakpoints: [{ line: 3, condition: 'x == 3' }],
  });
  await c.send('configurationDone');
  const stopped = await c.waitEvent('stopped');
  check('stops when condition holds', stopped.body.reason === 'breakpoint');
  const vars = await c.variables();
  check('x = 3 at the conditional stop', vars.x?.value === '3', JSON.stringify(vars.x));
  await c.send('continue', { threadId: 1 });
  await c.waitEvent('terminated');
  check('only one stop (condition true once)', true);
});

// ── S6: logpoints ────────────────────────────────────────────────────────
await scenario('logpoint', async (c) => {
  await c.start(fixture('features-loop.epsil'));
  await c.send('setBreakpoints', {
    source: { path: fixture('features-loop.epsil') },
    breakpoints: [{ line: 3, logMessage: 'x is {x}' }],
  });
  await c.send('configurationDone');
  await c.waitEvent('terminated');
  const logs = c.outputs.filter((o) => o.category === 'console' && o.output.startsWith('x is '));
  check(
    'five log messages, never stopped',
    logs.length === 5 && logs[0].output.trim() === 'x is 0' && logs[4].output.trim() === 'x is 4',
    JSON.stringify(logs)
  );
});

// ── S7: break on error values ────────────────────────────────────────────
// (The statement-level hook inside bodies is pinned at the engine level in
// test/compute-engine/debug-hook.test.ts; Epsil catches most body errors
// statically, so the deterministic end-to-end shape is a top-level error.)
await scenario('error values filter', async (c) => {
  await c.start(fixture('features-error.epsil'));
  await c.send('setExceptionBreakpoints', { filters: ['error-values'] });
  await c.send('configurationDone');
  const stopped = await c.waitEvent('stopped');
  check('exception stop', stopped.body.reason === 'exception', JSON.stringify(stopped.body));
  check('at the erroring statement', (await c.frames())[0] === 'top level@2', JSON.stringify(await c.frames()));
  await c.send('continue', { threadId: 1 });
  await c.waitEvent('terminated');
});

await scenario('no error stop when filter off', async (c) => {
  await c.start(fixture('features-error.epsil'));
  await c.send('configurationDone');
  await c.waitEvent('terminated');
  check('ran through without stopping', true);
});

// ── S8: restart ──────────────────────────────────────────────────────────
await scenario('restart', async (c) => {
  await c.start(fixture('sample.epsil'));
  await c.send('setBreakpoints', {
    source: { path: fixture('sample.epsil') },
    breakpoints: [{ line: 4 }],
  });
  await c.send('configurationDone');
  await c.waitEvent('stopped');
  await c.send('restart');
  const stopped = await c.waitEvent('stopped');
  check('stopped again after restart (bps re-applied)', stopped.body.reason === 'breakpoint');
  const vars = await c.variables();
  check('fresh session state, x = 30', vars.x?.value === '30', JSON.stringify(vars.x));
  await c.send('continue', { threadId: 1 });
  await c.waitEvent('terminated');
});

// ── S9: anonymous lambda named from its let-binding ──────────────────────
await scenario('lambda frame name', async (c) => {
  await c.start(fixture('features-lambda.epsil'));
  await c.send('setBreakpoints', {
    source: { path: fixture('features-lambda.epsil') },
    breakpoints: [{ line: 1 }],
  });
  await c.send('configurationDone');
  // First stop: the top-level `let` statement itself.
  await c.waitEvent('stopped');
  check('first stop at top level', (await c.frames())[0] === 'top level@1');
  await c.send('continue', { threadId: 1 });
  // Second stop: the lambda BODY (same line) when `sq(4)` runs.
  await c.waitEvent('stopped');
  check('lambda frame named sq', (await c.frames())[0] === 'sq@1', JSON.stringify(await c.frames()));
  const locals = await c.scopeVariables('Locals');
  check('lambda param n = 4', locals.n?.value === '4', JSON.stringify(locals));
  await c.send('continue', { threadId: 1 });
  await c.waitEvent('terminated');
});

// ── S10: inline runner ───────────────────────────────────────────────────
current = 'inline runner';
try {
  const out = execFileSync(
    'node',
    [
      join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'inline-runner.js'),
      fixture('frames.epsil'),
      '5000',
    ],
    { encoding: 'utf8' }
  );
  const records = out.trim().split('\n').map((l) => JSON.parse(l));
  check('one record per top-level statement', records.length === 4, out);
  check(
    'function statements valueless',
    records.slice(0, 3).every((r) => r.value === undefined)
  );
  check(
    'final value 43 at line 13',
    records[3].line === 13 && records[3].value === '43',
    JSON.stringify(records[3])
  );
} catch (error) {
  check('inline runner ran', false, error.message);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
