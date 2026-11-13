import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A `const` local of a block is marked constant when its `Declare` is boxed
// (`markConstantLocal`, `library/core.ts`), and the canonical order of a sum
// or a product sorts it as a constant, as it sorts a global constant:
// `30001 + i` stays `30001 + i`. A `let` local and a parameter sort as
// variables: `i + 30001`. The four programs are the bodies of host
// preludes.

const PRELUDE = `
function sx(p: real) -> real {
  const x = p - 0.25
  x * x
}
function cell(a: real, b: real) -> integer {
  const i = floor(a)
  const j = floor(b)
  const c = 1 + i + 150*j
  c
}
function seg(w: real, a: real, b: real, c0: real, c1: real) -> real {
  const u = (w - a) / (b - a)
  if w < a { 0 } else { if w >= b { 0 } else { c0 + (c1 - c0) * u * u * (3 - 2*u) } }
}
function idx(x: real) -> real {
  const i = floor(x)
  max(30001, min(60000, 30001 + i))
}`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  expect(executeEpsil(ce, PRELUDE).diagnostics).toEqual([]);
  for (const n of ['x', 'y', 'z', 'a', 'b']) ce.declare(n, 'real');
  return ce;
}

describe('the order of a sum with a const local', () => {
  it('a sum of a const local and a number keeps the number first', () => {
    const ce = new ComputeEngine();
    const D = [
      'Dictionary',
      ['KeyValuePair', { str: 'value' }, ['Floor', 'x']],
      ['KeyValuePair', { str: 'constant' }, 'True'],
    ];
    expect(
      ce.box(['Block', ['Declare', 'i', D], ['Add', 30001, 'i']] as never).json
    ).toEqual(['Block', ['Declare', 'i', D], ['Add', 30001, 'i']]);
    expect(
      ce.box(['Block', ['Declare', 'i', D], ['Add', 'zz', 'i']] as never).json
    ).toEqual(['Block', ['Declare', 'i', D], ['Add', 'zz', 'i']]);
  });

  it('a const local and a global constant of the same name order the same way', () => {
    const local = new ComputeEngine();
    const D = [
      'Dictionary',
      ['KeyValuePair', { str: 'value' }, ['Floor', 'x']],
      ['KeyValuePair', { str: 'constant' }, 'True'],
    ];
    const block = local.box([
      'Block',
      ['Declare', 'i', D],
      ['Add', 30001, 'i'],
    ] as never).json as unknown[];
    const global = new ComputeEngine();
    expect(executeEpsil(global, 'const i = floor(x)').diagnostics).toEqual([]);
    expect(global.box(['Add', 30001, 'i']).json).toEqual(block[2]);
    expect(block[2]).toEqual(['Add', 30001, 'i']);
  });

  it('a let local and a parameter order as variables', () => {
    const ce = new ComputeEngine();
    const D = [
      'Dictionary',
      ['KeyValuePair', { str: 'value' }, ['Floor', 'x']],
    ];
    expect(
      ce.box(['Block', ['Declare', 'i', D], ['Add', 30001, 'i']] as never).json
    ).toEqual(['Block', ['Declare', 'i', D], ['Add', 'i', 30001]]);
    expect(
      executeEpsil(ce, 'function g(i: real) -> real {\n  30001 + i\n}')
        .diagnostics
    ).toEqual([]);
    ce.declare('x', 'real');
    expect(compile(ce.box(['g', 'x']))?.preamble).toContain('i + 30001');
  });

  it('a constant such as Pi still sorts after a number', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Add', 'x', 'Pi', 30001]).json).toEqual([
      'Add',
      'x',
      30001,
      'Pi',
    ]);
  });

  it('JavaScript: p - 0.25', () => {
    const r = compile(engine().box(['sx', 'x']));
    expect(r?.preamble).toContain('let x = p + -0.25;');
  });

  it('JavaScript: 1 + i + 150*j', () => {
    const r = compile(engine().box(['cell', 'x', 'y']));
    expect(r?.preamble).toContain('let c = 1 + i + 150 * j;');
  });

  it('JavaScript: c0 + (c1 - c0) * u * u * (3 - 2*u)', () => {
    const r = compile(engine().box(['seg', 'x', 'a', 'b', 'y', 'z']));
    expect(r?.preamble).toContain('c0 + u * u * (3 + -2 * u) * (-c0 + c1)');
  });

  it('GLSL: 30001 + i', () => {
    const r = compile(engine().box(['idx', 'x']), { to: 'glsl' });
    expect(r?.preamble).toContain(
      'return _gpu_max(30001.0, _gpu_min(60000.0, 30001.0 + i));'
    );
  });
});
