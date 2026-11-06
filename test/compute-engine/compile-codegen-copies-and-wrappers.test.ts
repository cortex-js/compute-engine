import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { ownedLocalUpdateChains } from '../../src/compute-engine/compilation/in-place-update';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TEST_PYTHON } from './test-python';

// The shape of the generated code for five optimizations of the JavaScript
// and Python targets, and the agreement of the compiled results with the
// interpreter. Each optimization removes a copy, an object or a wrapper that
// the code built at run time.

type Json = unknown;

function run(
  ce: ComputeEngine,
  json: Json,
  vars: Record<string, unknown>
): unknown {
  const r = compile(ce.box(json as never), { fallback: false });
  expect(r.success).toBe(true);
  return (r.run as (v: unknown) => unknown)(vars);
}

function codeOf(ce: ComputeEngine, json: Json, to?: 'python'): string {
  const r = compile(ce.box(json as never), {
    fallback: false,
    ...(to ? { to } : {}),
  });
  expect(r.success).toBe(true);
  return r.code;
}

function interpreted(
  ce: ComputeEngine,
  json: Json,
  values: Record<string, Json>
): unknown {
  // `subs`, not `assign`: an assigned value would be read by the later
  // compilations of the same engine.
  const bindings = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, ce.box(v as never)])
  );
  const r = ce
    .box(json as never)
    .subs(bindings)
    .evaluate();
  if (r.operator === 'List') return r.ops.map((x) => x.re);
  return r.re;
}

const list = (xs: number[]): Json => ['List', ...xs];

describe('Min and Max of a scalar and a list fold without a combined array (CE-337.3)', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('M', 'list<real>');

  test('Min(1, L) does not copy L', () => {
    const code = codeOf(ce, ['Min', 1, 'L']);
    expect(code).not.toContain('...');
    expect(code).not.toContain('reduce');
    expect(code).toBe(
      `((_p0, _p1) => { let _a = Infinity; _a = Math.min(_a, _p0); for (const _x of _p1) { _a = Math.min(_a, _x); } return _a; })(1, _.L)`
    );
  });

  test('Max(L, M) does not copy L or M', () => {
    const code = codeOf(ce, ['Max', 'L', 'M']);
    expect(code).not.toContain('...');
    expect(code).toContain('_n === 0 ? NaN');
  });

  test.each([
    [['Min', 1, 'L'], [3, 0.5, 7], [2]],
    [['Min', 1, 'L'], [], [2]],
    [
      ['Max', 'L', 'M'],
      [3, 0.5, 7],
      [-2, 9],
    ],
    [['Max', 'L', 'M'], [], [-2]],
    [['Min', 'L', 2, 'M'], [3, 0.5, 7], []],
    [['Max', 'L', 2, 'M'], [], []],
  ] as Array<[Json, number[], number[]]>)(
    '%j agrees with the interpreter',
    (json, L, M) => {
      expect(run(ce, json, { L, M })).toBe(
        interpreted(ce, json, { L: list(L), M: list(M) })
      );
    }
  );

  test('an empty pair of lists gives NaN, as in the interpreter', () => {
    expect(run(ce, ['Max', 'L', 'M'], { L: [], M: [] })).toBeNaN();
    expect(
      interpreted(ce, ['Max', 'L', 'M'], { L: list([]), M: list([]) })
    ).toBeNaN();
  });

  test('a NaN element gives NaN', () => {
    expect(run(ce, ['Min', 1, 'L'], { L: [NaN, 2] })).toBeNaN();
  });
});

