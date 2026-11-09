/** Disposable, closed-vocabulary experiment; not a production compiler. */
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.CE_ROOT ?? '/tmp/wt-js-profile-audit');
const revision = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const { ComputeEngine, compile } = await import(pathToFileURL(resolve(ROOT, 'src/compute-engine.ts')).href);
const outputDirectory = resolve(process.env.OUTPUT_DIR ?? fileURLToPath(new URL('.', import.meta.url)));
mkdirSync(outputDirectory, { recursive: true });
const output = resolve(outputDirectory, 'structured-ir-results.json');
const signatures = new Map([
  ['Add', [['f64', 'f64'], 'f64']],
  ['Multiply', [['f64', 'f64'], 'f64']],
  ['Greater', [['f64', 'f64'], 'bool']],
  ['Sin', [['f64'], 'f64']], ['Cos', [['f64'], 'f64']],
  ['Sqrt', [['f64'], 'f64']], ['Negate', [['f64'], 'f64']],
  ['TapPositive', [['f64'], 'f64']], ['TapNegative', [['f64'], 'f64']],
]);
const effectful = new Set(['TapPositive', 'TapNegative']);

function lower(json, declarations, cse) {
  let next = 0;
  const value = (type) => ({ id: `v${next++}`, type });
  const inputs = declarations.map(([name]) => ({ name, ...value('f64') }));
  const environment = new Map(inputs.map((p) => [p.name, p]));
  function region(expression, outer) {
    const ops = [];
    const env = new Map(outer);
    const cache = new Map();
    function operation(kind, args, type, extra = {}) {
      const key = JSON.stringify([kind, args.map((a) => a.id), extra]);
      if (cse && !effectful.has(kind) && cache.has(key)) return cache.get(key);
      const result = value(type);
      ops.push({ kind, args: args.map((a) => a.id), result, ...extra });
      if (effectful.has(kind)) cache.clear();
      else if (cse) cache.set(key, result);
      return result;
    }
    function expressionValue(e) {
      if (typeof e === 'number') {
        assert(Number.isFinite(e), 'finite literal required');
        return operation('Constant', [], 'f64', { literal: e });
      }
      if (typeof e === 'string') {
        assert(env.has(e), `unbound ${e}`);
        return env.get(e);
      }
      assert(Array.isArray(e), 'MathJSON array required');
      const [head, ...args] = e;
      if (head === 'Block') {
        assert(args.length > 0);
        for (const statement of args.slice(0, -1)) {
          assert(Array.isArray(statement));
          if (statement[0] === 'Declare') {
            assert.equal(statement[2], "'real'");
            assert(!env.has(statement[1]), 'shadowing outside pilot');
            env.set(statement[1], expressionValue(statement[3]));
          } else if (statement[0] === 'Loop') {
            const [, assignment, domain] = statement;
            assert.equal(assignment[0], 'Assign');
            assert.equal(domain[0], 'Element');
            assert.equal(domain[2][0], 'Range');
            const explicitStep = domain[2][3];
            assert(explicitStep === undefined || explicitStep === 1 || explicitStep === -1, 'pilot supports unit step only');
            const name = assignment[1];
            assert(env.has(name));
            assert(!env.has(domain[1]), 'index shadowing outside pilot');
            const initial = env.get(name);
            const start = expressionValue(domain[2][1]);
            const end = expressionValue(domain[2][2]);
            const index = value('f64');
            const carried = value('f64');
            const bodyEnv = new Map(env);
            bodyEnv.set(name, carried);
            bodyEnv.set(domain[1], index);
            const body = region(assignment[2], bodyEnv);
            const result = value('f64');
            ops.push({ kind: 'Loop', args: [initial.id, start.id, end.id], result, index, carried, body, explicitStep });
            env.set(name, result);
            cache.clear();
          } else throw new Error(`statement outside pilot: ${statement[0]}`);
        }
        return expressionValue(args.at(-1));
      }
      if (head === 'If') {
        assert.equal(args.length, 3);
        const condition = expressionValue(args[0]);
        const yes = region(args[1], env);
        const no = region(args[2], env);
        assert.equal(yes.result.type, no.result.type);
        const result = value(yes.result.type);
        ops.push({ kind: 'If', args: [condition.id], result, yes, no });
        cache.clear();
        return result;
      }
      const signature = signatures.get(head);
      assert(signature, `head outside pilot: ${head}`);
      assert.equal(args.length, signature[0].length);
      const values = args.map(expressionValue);
      values.forEach((v, i) => assert.equal(v.type, signature[0][i]));
      return operation(head, values, signature[1]);
    }
    const result = expressionValue(expression);
    return { ops, result };
  }
  return { inputs, body: region(json, environment) };
}

