// Bounded measurement adapter; all arithmetic is executed by the imported CE.
import assert from 'node:assert/strict';
import { numericControl, unsupported } from './stable-batch/adapter.mjs';

export const phase1Workloads = ['scalar', 'function'].flatMap((kind) => [
  { id: `${kind}/prepare`, kind, phase: 'box', method: 'evaluate', mutation: 'unchanged' },
  { id: `${kind}/prepare-first`, kind, phase: 'prepare-first', method: 'evaluate', mutation: 'unchanged' },
  ...['evaluate', 'N'].flatMap((method) => ['unchanged', 'relevant', 'unrelated'].map((mutation) => ({
    id: `${kind}/${method}/${mutation}`, kind, phase: 'warm', method, mutation,
  }))),
]);

export function selectPhase1Workloads(only) {
  if (only === undefined) return phase1Workloads;
  assert(Array.isArray(only) && only.length > 0, 'Nonempty workload selector required');
  assert.equal(new Set(only).size, only.length, 'Duplicate workload selector');
  return only.map((id) => {
    const workload = phase1Workloads.find((entry) => entry.id === id);
    assert(workload, `Unknown phase1 workload ${id}; closure, DAG, host and phase2 timings unsupported`);
    return workload;
  });
}

export function entriesFor(kind, size = 64, revision = 0) {
  const slot = (name, initializer) => ({ kind: 'slot', name, type: 'real', initializer });
  const expression = (name, body) => ({ kind: 'expression', name, body });
  const definition = (name, parameters, body) => ({ kind: 'definition', name,
    parameters: parameters.map((name) => ({ name, type: 'real' })), resultType: 'real', body });
  const slots = [slot('a', 2), slot('b', 3), slot('c', 5), slot('z', 0)];
  const scalar = ['Add', ['Multiply', 'a', 'b'], 'c'];
  if (kind === 'scalar') return [...slots, expression('result', scalar)];
  if (kind === 'function') return [...slots,
    definition('f', ['x', 'y', 'w'], ['Add', ['Multiply', 'x', 'y'], 'w']),
    expression('result', ['f', 'a', 'b', 'c'])];
  assert.equal(kind, 'document');
  return [...slots,
    definition('scale', ['t'], ['Multiply', 2 + revision % 2, 't']),
    definition('shift', ['t'], ['Add', 't', 1]),
    definition('square', ['t'], ['Multiply', 't', 't']),
    definition('combine', ['t'], ['Add', ['scale', 't'], ['shift', 't']]),
    ...Array.from({ length: size }, (_, i) => expression(`cell${i}`, ['Add', ['combine', 'a'], i])),
  ];
}

function ready(result, operation) {
  assert.equal(result?.status, 'ready', `${operation}: ${result?.reason ?? 'expected ready result'}`);
  assert.deepEqual(result.diagnostics ?? [], [], `${operation} diagnostics`);
  return result;
}

