import assert from 'node:assert/strict';

export const unsupported = (reason, location) => ({ status: 'unsupported', reason, location });

export function engineFactory(ComputeEngine, settings, route) {
  return () => {
    const ce = new ComputeEngine();
    // Old releases without a jit switch must not acquire a meaningless property.
    if ('jit' in ce) ce.jit = settings.jit;
    ce.precision = settings.precision;
    if (route) {
      for (const name of ['_compile', 'compile']) {
        if (typeof ce[name] !== 'function') continue;
        const original = ce[name];
        route.hooks.add(name);
        ce[name] = function (...args) {
          route.calls[name] = (route.calls[name] ?? 0) + 1;
          return original.apply(this, args);
        };
      }
      route.jitSwitch = 'jit' in ce;
      route.observedJit = ce.jit ?? null;
    }
    return ce;
  };
}

// This adapter deliberately has no production-API approximation of a batch.
export function baselineContract(fixture) {
  return unsupported(fixture.baseline, fixture.id);
}

// A future adapter supplies observations for every step and every invariant.
// Missing observations fail; a ready result cannot silently skip an entry.
export async function checkContract(adapter, fixture) {
  const result = await adapter(fixture);
  if (result.status === 'unsupported') return result;
  assert.equal(result.status, 'ready');
  for (const step of fixture.steps) assert.deepEqual(result.steps[step.id], step.expect, `${fixture.id}/${step.id}`);
  assert.deepEqual(result.invariants, fixture.invariants, `${fixture.id}/invariants`);
  return { status: 'ready', fixture: fixture.id, checkedSteps: fixture.steps.length };
}