function verify(ir) {
  const allDefinitions = new Set();
  function define(v, visible) {
    assert(['f64', 'bool'].includes(v.type), 'unknown type');
    assert(!allDefinitions.has(v.id), `duplicate ${v.id}`);
    allDefinitions.add(v.id);
    visible.set(v.id, v.type);
  }
  const root = new Map();
  ir.inputs.forEach((v) => define(v, root));
  function region(body, enclosing, parameters = []) {
    const visible = new Map(enclosing);
    parameters.forEach((v) => define(v, visible));
    function read(id, type) {
      assert(visible.has(id), `undefined or escaped value ${id}`);
      assert.equal(visible.get(id), type, `type mismatch ${id}`);
    }
    for (const op of body.ops) {
      if (op.kind === 'If') {
        assert.equal(op.args.length, 1);
        read(op.args[0], 'bool');
        region(op.yes, visible);
        region(op.no, visible);
        assert.equal(op.yes.result.type, op.result.type);
        assert.equal(op.no.result.type, op.result.type);
      } else if (op.kind === 'Loop') {
        assert.equal(op.args.length, 3);
        op.args.forEach((a) => read(a, 'f64'));
        assert(op.explicitStep === undefined || op.explicitStep === 1 || op.explicitStep === -1);
        assert.equal(op.index.type, 'f64');
        assert.equal(op.carried.type, 'f64', 'loop carried value must have f64 type');
        region(op.body, visible, [op.index, op.carried]);
        assert.equal(op.body.result.type, 'f64');
        assert.equal(op.result.type, 'f64');
      } else if (op.kind === 'Constant') {
        assert.equal(op.args.length, 0);
        assert.equal(op.result.type, 'f64');
        assert(Number.isFinite(op.literal));
      } else {
        const signature = signatures.get(op.kind);
        assert(signature, 'unknown instruction');
        assert.equal(op.args.length, signature[0].length);
        op.args.forEach((a, i) => read(a, signature[0][i]));
        assert.equal(op.result.type, signature[1]);
      }
      define(op.result, visible);
    }
    read(body.result.id, body.result.type);
  }
  region(ir.body, root);
}

function emit(ir) {
  verify(ir);
  function region(body) {
    return body.ops.map((op) => {
      const [a, b] = op.args;
      const out = op.result.id;
      if (op.kind === 'If')
        return `let ${out}; if (${a}) { ${region(op.yes)} ${out} = ${op.yes.result.id}; } else { ${region(op.no)} ${out} = ${op.no.result.id}; }`;
      if (op.kind === 'Loop')
        return `let ${out} = ${a}; const step_${out} = ${op.explicitStep === undefined ? `${b} <= ${op.args[2]} ? 1 : -1` : op.explicitStep}; for (let ${op.index.id} = ${b}; step_${out} > 0 ? ${op.index.id} <= ${op.args[2]} : ${op.index.id} >= ${op.args[2]}; ${op.index.id} += step_${out}) { const ${op.carried.id} = ${out}; ${region(op.body)} ${out} = ${op.body.result.id}; }`;
      const expressions = {
        Constant: () => JSON.stringify(op.literal),
        Add: () => `${a} + ${b}`, Multiply: () => `${a} * ${b}`,
        Greater: () => `${a} > ${b}`, Negate: () => `-${a}`,
        Sin: () => `Math.sin(${a})`, Cos: () => `Math.cos(${a})`,
        Sqrt: () => `Math.sqrt(${a})`,
        TapPositive: () => `tap('positive', ${a})`,
        TapNegative: () => `tap('negative', ${a})`,
      };
      return `const ${out} = ${expressions[op.kind]()};`;
    }).join('\n');
  }
  return `${ir.inputs.map((p) => `const ${p.id} = inputs[${JSON.stringify(p.name)}];`).join('\n')}\n${region(ir.body)}\nreturn ${ir.body.result.id};`;
}

