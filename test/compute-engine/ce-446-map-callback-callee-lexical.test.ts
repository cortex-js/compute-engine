import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';
import { calleesResolveLexically } from '../../src/compute-engine/library/map-exact-proof';

/**
 * CE-446: the compiled element function of a `Map` must call the functions
 * that the body of the callback calls through their lexical binding, as the
 * interpreter does.
 *
 * An outer `h(x) = sin(x) + 1.5` is called by the callback
 * `f(x) = N(h(x))`. The `Map` is drained in a block that defines another
 * `h(x) = sin(x) + 2.5`. The interpreter calls the outer `h`. Before the
 * fix, the compiler read `h` by name in the scope of the drain and called the
 * inner one: the compiled sum was 5001.7 where the interpreted sum is
 * 3001.7.
 *
 * `precision = 'machine'` changes the global `BigDecimal.precision`, so it
 * is saved and restored.
 */

let savedPrecision: number;
beforeAll(() => {
  savedPrecision = BigDecimal.precision;
});
afterAll(() => {
  BigDecimal.precision = savedPrecision;
});

function engine(jit: 'off' | 'auto'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.jit = jit;
  return ce;
}

/** The value of `program` interpreted and with the auto-compilation. */
function epsilBoth(program: string) {
  const values: string[] = [];
  let hits = 0;
  for (const jit of ['off', 'auto'] as const) {
    _resetMapAutoCompileStats();
    values.push(executeEpsil(engine(jit), program).value.toString());
    if (jit === 'auto') hits = stats.compiledHits;
  }
  return { interpreted: values[0], compiled: values[1], hits };
}

const OUTER = 'h(x) = sin(x) + 1.5\nf(x) = N(h(x))\n';

describe('CE-446 Epsil route', () => {
  test('a shadowing function in the drain scope is not called', () => {
    const r = epsilBoth(
      OUTER + 'do { h(x) = sin(x) + 2.5; sum(map(f, 1..2000)) }'
    );
    expect(r.compiled).toBe(r.interpreted);
    expect(Number(r.interpreted)).toBeCloseTo(3001.7165787095, 6);
  });

  test('the elements are the interpreter elements', () => {
    const r = epsilBoth(OUTER + 'do { h(x) = sin(x) + 2.5; map(f, 1..2000) }');
    expect(r.compiled).toBe(r.interpreted);
  });

  test('without a shadowing function, the body is compiled', () => {
    const r = epsilBoth(OUTER + 'sum(map(f, 1..2000))');
    expect(r.hits).toBe(2000);
    expect(r.compiled).toBe(r.interpreted);
  });

  test('a callback defined in the block calls the inner function', () => {
    const r = epsilBoth(
      'h(x) = sin(x) + 1.5\ndo { h(x) = sin(x) + 2.5; f(x) = N(h(x)); sum(map(f, 1..2000)) }'
    );
    expect(r.hits).toBe(2000);
    expect(r.compiled).toBe(r.interpreted);
    expect(Number(r.interpreted)).toBeCloseTo(5001.7165787095, 6);
  });
});

describe('CE-446 engine API route', () => {
  function run(jit: 'off' | 'auto') {
    const ce = engine(jit);
    ce.assign('h', ce.box(['Function', ['Add', ['Sin', 'x'], 1.5], 'x']));
    ce.assign('f', ce.box(['Function', ['N', ['h', 'x']], 'x']));
    _resetMapAutoCompileStats();
    const value = ce
      .box([
        'Block',
        ['DefineFunction', 'h', ['Function', ['Add', ['Sin', 'x'], 2.5], 'x']],
        ['Sum', ['Map', 'f', ['Range', 1, 2000]]],
      ])
      .evaluate();
    return value.re;
  }

  test('a shadowing function in the block is not called', () => {
    const interpreted = run('off');
    const compiled = run('auto');
    expect(interpreted).toBeCloseTo(3001.7165787095, 6);
    expect(compiled).toBe(interpreted);
  });
});

describe('CE-446 Function-literal callback', () => {
  const PROGRAM =
    'h(x) = sin(x) + 1.5\nm = map((x) -> N(h(x)), 1..2000)\ndo { h(x) = sin(x) + 2.5; sum(m) }';

  test('Epsil: a shadowing function in the drain scope is not called', () => {
    const r = epsilBoth(PROGRAM);
    expect(r.compiled).toBe(r.interpreted);
    expect(Number(r.interpreted)).toBeCloseTo(3001.7165787095, 6);
  });

  test('Epsil: without a shadowing function, the body is compiled', () => {
    const r = epsilBoth(
      'h(x) = sin(x) + 1.5\nsum(map((x) -> N(h(x)), 1..2000))'
    );
    expect(r.hits).toBe(2000);
    expect(r.compiled).toBe(r.interpreted);
  });

  function run(jit: 'off' | 'auto') {
    const ce = engine(jit);
    ce.assign('h', ce.box(['Function', ['Add', ['Sin', 'x'], 1.5], 'x']));
    ce.assign(
      'm',
      ce.box(['Map', ['Function', ['N', ['h', 'x']], 'x'], ['Range', 1, 2000]])
    );
    _resetMapAutoCompileStats();
    const value = ce
      .box([
        'Block',
        ['DefineFunction', 'h', ['Function', ['Add', ['Sin', 'x'], 2.5], 'x']],
        ['Sum', 'm'],
      ])
      .evaluate();
    return value.re;
  }

  test('engine API: a shadowing function in the block is not called', () => {
    const interpreted = run('off');
    const compiled = run('auto');
    expect(interpreted).toBeCloseTo(3001.7165787095, 6);
    expect(compiled).toBe(interpreted);
  });
});

describe('CE-446 calleesResolveLexically()', () => {
  test('a drain scope that binds the name to a constant declines', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Add', ['Sin', 'x'], 1.5], 'x']));
    const fn = ce.box(['Function', ['N', ['h', 'x']], 'x']);
    expect(calleesResolveLexically(ce, fn, new Set())).toBe(true);
    ce.pushScope();
    try {
      ce.declare('h', 'integer');
      ce.assign('h', 3);
      expect(calleesResolveLexically(ce, fn, new Set())).toBe(false);
    } finally {
      ce.popScope();
    }
  });

  test('a body that shares its operands at each level is walked once per node', () => {
    // Without the set of visited nodes, the walk of this body of depth 40
    // takes 2^40 steps.
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    let t = ce.box(['Sin', 'x']);
    for (let i = 0; i < 40; i++) t = ce.function('g', [t, t]);
    const fn = ce.function('Function', [t, ce.symbol('x')]);
    const start = Date.now();
    expect(calleesResolveLexically(ce, fn, new Set())).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