describe('Re, Im, Abs and Arg of a small power of x + ib build no object (CE-331)', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('b', 'real');

  const cases = [
    '\\operatorname{Re}((x+ib)^2)',
    '\\operatorname{Im}((x+ib)^2)',
    '|(x+ib)^2|',
    '\\arg((x+ib)^2)',
    '\\operatorname{Re}((x+2ib)^3)',
    '\\operatorname{Im}((x-ib)^3)',
    '\\arg((x+ib)^3)',
  ];

  test.each(cases)('%s', (latex) => {
    const expr = ce.parse(latex);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('re:');
    for (const [x, b] of [
      [0.3, 1.7],
      [2, -1],
      [-1.5, 0.25],
    ]) {
      const got = (r.run as (v: unknown) => number)({ x, b });
      const want = expr.subs({ x: ce.number(x), b: ce.number(b) }).N().re;
      expect(got).toBeCloseTo(want, 12);
    }
  });

  test('the square splices each part of the base', () => {
    expect(compile(ce.parse('\\operatorname{Re}((x+ib)^2)')).code).toBe(
      '(_.x * _.x - _.b * _.b)'
    );
  });

  test('a zero imaginary part is +0, so Arg((0 - i)^2) is π', () => {
    // (0 - i)^2 = -1, whose argument is π. A `-0` imaginary part would make
    // `Math.atan2` answer -π.
    const r = compile(ce.parse('\\arg((x+ib)^2)'), { fallback: false });
    expect((r.run as (v: unknown) => number)({ x: 0, b: -1 })).toBe(Math.PI);
  });

  test('a base with a call keeps the object form', () => {
    const r = compile(ce.parse('\\operatorname{Re}((\\sin(x)+ib)^2)'));
    expect(r.code).toContain('re:');
  });

  test('a part with an effect keeps the object form', () => {
    // The code of `x` is given by the caller and increments `_.x`. The split
    // splices each part of the base twice or more, so the increment would
    // run twice: `2 * 3 - 1` is 5, where (2 + i)^2 has the real part 3.
    const r = compile(ce.parse('\\operatorname{Re}((x+ib)^2)'), {
      vars: { x: '_.x++' },
    });
    expect(r.code).toContain('re:');
    expect((r.run as (v: unknown) => number)({ x: 2, b: 1 })).toBe(3);
  });
});

describe('a block-local function that is only called has no broadcast wrapper (CE-338)', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('LL', 'list<list<real>>');
  ce.declare('V', 'list<real>');
  const literal = ['Function', ['Multiply', 2, 'k'], 'k'];
  const block = (...stmts: Json[]): Json => [
    'Block',
    ['Declare', 'g', "'function'", literal],
    ...stmts,
  ];

  test('only calls: the literal is a bare arrow', () => {
    const code = codeOf(ce, block(['Add', ['g', 'x'], ['g', 'y']]));
    expect(code).toContain('g = ((k) => 2 * k);');
    expect(code).not.toContain('Array.isArray');
  });

  test('a call with a list argument broadcasts at the call site', () => {
    const json = block(['g', 'V']);
    expect(codeOf(ce, json)).toContain('_SYS.mapFn(g, [1], _.V)');
    expect(run(ce, json, { V: [1, 2] })).toEqual([2, 4]);
  });

  test('a call in a callback broadcasts over a row', () => {
    const json = block(['Map', ['Function', ['g', 'r'], 'r'], 'LL']);
    expect(run(ce, json, { LL: [[1, 2], [], [3]] })).toEqual([[2, 4], [], [6]]);
  });

  test('the function as a value over list elements is a static map', () => {
    // The elements of `LL` are lists, so `Map` reads the static map of `g`
    // over each row, with no run-time test of the shape of a row.
    const json = block(['Map', 'g', 'LL']);
    const code = codeOf(ce, json);
    expect(code).toContain('_SYS.mapFn(g, [1], ');
    expect(code).not.toContain('Array.isArray');
    expect(run(ce, json, { LL: [[1, 2], [], [3]] })).toEqual([[2, 4], [], [6]]);
  });

  test('a declaration that is the last statement declines', () => {
    // A block whose last statement is a declaration has the value `Nothing`.
    // A declaration whose value is used declines.
    expect(() => compile(ce.box(block() as never), { fallback: false })).toThrow(
      /an assignment or a declaration is a statement, and its value is used/
    );
  });
});

describe('small unrolled JavaScript sums hoist their invariants (CE-339.1)', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');

  test.each([2, 3])('a sum of %i terms computes Max(L) once', (n) => {
    const code = compile(
      ce.parse(`\\sum_{i=1}^{${n}} (i x + \\sin(\\operatorname{Max}(L)))`)
    ).code;
    expect(code.match(/Math\.max/g)?.length).toBe(1);
  });
});