const shared = ['Add', ['Multiply', 'x', 'x'], 1];
const cases = [
  { name: 'repeated-arithmetic', declarations: [['x', 'real']], json: ['Add', ['Sin', shared], ['Cos', shared]], inputs: [-3, 0, 0.5, 2].map((x) => ({ x })), oracle: ({ x }) => Math.sin(x*x+1) + Math.cos(x*x+1) },
  { name: 'lazy-conditional', declarations: [['x', 'real']], json: ['If', ['Greater', 'x', 0], ['Sqrt', 'x'], ['Negate', 'x']], inputs: [-4, 0, 0.25, 9].map((x) => ({ x })), oracle: ({ x }) => x > 0 ? Math.sqrt(x) : -x },
  { name: 'accumulator-loop', declarations: [['x', 'real'], ['n', 'integer']], json: ['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', 'i', 'x']]], ['Element', 'i', ['Range', 1, 'n', 1]]], 's'], inputs: [0, 1, 8].flatMap((n) => [0.5, -2].map((x) => ({ x, n }))), oracle: ({ x, n }) => x*n*(n+1)/2 },
  { name: 'lazy-effect-trace', declarations: [['x', 'real']], json: ['If', ['Greater', 'x', 0], ['TapPositive', 'x'], ['TapNegative', 'x']], inputs: [-4, 0.25].map((x) => ({ x })), oracle: ({ x }) => x > 0 ? Math.sqrt(x) : -x, effects: true },
];
const descending = structuredClone({ ...cases[2], oracle: undefined });
descending.name = 'default-descending-range';
descending.json[2][2][2].pop();
descending.inputs = [{ x: 0.5, n: 0 }, { x: 2, n: -2 }];
descending.oracle = ({ x, n }) => x*(1+n)*(2-n)/2;
cases.push(descending);

