import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isSymbol } from '../../src/compute-engine/boxed-expression/type-guards';

// A function value keeps the activation it was made in in the chain of the
// scope of its body (`captureNestedLocals`, `function-utils.ts`). A rebuild
// of the value keeps the scope of its body, and so the activation: the
// rebuilt value still reads the locals of the call or the block that made
// it.

// f = k ↦ Block(y := k, x ↦ x·y + z): f(5) is a value that reads `y = 5`.
function callValue() {
  const ce = new ComputeEngine();
  ce.assign(
    'f',
    ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'y', "'unknown'", 'k'],
        ['Function', ['Add', ['Multiply', 'x', 'y'], 'z'], 'x'],
      ],
      'k',
    ])
  );
  return { ce, value: ce.box(['f', 5]).evaluate() };
}

// Block(k := 7, x ↦ k + sin²x + cos²x): a value that reads the block local.
function blockValue() {
  const ce = new ComputeEngine();
  const value = ce
    .box([
      'Block',
      ['Declare', 'k', "'integer'", 7],
      [
        'Function',
        ['Add', 'k', ['Power', ['Sin', 'x'], 2], ['Power', ['Cos', 'x'], 2]],
        'x',
      ],
    ])
    .evaluate();
  return { ce, value };
}

describe('a rebuilt function value keeps its activation', () => {
  test('subs', () => {
    const { ce, value } = callValue();
    const rebuilt = value.subs({ z: 1 });
    expect(ce.box(['Apply', rebuilt, 2]).evaluate().json).toBe(11);
  });

  test('subs of a list that holds the value', () => {
    const { ce, value } = callValue();
    const list = ce.box(['List', value, 'z']).subs({ z: 1 });
    expect(ce.box(['Apply', ['At', list, 1], 2]).evaluate().json).toBe(11);
  });

  test('map', () => {
    const { ce, value } = callValue();
    const rebuilt = value.map((e) => (isSymbol(e, 'z') ? ce.number(1) : e));
    expect(ce.box(['Apply', rebuilt, 2]).evaluate().json).toBe(11);
  });

  test('simplify', () => {
    const { ce, value } = blockValue();
    expect(ce.box(['Apply', value.simplify(), 1]).evaluate().json).toBe(8);
  });
});

describe('a returned closure used as the callback of a Map', () => {
  test('the drain reads the local of the call that made the closure', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      'let h = (k) => do { let y = k; (x) => x + y }; let w = (gg) => listFrom(map(gg, [1, 5])); w(h(3))'
    );
    expect(r.value?.json).toEqual(['List', 4, 8]);
  });
});

// The end of a call renames a parameter of a function value of its result
// when the argument names it (`mk(x)` with an inner parameter `x`). The
// renamed value has its own copies of the scopes nested in its body, so
// the renamed occurrences in a nested function literal or block stay bound.
describe('a function value whose parameter is renamed at the end of a call', () => {
  const run = (source: string) => {
    const r = executeEpsil(new ComputeEngine(), source);
    expect(r.diagnostics).toEqual([]);
    return r.value?.json;
  };

  test('a curried function applied to the name of an inner parameter', () => {
    expect(run('let mk = (y) => (x) => (w) => x + y + w; mk(x)(1)(2)')).toEqual(
      ['Add', 'x', 3]
    );
    expect(
      run(
        'let mk = (y) => (x) => (w) => x * y * w; let h = mk(x); [h(1)(2), h(3)(1)]'
      )
    ).toEqual(['List', ['Multiply', 2, 'x'], ['Multiply', 3, 'x']]);
  });

  test('a nested block of the value reads a local of the call that made it', () => {
    expect(
      run(
        'let mk = (y) => do { let c = 1; (x) => do { let g = (z) => z + c; g(x) + y } }; mk(x)(5)'
      )
    ).toEqual(['Add', 'x', 6]);
    expect(
      run(
        'let mk = (y) => do { let c = 1; (x) => (z => z + c + y)(x) }; mk(x)(5)'
      )
    ).toEqual(['Add', 'x', 6]);
  });

  test('a loop of the value that writes its own index adds no effect to the type', () => {
    const type = (argument: string) => {
      const r = executeEpsil(
        new ComputeEngine(),
        `let mk = (y) => (x) => do { for i in [1, 2] { i = i + 1 }; x + y }; mk(${argument})`
      );
      return String(r.value?.type);
    };
    expect(type('q')).toBe('(x: unknown) -> number');
    expect(type('x')).toBe('(x_1: unknown) -> number');
  });
});