describe('the Python target hoists the invariants of a sum (CE-339.2)', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('n', 'integer');
  const sumN = ce.parse(
    '\\sum_{i=1}^{n} (i x + \\sin(\\operatorname{Max}(L)))'
  );
  const sum3 = ce.parse(
    '\\sum_{i=1}^{3} (i x + \\sin(\\operatorname{Max}(L)))'
  );

  test('constant bounds: the temporary is bound once', () => {
    expect(compile(sum3, { to: 'python' }).code).toBe(
      `[sum(i * x + np.sin(_tv1) for i in range(1, 4)) for _tv1 in [np.max(L)]][0]`
    );
  });

  test('symbolic bounds: the temporary is computed only for a range that is not empty', () => {
    expect(compile(sumN, { to: 'python' }).code).toBe(
      `([sum(i * x + np.sin(_tv1) for i in range(1, n + 1)) for _tv1 in [np.max(L)]][0] if 1 <= n else 0)`
    );
  });

  test('an empty constant range keeps the generator', () => {
    const code = compile(
      ce.parse('\\sum_{i=3}^{1} (i x + \\sin(\\operatorname{Max}(L)))'),
      { to: 'python' }
    ).code;
    expect(code).toBe(
      "sum(i * x + np.sin(np.max(L)) for i in range(3, 2))"
    );
  });

  const python = TEST_PYTHON;
  const hasNumpy = (() => {
    if (python === undefined) return false;
    try {
      execFileSync(python, ['-c', 'import numpy'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  (hasNumpy ? test : test.skip)(
    'the Python code agrees with the interpreter, and an empty range raises nothing',
    () => {
      const target = new PythonTarget();
      let src = 'import numpy as np\nimport math\nimport json\n\n';
      src += `${target.compileFunction(sumN, 'fn_n', ['L', 'x', 'n'])}\n`;
      src += `${target.compileFunction(sum3, 'fn_3', ['L', 'x'])}\n`;
      src +=
        'print(json.dumps([fn_n(np.array([3.0, 1.5, 7.0]), 0.5, 4), ' +
        'fn_3(np.array([3.0, 1.5, 7.0]), 0.5), fn_n(np.array([]), 0.5, 0)]))\n';
      const file = path.join(os.tmpdir(), `ce-py-hoist-${process.pid}.py`);
      fs.writeFileSync(file, src);
      let out = '';
      try {
        out = execFileSync(python!, [file], { encoding: 'utf8' });
      } finally {
        fs.unlinkSync(file);
      }
      const [a, b, c] = JSON.parse(out) as number[];
      const L = list([3, 1.5, 7]);
      expect(a).toBeCloseTo(
        interpreted(ce, sumN.json, { L, x: 0.5, n: 4 }) as number,
        12
      );
      expect(b).toBeCloseTo(
        interpreted(ce, sum3.json, { L, x: 0.5 }) as number,
        12
      );
      expect(c).toBe(0);
    }
  );
});

describe('a block local replaced element by element is written in place (CE-329)', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  const range = ['Element', 'i', ['Range', 1, ['Length', 'L']]];
  const update = [
    'Assign',
    'xs',
    ['ReplaceAt', 'xs', 'i', ['Multiply', 2, ['At', 'xs', 'i']]],
  ];
  const declare = ['Declare', 'xs', "'list<real>'", 'L'];

  test('the loop copies the list once, and never changes the input', () => {
    const json = [
      'Block',
      declare,
      ['Loop', update, range],
      'xs',
    ];
    const code = codeOf(ce, json);
    expect(code).toContain(
      'xs = (_tv1 = _SYS.replaceAtInPlace(xs === _tv1 ? xs : (_tv1 = _SYS.ownedCopy(xs)), i,'
    );
    const L = [1, 2, 3];
    expect(run(ce, json, { L })).toEqual([2, 4, 6]);
    expect(L).toEqual([1, 2, 3]);
    expect(interpreted(ce, json, { L: list([1, 2, 3]) })).toEqual([2, 4, 6]);
  });

  test('a swap reads both old values', () => {
    const json = [
      'Block',
      declare,
      [
        'Loop',
        [
          'Assign',
          'xs',
          [
            'ReplaceAt',
            ['ReplaceAt', 'xs', 1, ['At', 'xs', 2]],
            2,
            ['At', 'xs', 1],
          ],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      'xs',
    ];
    expect(codeOf(ce, json)).toContain('replaceAtInPlace');
    expect(run(ce, json, { L: [1, 2, 3] })).toEqual([2, 1, 3]);
    expect(interpreted(ce, json, { L: list([1, 2, 3]) })).toEqual([2, 1, 3]);
  });

  test('an assignment of the input between two loops copies again', () => {
    const json = [
      'Block',
      declare,
      ['Loop', update, range],
      ['Assign', 'xs', 'L'],
      ['Loop', update, range],
      'xs',
    ];
    const L = [1, 2, 3];
    expect(run(ce, json, { L })).toEqual([2, 4, 6]);
    expect(L).toEqual([1, 2, 3]);
  });

  test('a second name for the list keeps the copying form', () => {
    ce.declare('ys', 'list<real>');
    const json = [
      'Block',
      declare,
      // `ys` gets a value before the loop: a local that only the loop body
      // assigns may have no value after a loop that runs zero times, and
      // such a read declines.
      ['Declare', 'ys', "'list<real>'", ['List']],
      ['Loop', ['Block', update, ['Assign', 'ys', 'xs']], range],
      ['Add', ['Sum', 'xs'], ['Multiply', 100, ['Sum', 'ys']]],
    ];
    const code = codeOf(ce, json);
    expect(code).not.toContain('replaceAtInPlace');
    expect(run(ce, json, { L: [1, 2, 3] })).toBe(1212);
  });

  test('a dictionary value that holds the list keeps the copying form', () => {
    // `ys` is initialized from the attributes dictionary, so it holds the
    // array of `xs`, which an in-place update would change.
    const json = [
      'Block',
      declare,
      [
        'Declare',
        'ys',
        "'list<real>'",
        ['Dictionary', ['KeyValuePair', "'value'", 'xs']],
      ],
      ['Loop', update, range],
      ['Add', ['Sum', 'xs'], ['Multiply', 100, ['Sum', 'ys']]],
    ];
    expect(codeOf(ce, json)).not.toContain('replaceAtInPlace');
    expect(run(ce, json, { L: [1, 2, 3] })).toBe(612);
  });

  test('a list in a dictionary value keeps the copying form', () => {
    // `ys` holds a list whose element is the array of `xs`, so a read of the
    // dictionary value by position is not enough to allow it.
    const json = [
      'Block',
      declare,
      [
        'Declare',
        'ys',
        "'list<list<real>>'",
        ['Dictionary', ['KeyValuePair', "'value'", ['List', 'xs']]],
      ],
      ['Loop', update, range],
      ['Add', ['Sum', 'xs'], ['Multiply', 100, ['Sum', ['At', 'ys', 1]]]],
    ];
    expect(codeOf(ce, json)).not.toContain('replaceAtInPlace');
    expect(run(ce, json, { L: [1, 2, 3] })).toBe(612);
  });

  test('`const r = xs[1]` before the loop does not stop the in-place write', () => {
    // `r` keeps the element that it read, also after the loop writes it.
    const json = [
      'Block',
      declare,
      [
        'Declare',
        'r',
        "'real'",
        ['Dictionary', ['KeyValuePair', "'value'", ['At', 'xs', 1]]],
      ],
      ['Loop', update, range],
      ['Add', ['Multiply', 100, 'r'], ['At', 'xs', 1]],
    ];
    expect(codeOf(ce, json)).toContain('_SYS.replaceAtInPlace');
    const L = [5, 2, 3];
    expect(run(ce, json, { L })).toBe(510);
    expect(L).toEqual([5, 2, 3]);
    expect(interpreted(ce, json, { L: list([5, 2, 3]) })).toBe(510);
  });

  test('a last line that writes without assigning does not stop the in-place write', () => {
    const json = [
      'Block',
      declare,
      ['Loop', update, range],
      ['ReplaceAt', 'xs', 1, 0],
    ];
    const code = codeOf(ce, json);
    expect(code).toContain('_SYS.replaceAtInPlace');
    expect(code).toContain('_SYS.replaceAt(xs, 1, 0)');
    const L = [1, 2, 3];
    expect(run(ce, json, { L })).toEqual([0, 4, 6]);
    expect(L).toEqual([1, 2, 3]);
    expect(interpreted(ce, json, { L: list([1, 2, 3]) })).toEqual([0, 4, 6]);
  });

  test('a copy made with `ReplaceAt` before the loop keeps its values', () => {
    // `ys` holds its own array, so the writes to `xs` do not reach it.
    const json = [
      'Block',
      declare,
      ['Declare', 'ys', "'list<real>'", ['ReplaceAt', 'xs', 1, 0]],
      ['Loop', update, range],
      ['Add', ['Sum', 'xs'], ['Multiply', 100, ['Sum', 'ys']]],
    ];
    expect(codeOf(ce, json)).toContain('_SYS.replaceAtInPlace');
    const L = [1, 2, 3];
    expect(run(ce, json, { L })).toBe(512);
    expect(L).toEqual([1, 2, 3]);
    expect(interpreted(ce, json, { L: list([1, 2, 3]) })).toBe(512);
  });

  test('one node that is both an update and a copy keeps the copying form', () => {
    // A host can build a block with one `ReplaceAt` node in two statements. The
    // in-place write is marked on the operands of the node, so the read `ys = R`
    // would also compile in place, and `ys` would see the later write of `xs`.
    const xs = ce.symbol('xs');
    const ys = ce.symbol('ys');
    const R = ce._fn('ReplaceAt', [xs, ce.number(1), ce.number(0)]);
    const later = ce._fn('ReplaceAt', [xs, ce.number(2), ce.number(9)]);
    const statements = [
      ce._fn('Assign', [xs, R]),
      ce._fn('Assign', [ys, R]),
      ce._fn('Assign', [xs, later]),
      ce._fn('At', [ys, ce.number(2)]),
    ];
    expect(ownedLocalUpdateChains(statements, 'xs')).toBeUndefined();
    // Two nodes with the same operands are not shared, so the update is in
    // place and the read keeps the copying form.
    const other = ce._fn('ReplaceAt', [xs, ce.number(1), ce.number(0)]);
    statements[1] = ce._fn('Assign', [ys, other]);
    expect(ownedLocalUpdateChains(statements, 'xs')?.length).toBe(2);
  });

  describe('a list of lists', () => {
    ce.declare('M', 'list<list<real>>');
    const declareRows = ['Declare', 'ms', "'list<list<real>>'", 'M'];

    test('a write of a row in place does not change a row that a read holds', () => {
      const json = [
        'Block',
        declareRows,
        [
          'Declare',
          'r',
          "'list<real>'",
          ['Dictionary', ['KeyValuePair', "'value'", ['At', 'ms', 1]]],
        ],
        [
          'Assign',
          'ms',
          ['ReplaceAt', 'ms', 1, ['List', 7, 8]],
        ],
        ['Add', ['Sum', 'r'], ['Multiply', 100, ['Sum', ['At', 'ms', 1]]]],
      ];
      expect(codeOf(ce, json)).toContain('_SYS.replaceAtInPlace');
      expect(run(ce, json, { M: [[1, 2], [3, 4]] })).toBe(1503);
    });

    test('a copy with `ReplaceAt` shares rows, so a write of two positions stays a copy', () => {
      // `ys` shares the second row with `ms`. A write in place of that row
      // would change `ys`.
      const json = [
        'Block',
        declareRows,
        [
          'Declare',
          'ys',
          "'list<list<real>>'",
          ['ReplaceAt', 'ms', 1, ['List', 0, 0]],
        ],
        ['Assign', 'ms', ['ReplaceAt', 'ms', 2, 1, 9]],
        ['At', 'ys', 2, 1],
      ];
      expect(codeOf(ce, json)).not.toContain('InPlace');
      const M = [[1, 2], [3, 4]];
      expect(run(ce, json, { M })).toBe(3);
      expect(M).toEqual([[1, 2], [3, 4]]);
    });

    test('a read of a row stops a write of two positions in place', () => {
      const json = [
        'Block',
        declareRows,
        [
          'Declare',
          'r',
          "'list<real>'",
          ['Dictionary', ['KeyValuePair', "'value'", ['At', 'ms', 2]]],
        ],
        ['Assign', 'ms', ['ReplaceAt', 'ms', 2, 1, 9]],
        ['At', 'r', 1],
      ];
      expect(codeOf(ce, json)).not.toContain('InPlace');
      expect(run(ce, json, { M: [[1, 2], [3, 4]] })).toBe(3);
    });
  });

  test('a local that is not provably an indexed list keeps the copying form and its check', () => {
    ce.declare('LS', 'list<real> | set<real>');
    const json = [
      'Block',
      ['Declare', 'xs', "'list<real> | set<real>'", 'LS'],
      ['Loop', ['Assign', 'xs', ['ReplaceAt', 'xs', 'i', 0]], range],
      'xs',
    ];
    const code = codeOf(ce, json);
    expect(code).not.toContain('replaceAtInPlace');
    expect(code).toContain('_SYS.arr(xs, "ReplaceAt")');
  });

  test('a local declared any that holds a string is not compiled', () => {
    // A use does not narrow a local declared `any` (CE-444): `xs` is not
    // typed `indexed_collection<string>`, which a string is not. The
    // operand can then be text at run time, and the compiled list lowering
    // of `ReplaceAt` would read a string as UTF-16 code units, so the
    // compilation declines and the interpreter evaluates the block.
    ce.declare('S', 'string');
    const json = [
      'Block',
      ['Declare', 'xs', "'any'", 'S'],
      [
        'Loop',
        ['Assign', 'xs', ['ReplaceAt', 'xs', 'j', "'z'"]],
        ['Element', 'j', ['Range', 1, 2]],
      ],
      'xs',
    ];
    expect(() => compile(ce.box(json as never), { fallback: false })).toThrow(
      /ReplaceAt/
    );
    const block = ce.box(json as never);
    const value = block.subs({ S: ce.string('abc') }).evaluate();
    expect(value.toString()).toBe('["z","z","c"]');
    expect(block.type.toString()).toBe('any');
  });

  test('a function literal that reads the list keeps the copying form', () => {
    const json = [
      'Block',
      declare,
      ['Declare', 'f', "'function'", ['Function', ['Sum', 'xs']]],
      ['Loop', update, range],
      ['f'],
    ];
    expect(codeOf(ce, json)).not.toContain('replaceAtInPlace');
    expect(run(ce, json, { L: [1, 2, 3] })).toBe(12);
  });

  test('a statement shared by several branches is walked once', () => {
    // `B_k = If(c, B_(k-1), B_(k-1))` holds the SAME node object in its two
    // branches, so the statement has about `d` distinct nodes but `2^d`
    // paths. The walk of `ownedLocalUpdateChains` keeps its answer for each
    // node in a statement position, so it visits each node once and finds
    // the one `ReplaceAt` chain once. Without that memo, the walk at depth
    // 25 visits about 3·10⁷ nodes and finds the chain 2^25 times.
    const xs = ce.symbol('xs');
    const i = ce.symbol('i');
    let stmt = ce._fn('Assign', [
      xs,
      ce._fn('ReplaceAt', [xs, i, ce.number(0)]),
    ]);
    for (let k = 0; k < 25; k++)
      stmt = ce._fn('If', [ce.symbol('c'), stmt, stmt]);
    const start = performance.now();
    const chains = ownedLocalUpdateChains([stmt, xs], 'xs');
    expect(performance.now() - start).toBeLessThan(2000);
    expect(chains?.length).toBe(1);
  });
});