function equalNumber(a, b) {
  assert.equal(typeof a, 'number');
  assert.equal(typeof b, 'number');
  assert(a === b || Math.abs(a-b) <= 1e-12*Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
}
function count(body) {
  return body.ops.length + body.ops.reduce((n, op) => n + (op.yes ? count(op.yes)+count(op.no) : op.body ? count(op.body) : 0), 0);
}
const results = [];
for (const fixture of cases) {
  const ce = new ComputeEngine();
  fixture.declarations.forEach(([name, type]) => ce.declare(name, type));
  if (fixture.effects) {
    ce.declare('TapPositive', '(real) -> real');
    ce.declare('TapNegative', '(real) -> real');
  }
  const expr = ce.expr(fixture.json);
  assert(expr.isValid, `${fixture.name} must be valid`);
  const options = { to: 'javascript', fallback: false, constantFold: false, cse: false };
  if (fixture.effects) options.functions = {
    TapPositive: { source: "((x) => { globalThis.__structuredIrTrace.push('positive'); return Math.sqrt(x); })", pure: false },
    TapNegative: { source: "((x) => { globalThis.__structuredIrTrace.push('negative'); return -x; })", pure: false },
  };
  const legacy = compile(expr, options);
  assert.equal(legacy.success, true);
  const variants = [];
  for (const cse of [false, true]) {
    const ir = lower(fixture.json, fixture.declarations, cse);
    const source = emit(ir);
    const run = new Function('inputs', 'tap', source);
    const values = [];
    for (const inputs of fixture.inputs) {
      const trace = [];
      const v = run(inputs, (arm, x) => { trace.push(arm); return arm === 'positive' ? Math.sqrt(x) : -x; });
      const prior = Object.getOwnPropertyDescriptor(globalThis, '__structuredIrTrace');
      let old;
      try {
        globalThis.__structuredIrTrace = [];
        old = legacy.run(inputs);
        if (fixture.effects) {
          assert.deepEqual(trace, [inputs.x > 0 ? 'positive' : 'negative']);
          assert.deepEqual(globalThis.__structuredIrTrace, trace);
        }
      } finally {
        if (prior) Object.defineProperty(globalThis, '__structuredIrTrace', prior);
        else delete globalThis.__structuredIrTrace;
      }
      equalNumber(v, fixture.oracle(inputs));
      equalNumber(v, old);
      values.push({ inputs, result: v, legacy: old, trace });
    }
    variants.push({ cse, instructions: count(ir.body), sourceBytes: Buffer.byteLength(source), source, ir, values });
  }
  results.push({ name: fixture.name, declarations: fixture.declarations, mathjson: fixture.json, legacySource: legacy.code, legacySourceBytes: Buffer.byteLength(legacy.code), variants });
}

const controls = [];
function reject(name, original, mutate, pattern) {
  const ir = structuredClone(original);
  mutate(ir);
  assert.throws(() => verify(ir), pattern);
  controls.push({ name, rejected: true });
}
for (const cse of [false, true]) {
  const arithmetic = lower(cases[0].json, cases[0].declarations, cse);
  const conditional = lower(cases[1].json, cases[1].declarations, cse);
  const loop = lower(cases[2].json, cases[2].declarations, cse);
  reject(`undefined-use/cse=${cse}`, arithmetic, (ir) => { ir.body.ops[0].args[0] = 'missing'; }, /undefined or escaped/);
  reject(`operand-type-mismatch/cse=${cse}`, arithmetic, (ir) => { ir.inputs[0].type = 'bool'; }, /type mismatch/);
  reject(`branch-region-escape/cse=${cse}`, conditional, (ir) => { ir.body.result = ir.body.ops.find((op) => op.kind === 'If').yes.result; }, /undefined or escaped/);
  reject(`loop-carried-type-mismatch/cse=${cse}`, loop, (ir) => { ir.body.ops.find((op) => op.kind === 'Loop').carried.type = 'bool'; }, /loop carried value must have f64 type/);
}
const effectControls = [];
for (const cse of [false, true]) {
  const duplicate = lower(['Add', ['TapPositive', 'x'], ['TapPositive', 'x']], [['x', 'real']], cse);
  const trace = [];
  const actual = new Function('inputs', 'tap', emit(duplicate))({x:4}, (arm,x) => {trace.push(arm); return Math.sqrt(x);});
  assert.equal(actual,4);
  assert.deepEqual(trace,['positive','positive']);
  assert.equal(duplicate.body.ops.filter((op) => op.kind === 'TapPositive').length,2);
  const across = lower(['Add', ['Sin', shared], ['Add', ['TapPositive','x'], ['Cos', shared]]], [['x','real']], cse);
  const barrierTrace = [];
  const barrierValue = new Function('inputs','tap',emit(across))({x:4}, (arm,x) => {barrierTrace.push(arm); return Math.sqrt(x);});
  equalNumber(barrierValue,Math.sin(17)+2+Math.cos(17));
  assert.deepEqual(barrierTrace,['positive']);
  assert.equal(across.body.ops.filter((op) => op.kind === 'Multiply').length,2,'pure expression must not share across effect barrier');
  effectControls.push({cse,duplicateCalls:trace.length,barrierRecomputations:2,passed:true});
}
const report = { root: ROOT, revision, node: process.version, purpose: 'correctness-only bounded structured IR experiment', limitations: ['Raw MathJSON lowering; no CE fragment annotations', 'Only declared numeric fixtures and listed binary/unary operations', 'Finite small integer loop bounds supplied by fixture; default Range direction and explicit unit steps supported; no budgets, fractional steps, break/continue or general mutation', 'No host binding, shadowing, complex mode, absence, runtime packaging or worker support', 'No timing or memory measurements; source byte counts exclude different runtime wrappers'], results, negativeControls: controls, effectControls };
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ cases: results.length, evaluations: results.reduce((n, r) => n+r.variants.reduce((m, v) => m+v.values.length, 0), 0), negativeControls: controls.length, output })}\n`);