export function setupPhase1Workload(makeEngine, workload, settings, arm, prepareBatch) {
  if (!['scalar', 'function', 'document'].includes(workload.kind))
    return unsupported('Outside phase1 equivalent-work scope', workload.id);
  const candidate = arm.adapter === 'prepared';
  const route = arm.route ?? 'name';
  assert(['name', 'handle'].includes(route), 'Explicit name or handle route required');
  assert(candidate || arm.adapter === 'native', 'Each arm must explicitly select prepared or native adapter');
  if (candidate && typeof prepareBatch !== 'function')
    return unsupported('Bundle does not export prepareBatch; no source/fallback substitution', workload.id);
  const ce = makeEngine();
  if (!candidate && typeof ce.box !== 'function') return unsupported('Native ce.box unavailable', workload.id);
  let expression;
  let current;
  let a = 2;
  let serial = 0;
  let revision = 0;
  let lastPrepare, lastInstantiate, lastEvaluate, lastWrite;
  const isDocument = workload.kind === 'document';
  const sources = isDocument ? null : entriesFor(workload.kind, settings.documentSize);
  // The native scalar/function lane uses the phase0 setup boundary: external
  // declarations and their first values precede timing. Prepared units capture
  // those declarations in preparation and initialize slots on first execution.
  if (!candidate && !isDocument) for (const entry of sources.filter((e) => e.kind === 'slot')) {
    ce.declare(entry.name, entry.type); ce.assign(entry.name, entry.initializer);
  }
  const prepare = () => {
    const rev = revision++;
    const entries = sources ?? entriesFor('document', settings.documentSize, rev);
    let value;
    if (candidate) {
      const prepared = prepareBatch(ce, entries);
      lastPrepare = prepared;
      value = { unit: prepared.unit, instance: null, revision: rev };
      if (route === 'handle') {
        assert.equal(typeof prepared.unit.resolve, 'function', 'Direct handles unavailable; no name fallback');
        const resolved = prepared.unit.resolve(isDocument ? `cell${settings.documentSize - 1}` : 'result');
        assert.equal(resolved.status, 'ready');
        value.handle = resolved.handle;
      }
    } else {
      // Independent native documents require independent engines, because their
      // boxed handles otherwise adopt later definition edits. Engine setup is
      // deliberately included in this full-revision retention control.
      const engine = isDocument ? makeEngine() : ce;
      if (isDocument) for (const entry of entries.filter((e) => e.kind === 'slot')) {
        engine.declare(entry.name, entry.type); engine.assign(entry.name, entry.initializer);
      }
      for (const entry of entries.filter((e) => e.kind === 'definition'))
        engine.assign(entry.name, engine.box(['Function', entry.body, ...entry.parameters.map((p) => p.name)]));
      const expressions = entries.filter((e) => e.kind === 'expression').map((entry) => engine.box(entry.body));
      value = { engine, expressions, revision: rev };
    }
    current = value;
    return value;
  };
  const instantiate = (value) => {
    if (!value.instance) {
      lastInstantiate = value.unit.instantiate();
      value.instance = lastInstantiate.instance;
    }
    return value.instance;
  };
  const execute = (value = expression) => {
    if (candidate) {
      const name = isDocument ? `cell${settings.documentSize - 1}` : 'result';
      lastEvaluate = route === 'handle' ? instantiate(value).evaluateHandle(value.handle, { numericApproximation: workload.method === 'N' })
        : instantiate(value).evaluate(name, { numericApproximation: workload.method === 'N' });
      return lastEvaluate.value;
    }
    return value.expressions.at(-1)[workload.method ?? 'evaluate']();
  };
  const write = () => {
    const value = 4 + serial++;
    const name = workload.mutation === 'relevant' ? 'a' : 'z';
    if (workload.mutation === 'relevant') a = value;
    if (candidate) lastWrite = instantiate(expression).write(name, value);
    else ce.assign(name, value);
    return value;
  };
  const operation = () => workload.phase === 'box' ? prepare()
    : workload.phase === 'prepare-first' ? execute(prepare()) : execute();
  const validate = (value) => {
    const prepared = workload.phase === 'box';
    const output = prepared ? execute(value) : value;
    const expected = isDocument ? (3 + (prepared ? value.revision : current.revision) % 2) * 2 + settings.documentSize : a * 3 + 5;
    if (candidate) {
      ready(lastPrepare, 'prepareBatch');
      if (lastInstantiate) ready(lastInstantiate, 'instantiate');
      if (lastEvaluate) ready(lastEvaluate, 'evaluate');
      if (lastWrite) ready(lastWrite, 'write');
    }
    numericControl(output, expected, workload.method !== 'N');
  };
  return {
    status: 'ready', ce, prepare, execute, write, operation, validate,
    initialize: () => { expression = prepare(); },
    release: () => { current = null; expression = null; lastPrepare = null; lastInstantiate = null; lastEvaluate = null; lastWrite = null; },
    includesWrite: false,
    route,
    api: candidate ? `prepareBatch / unit.instantiate / instance.${route === 'handle' ? 'evaluateHandle' : 'evaluate'}` : 'ce.box / assign / evaluate or N',
    staticAnalysis: candidate ? 'Unit preparation inside prepare timer; instantiate included in first execution; warm uses one instance'
      : 'Native canonical boxing and lazy evaluation; initial external input declarations outside timer',
    documentStrategy: isDocument ? 'Four named-function prelude definitions plus all scalar cells; no closures; native independent revisions use fresh engine; prepared revisions share captured library engine' : null,
    scope: 'Scalar/named-function host result equivalent; native initial external declarations excluded, prepared slot collection and initial values included; not full semantic equivalence of native revision ownership',
  };
}
