import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// The index reads of a bare (unannotated) function parameter are recorded
// per index (`docs/INFERENCE_ROADMAP.md` §5). While every read uses a literal
// index, the parameter is a tuple whose component at each read index is the
// requirement of that read. When a read uses an index that is not a literal,
// the parameter is an indexed collection whose element type is the union of
// the requirements of all the reads. A free symbol keeps the rule that one
// typed read decides the element type of every element.
//

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

const PROGRAM = 'let f = p => !p[1] if p[2] % 2 == 0 else p[1]';

// `p => !p[1] if p[2] % 2 == 0 else p[1]` as a MathJSON `Function` literal.
const LAMBDA: MathJsonExpression = [
  'Function',
  [
    'If',
    ['Equal', ['Mod', ['At', 'p', 2], 2], 0],
    ['Not', ['At', 'p', 1]],
    ['At', 'p', 1],
  ],
  'p',
];

describe('a literal index read narrows one tuple component', () => {
  test('Epsil: a boolean first element and an integer second element', () => {
    const even = run(`${PROGRAM}\nf((true, 4))`);
    expect(even.diagnostics).toEqual([]);
    expect(even.value?.toString()).toBe('"False"');
    const odd = run(`${PROGRAM}\nf((true, 3))`);
    expect(odd.diagnostics).toEqual([]);
    expect(odd.value?.toString()).toBe('"True"');
  });

  test('MathJSON: the Function literal is valid and types its parameter as a tuple', () => {
    const ce = new ComputeEngine();
    const f = ce.box(LAMBDA);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('(p: tuple<boolean, real>) -> boolean');
    expect(
      ce
        .box(['Apply', LAMBDA, ['Tuple', 'True', 4]])
        .evaluate()
        .toString()
    ).toBe('"False"');
    expect(
      ce
        .box(['Apply', LAMBDA, ['Tuple', 'True', 3]])
        .evaluate()
        .toString()
    ).toBe('"True"');
  });

  test('a component that no read uses is unknown, and the length is the largest index', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', ['At', 'v', 3], 1], 'v']);
    expect(f.type.toString()).toBe(
      '(v: tuple<unknown, unknown, number>) -> number'
    );
  });

  test('the mirror case: a boolean read then a numeric read at another index is not refused', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Block', ['And', ['At', 'xs', 1], 'B'], ['Add', ['At', 'xs', 2], 1]],
      'xs',
    ]);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('(xs: tuple<boolean, real>) -> real');
  });

  test('two reads at the same index with no common value are still an error', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Block', ['Not', ['At', 'p', 1]], ['Add', ['At', 'p', 1], 1]],
      'p',
    ]);
    expect(f.isValid).toBe(false);
    expect(f.toString()).toContain('incompatible-type');
  });

  test('the inferred tuple is not enforced: a list argument is read whole', () => {
    const r = run('let h = p => p[1] + p[2]\nh([3, 4])');
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('7');
    const m = run('let h = p => p[1] + p[2]\nmap(h, [(1, 2), (3, 4)])');
    expect(m.value?.toString()).toBe('[3,7]');
  });

  test('a literal index above 32 counts as a non-literal index', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', ['At', 'p', 1], ['At', 'p', 100]],
      'p',
    ]);
    expect(f.type.toString()).toBe('(p: indexed_collection<number>) -> number');
  });
});

describe('a read at an index that is not a literal joins the requirements', () => {
  test('the element type is the union of the requirements of all the reads', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      [
        'Block',
        ['Not', ['At', 'p', 1]],
        ['Add', ['At', 'p', 2], 1],
        ['Add', ['At', 'p', 'k'], 1],
      ],
      'p',
      'k',
    ]);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toMatch(
      /^\(p: indexed_collection<boolean \| real>, /
    );
  });

  test('a first read at a non-literal index keeps the general rule', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', ['At', 'p', 'k'], 1], 'p', 'k']);
    expect(f.type.toString()).toBe(
      '(p: dictionary<number> | indexed_collection<number>, unknown) -> number'
    );
  });
});

describe('a free symbol keeps one element type for every element', () => {
  test('xs[1] + 1 at the top level', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', 'xs', 1], 1]);
    expect(ce.symbol('xs').type.toString()).toBe('indexed_collection<number>');
  });
});

describe('the compiled route checks an inferred tuple base', () => {
  test('a matrix given to a kernel compiled for `v: tuple<number>` fails loudly', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Add', ['At', 'v', 1], 1], 'v']));
    expect(ce.symbol('h').type.toString()).toBe('(tuple<number>) -> number');
    const compiled = compile(ce.box(['h', 'xs'])) as unknown as
      { run: (env: unknown) => unknown } | ((env: unknown) => unknown);
    const runIt = typeof compiled === 'function' ? compiled : compiled.run;
    expect(runIt({ xs: [1, 2, 3] })).toBe(2);
    expect(() =>
      runIt({
        xs: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toThrow(/static element type/);
  });

  test('the compiled tuple lambda agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(LAMBDA));
    const compiled = compile(ce.box(['f', 'q'])) as unknown as
      { run: (env: unknown) => unknown } | ((env: unknown) => unknown);
    const runIt = typeof compiled === 'function' ? compiled : compiled.run;
    expect(runIt({ q: [true, 4] })).toBe(false);
    expect(runIt({ q: [true, 3] })).toBe(true);
  });
});