export function numericControl(result, expected, exact = false) {
  assert(result?.isValid, 'Invalid mathematical control');
  assert.equal(result.isCollection, false);
  assert.equal(result.im ?? 0, 0);
  assert(Number.isFinite(result.re));
  assert(Math.abs(result.re - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${result.re} != ${expected}`);
  if (exact) assert.equal(result.isExact, true);
}

export function syntheticDocument(size = 64, revision = 0) {
  const prelude = [
    ['scale', ['Function', ['Multiply', 2 + revision % 2, 't'], 't']],
    ['shift', ['Function', ['Add', 't', 1], 't']],
    ['square', ['Function', ['Power', 't', 2], 't']],
    ['combine', ['Function', ['Add', ['scale', 't'], ['shift', 't']], 't']],
  ];
  const entries = Array.from({ length: size }, (_, i) => [
    `cell${i}`, ['Add', ['combine', 'a'], i],
  ]);
  return { prelude, entries, revision };
}

export function setupWorkload(makeEngine, workload, settings) {
  if (workload.unavailable) return unsupported(workload.unavailable, workload.id);
  const ce = makeEngine();
  const api = workload.boxApi ?? settings.boxApi;
  if (typeof ce[api] !== 'function') return unsupported(`Required API ce.${api} is absent; no substitution`, workload.id);
  const box = (value) => ce[api](value);
  const scalar = ['Add', ['Multiply', 'a', 'b'], 'c'];
  let a = 2;
  let serial = 0;
  for (const [name, value] of [['a', 2], ['b', 3], ['c', 5], ['z', 0]]) {
    ce.declare(name, 'real');
    ce.assign(name, value);
  }
  let build;
  let check;
  let current;
  let editSerial = 0;
  const document = (revision) => {
    // A fresh engine is the baseline host's explicit full-rebuild strategy.
    // This is not an implementation of immutable batch preparation.
    const engine = makeEngine();
    const inputType = workload.kind === 'edit-type' && revision % 2 ? 'integer' : 'real';
    engine.declare('a', inputType);
    engine.assign('a', a);
    const source = syntheticDocument(settings.documentSize, revision);
    for (const [name, value] of source.prelude) engine.assign(name, engine[api](value));
    const entries = source.entries.map(([, value]) => engine[api](value));
    // A refused revision-dependent value is recreated from source, not migrated.
    const closure = engine[api](['Function', ['Add', 't', 'a'], 't']).evaluate();
    engine.assign('saved', closure);
    return { engine, entries, closure, revision, inputType };
  };
  switch (workload.kind) {
    case 'scalar':
      build = () => box(scalar);
      check = (r) => numericControl(r, a * 3 + 5, workload.method === 'evaluate');
      break;
    case 'dag':
      build = () => {
        let r = box(scalar);
        for (let i = 0; i < settings.dagDepth; i++) r = ce.function('Max', [r, r]);
        return r;
      };
      check = (r) => numericControl(r, a * 3 + 5, workload.method === 'evaluate');
      break;
    case 'function':
      build = () => {
        ce.assign('f', box(['Function', ['Add', ['Multiply', 'x', 'y'], 'w'], 'x', 'y', 'w']));
        return box(['f', 'a', 'b', 'c']);
      };
      check = (r) => numericControl(r, a * 3 + 5, workload.method === 'evaluate');
      break;
    case 'closure':
      build = () => {
        ce.assign('make', box(['Function', ['Function', ['Add', 't', 'd'], 't'], 'd']));
        ce.assign('closed', box(['make', 7]).evaluate());
        return box(['closed', 'a']);
      };
      check = (r) => numericControl(r, a + 7, workload.method === 'evaluate');
      break;
    case 'binder':
      build = () => box(['Sum', ['Power', 'k', 2], ['Tuple', 'k', 1, 3]]);
      check = (r) => numericControl(r, 14, true);
      break;
    case 'document':
    case 'edit-body':
    case 'edit-type':
      build = () => {
        current = document(editSerial++);
        return current;
      };
      check = (unit) => {
        const scale = 2 + unit.revision % 2;
        numericControl(unit.entries.at(-1).evaluate(), (scale + 1) * a + settings.documentSize, true);
        numericControl(unit.engine[api](['saved', 3]).evaluate(), a + 3, true);
        if (workload.kind === 'edit-type') assert.equal(unit.inputType, unit.revision % 2 ? 'integer' : 'real');
      };
      break;
    case 'ce1210': {
      const input = workload.input;
      const source = input.op === 'diff' ? ['D', input.mathjson, input.var]
        : input.op === 'integrate' ? ['Integrate', input.mathjson, ['Tuple', input.var]] : input.mathjson;
      build = () => box(source);
      check = (r) => checkCase(ce, r, workload.verify);
      break;
    }
    default: throw new Error(`Unknown workload kind ${workload.kind}`);
  }
  let expression;
  const prepare = () => build();
  const initialize = () => { expression = prepare(); };
  const execute = (value = expression) => workload.kind === 'document' || workload.kind.startsWith('edit-')
    ? value.entries.at(-1).evaluate() : value[workload.method ?? 'evaluate']();
  const write = () => {
    const value = 4 + serial++;
    if (workload.mutation === 'relevant') { a = value; ce.assign('a', a); }
    if (workload.mutation === 'unrelated') ce.assign('z', value);
    return value;
  };
  const operation = () => {
    if (workload.kind.startsWith('edit-')) return prepare();
    if (workload.phase === 'box') return prepare();
    if (workload.phase === 'prepare-first') return execute(prepare());
    if (workload.phase === 'box-evaluate') return execute(prepare());
    if (workload.phase === 'value-edit') { write(); return execute(); }
    return execute();
  };
  const validate = (result) => {
    if (workload.kind.startsWith('edit-') || workload.phase === 'box') {
      if (workload.kind === 'document' || workload.kind.startsWith('edit-')) check(result);
      else check(execute(result));
    } else if (workload.kind === 'document') numericControl(result, (2 + current.revision % 2 + 1) * a + settings.documentSize, true);
    else check(result);
  };
  return {
    status: 'ready', ce, initialize, prepare, execute, write, operation, validate,
    release: () => { current = null; expression = null; },
    includesWrite: workload.phase === 'value-edit',
    staticAnalysis: 'Production canonical boxing and any lazy analysis in evaluation; no batch prepare API',
    api: `ce.${api}`, documentStrategy: workload.kind.includes('edit') || workload.kind === 'document'
      ? 'synthetic fresh-engine rebuild including all four prelude definitions, numeric value transfer and closure recreation; no real Tycho document' : null,
  };
}

function checkCase(ce, result, verify) {
  assert(result?.isValid);
  if (verify.kind === 'unevaluated') {
    assert.deepEqual(result.json, verify.expected);
    return;
  }
  if (verify.kind === 'value') return numericControl(result.N(), Number(verify.value));
  const at = (point) => result.subs({ [verify.var]: ce.number(Number(point)) }).N();
  if (verify.kind === 'sample') {
    verify.points.forEach((point, i) => numericControl(at(point), Number(verify.values[i])));
    return;
  }
  assert.equal(verify.kind, 'diff');
  numericControl(at(verify.b).sub(at(verify.a)).N(), Number(verify.value));
}

export function baselineControl(makeEngine, control, arm) {
  if (control.unavailable) return unsupported(control.unavailable, control.id);
  if (control.requiresFeature && !arm.features?.includes(control.requiresFeature))
    return unsupported(`Feature ${control.requiresFeature} not certified for this arm; set arms[].features after API inspection`, control.id);
  const ce = makeEngine();
  const number = (expression) => {
    const value = ce.box(expression).evaluate();
    assert(value.isValid);
    return value.json;
  };
  let value;
  switch (control.kind) {
    case 'writes': {
      ce.declare('x', 'real');
      const expression = ce.box(['Add', 'x', 1]);
      value = [2,4,6].map((x) => { ce.assign('x', x); return expression.evaluate().json; });
      break;
    }
    case 'forward': {
      value = [false,true].map((reverse) => {
        const engine = makeEngine();
        const definitions = [['f', ['Function', ['Add', ['g','x'],1], 'x']], ['g', ['Function', ['Multiply',2,'x'],'x']]];
        for (const [name, body] of reverse ? definitions.reverse() : definitions) engine.assign(name, engine.box(body));
        return engine.box(['f',3]).evaluate().json;
      });
      break;
    }
    case 'independent-rebuild': {
      const build = (scale) => {
        const engine = makeEngine();
        engine.assign('g', engine.box(['Function',['Multiply',scale,'x'],'x']));
        engine.assign('f', engine.box(['Function',['Add',['g','x'],1],'x']));
        return () => engine.box(['f',3]).evaluate().json;
      };
      const old = build(2), fresh = build(3);
      value = [old(),fresh(),old()];
      break;
    }
    case 'independent-types': {
      const other = makeEngine();
      ce.declare('free','real'); ce.assign('free',2);
      other.declare('free','boolean'); other.assign('free',true);
      value = [number(['Add','free',1]),other.box(['Not','free']).evaluate().json];
      break;
    }
    case 'external-handler': {
      const declare = (scale) => ce.declare('Foo', { signature:'(real) -> real', evaluate: (ops) => ce.number(scale * ops[0].re) });
      declare(2); const first = number(['Foo',3]);
      ce.undeclare('Foo');
      declare(3); value = [first,number(['Foo',3])];
      break;
    }
    case 'literal-recreate': {
      const source = ce.box(['List',1,2,3]);
      const other = makeEngine();
      value = other.box(JSON.parse(JSON.stringify(source.json))).evaluate().json;
      break;
    }
    case 'callable-reassign': {
      // An explicit variable holds the callable; a named definition is different.
      ce.declare('h','(real) -> real');
      ce.assign('h',ce.box(['Function',['Add','x',1],'x']));
      ce.assign('reader',ce.box(['Function',['h','x'],'x']));
      const call = ce.box(['reader',3]);
      const first = call.evaluate().json;
      ce.assign('h',ce.box(['Function',['Multiply',2,'x'],'x']));
      value = [first,call.evaluate().json];
      break;
    }
    case 'closure': {
      ce.assign('make',ce.box(['Function',['Function',['Add','d','x'],'x'],'d']));
      ce.assign('a',ce.box(['make',7]).evaluate());
      ce.assign('b',ce.box(['make',10]).evaluate());
      value = [number(['a',1]),number(['b',1]),number(['a',2])];
      break;
    }
    case 'fact-free-numeric': value = number(['Sqrt',['Power',-3,2]]); break;
    case 'mapping': value = number(['Apply',['Function',['Multiply',2,'x'],'x'],['List',1,2,3]]); break;
    case 'overload': {
      ce.declare('f','((integer, string) -> integer) & ((list<integer>, integer) -> integer)');
      const call = ce.box(['f','y',{str:'a'}]);
      assert(call.isValid);
      value = call.ops[0].type.toString();
      break;
    }
    case 'compile-inputs': {
      if (typeof ce._compile !== 'function') return unsupported('No ce._compile API; no alternate compile API substitution', control.id);
      ce.declare('a','real'); ce.declare('t','real');
      const compiled = ce._compile(ce.box(['Multiply','a','t']), { to:'javascript', fallback:false });
      if (compiled.success === false || typeof compiled.run !== 'function') return unsupported('Explicit compile result has no successful run API',control.id);
      value = [compiled.run({a:2,t:3}),compiled.run({a:4,t:3})];
      break;
    }
    case 'macro': {
      ce.declare('A',{macro:['Add','x',1]});
      ce.assign('f',ce.box(['Function','A','x']));
      value = number(['f',3]); break;
    }
    case 'binder': {
      const raw = ce.box(['Sum',['Power','k',2],['Tuple','k',1,3]]).evaluate().json;
      const body = ce.box(['Power','k',2]);
      value = [raw,ce.function('Sum',[body,ce.box(['Tuple','k',1,3])]).evaluate().json];
      break;
    }
    default: throw new Error(`Unknown baseline control ${control.kind}`);
  }
  assert.deepEqual(value,control.expected,control.id);
  return { status:'ready', value, difference:control.difference, fixtures:control.fixtures };
}
