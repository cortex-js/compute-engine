/**
 * A `Function` literal applied to a collection on the Python target.
 *
 * The emitted call `(lambda t: …)(arg)` binds the argument whole, and the
 * body reads a parameter that is not declared with a collection type as a
 * scalar. The Python operators do not map over a list: `2 * [[1, 2], [3, 4]]`
 * repeats the list. The interpreter gives `[[2, 4], [6, 8]]` for
 * `((t) ↦ 2t)([[1, 2], [3, 4]])`: it maps the function over the elements
 * at a scalar parameter (no declaration, `unknown`, `number`), and binds the
 * collection whole at a parameter declared `any` or `value`, where each
 * element-wise operator of the body maps over it. The Python target
 * compiled the call to `((lambda t: 2 * t))([[1, 2], [3, 4]])` and gave
 * `[[1, 2], [3, 4], [1, 2], [3, 4]]`. At a scalar parameter, the static
 * type of the argument now selects a map of the call over the list, a
 * nested comprehension of the depth of the list,
 * `[[f(e) for e in r] for r in L]`, which gives the interpreter value
 * (rule R2 of `docs/plans/2026-10-31-static-shape-compilation.md`). A call
 * that binds a collection whole at a parameter declared `any` or `value`
 * is still declined (`assertPyAppliedLiteralBindsScalars` in
 * `python-target.ts`), and the interpreter evaluates it. A callback (`Map`, `Reduce`, …) with a
 * parameter declared `any` or `value` that receives a collection is declined
 * for the same reason (`assertPyCallbackWideParams`).
 */

import { execFileSync } from 'node:child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';

const NESTED = ['List', ['List', 1, 2], ['List', 3, 4]];

const param = (type: string | undefined): unknown =>
  type === undefined ? 't' : ['Typed', 't', `'${type}'`];

function compilePython(json: unknown) {
  const ce = new ComputeEngine();
  const expr = ce.box(json as never);
  const result = compile(expr, {
    to: 'python',
    constantFold: false,
  } as never)!;
  return { expr, result };
}

/** The value of the Python expression `code`, printed with `repr`. */
function runPython(code: string): string {
  return execFileSync(
    TEST_PYTHON!,
    ['-c', `import numpy as np\nprint(repr(${code}))`],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
    .toString()
    .trim();
}

/** The numbers of a number or of a nested list of numbers of the engine. */
function numbersOf(e: any): unknown {
  return e.ops !== undefined && e.operator === 'List'
    ? e.ops.map(numbersOf)
    : e.re;
}

/**
 * The compiled call is a map over the list (a comprehension), and, when
 * Python is available, its value is the interpreter value.
 */
function expectMappedValue(json: unknown): void {
  const { expr, result } = compilePython(json);
  expect(result.success).toBe(true);
  expect(result.code).toMatch(/\[.* for _tv\d+ in _tv\d+\]/);
  if (TEST_PYTHON === undefined) return;
  const value = JSON.parse(runPython(result.code).replace(/'/g, '"'));
  expect(value).toEqual(numbersOf(expr.evaluate().N()));
}

describe('PYTHON: A FUNCTION LITERAL APPLIED TO A COLLECTION', () => {
  const PARAMS: Array<[string, string | undefined]> = [
    ['no declaration', undefined],
    ['unknown', 'unknown'],
    ['number', 'number'],
    ['any', 'any'],
    ['value', 'value'],
  ];
  const BODIES: Array<[string, unknown, string]> = [
    ['Multiply', ['Multiply', 2, 't'], '[[2,4],[6,8]]'],
    ['Add', ['Add', 't', 1], '[[2,3],[4,5]]'],
    ['Subtract', ['Subtract', 't', 1], '[[0,1],[2,3]]'],
    ['Divide', ['Divide', 't', 2], '[[1/2,1],[3/2,2]]'],
    ['Negate', ['Negate', 't'], '[[-1,-2],[-3,-4]]'],
  ];
  // A parameter with no declaration, `unknown` or `number` is a scalar
  // parameter: the call maps over the nested list.
  for (const [label, type] of PARAMS.slice(0, 3)) {
    test.each(BODIES)(
      `%s over a nested list at a parameter with ${label} is mapped`,
      (_, body, value) => {
        const json = ['Apply', ['Function', body, param(type)], NESTED];
        expect(compilePython(json).expr.evaluate().toString()).toBe(value);
        expectMappedValue(json);
      }
    );
  }

  // A parameter declared `any` or `value` binds the list whole, and the
  // Python operators do not map over it.
  for (const [label, type] of PARAMS.slice(3)) {
    test.each(BODIES)(
      `%s over a nested list at a parameter with ${label} is declined`,
      (_, body, value) => {
        const { expr, result } = compilePython([
          'Apply',
          ['Function', body, param(type)],
          NESTED,
        ]);
        expect(expr.evaluate().toString()).toBe(value);
        expect(result.success).toBe(false);
      }
    );
  }

  // A scalar parameter maps the function even when the body does not read
  // the parameter: the interpreter gives `[1, 1]`, not `1`.
  test('a constant body at a parameter with no declaration is mapped', () => {
    const json = ['Apply', ['Function', 1, 't'], ['List', 1, 2]];
    expect(compilePython(json).expr.evaluate().toString()).toBe('[1,1]');
    expectMappedValue(json);
  });

  test('a list at one parameter of two is mapped, the other is reused', () => {
    const json = [
      'Apply',
      ['Function', ['Add', 't', 's'], 't', 's'],
      ['List', 1, 2],
      10,
    ];
    expect(compilePython(json).expr.evaluate().toString()).toBe('[11,12]');
    expectMappedValue(json);
  });

  // The cases that still compile.
  const COMPILED: Array<[string, unknown, string, string]> = [
    [
      'a constant body at a parameter declared any',
      ['Apply', ['Function', 1, param('any')], ['List', 1, 2]],
      '((lambda t: 1))([1, 2])',
      '1',
    ],
    [
      'a scalar argument at a parameter declared any',
      ['Apply', ['Function', ['Multiply', 2, 't'], param('any')], 3],
      '((lambda t: 2 * t))(3)',
      '6',
    ],
    [
      'a scalar argument at a parameter with no declaration',
      ['Apply', ['Function', ['Multiply', 2, 't'], 't'], 3],
      '((lambda t: 2 * t))(3)',
      '6',
    ],
    [
      'a list at a parameter declared list<number>',
      [
        'Apply',
        ['Function', ['Multiply', 2, 't'], param('list<number>')],
        ['List', 1, 2],
      ],
      '((lambda t: [2 * _tv1 for _tv1 in t]))([1, 2])',
      '[2, 4]',
    ],
    [
      'a string at a parameter declared string',
      ['Apply', ['Function', 't', param('string')], "'abc'"],
      '((lambda t: t))("abc")',
      "'abc'",
    ],
    [
      'ApplyWhole of a constant body to a list',
      ['ApplyWhole', ['Function', 1, 't'], ['List', 1, 2]],
      '((lambda t: 1))([1, 2])',
      '1',
    ],
    // `Apply` and `ApplyWhole` bind the tuple whole, and the compiled code
    // gives the parameter the type of its argument,
    // `tuple<integer, integer>`. `At` then reads a tuple, not a value that
    // can be a string.
    ...(['Apply', 'ApplyWhole'] as const).map(
      (head): [string, unknown, string, string] => [
        `${head} of At of a tuple at a parameter with no declaration`,
        [head, ['Function', ['At', 'p', 1], 'p'], ['Tuple', 1, 2]],
        "((lambda p: (lambda _l, _i: (float('nan') if _l is None else float('nan')) if not isinstance(_l, (list, tuple, np.ndarray)) else (_l[int(_i) - 1] if 1 <= _i <= len(_l) else (_l[int(_i)] if -len(_l) <= _i <= -1 else float('nan'))))(p, 1)))((1, 2))",
        '1',
      ]
    ),
  ];
  test.each(COMPILED)('%s compiles', (_, json, code, value) => {
    const { result } = compilePython(json);
    expect(result.success).toBe(true);
    expect(result.code).toBe(code);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(result.code)).toBe(value);
  });

  // A string and a tuple are bound whole, and a body that reads the
  // parameter is declined: the Python operators repeat or concatenate a
  // string or a tuple (`2 * "abc"` is `"abcabc"`), and a tuple whose
  // component is a list (`2 * (1, 2)[0]` with `p[0] = [1, 2]`) is not
  // mapped as the interpreter maps it. The interpreter evaluates the call.
  // (A tuple of numbers gives its type to the parameter, and the call
  // compiles: see the cases that compile, above.)
  const WHOLE: Array<[string, unknown, string]> = [
    [
      'a string at a parameter with no declaration',
      ['Apply', ['Function', 't', 't'], "'abc'"],
      '"abc"',
    ],
    [
      'a string at a parameter declared any',
      ['Apply', ['Function', 't', param('any')], "'abc'"],
      '"abc"',
    ],
    [
      '2 At(p, 1) of a tuple whose component is a list',
      [
        'Apply',
        ['Function', ['Multiply', 2, ['At', 'p', 1]], 'p'],
        ['Tuple', ['List', 1, 2], 0],
      ],
      '[2,4]',
    ],
  ];
  test.each(WHOLE)('%s is declined', (_, json, value) => {
    const { expr, result } = compilePython(json);
    expect(expr.evaluate().toString()).toBe(value);
    expect(result.success).toBe(false);
  });

  // The interpreter maps `2t` over the components of the tuple; the lambda
  // `2 * t` repeats the tuple.
  test.each([['Apply'], ['ApplyWhole']])(
    '%s of 2t to a tuple is declined',
    (head) => {
      const { expr, result } = compilePython([
        head,
        ['Function', ['Multiply', 2, 't'], 't'],
        ['Tuple', 1, 2],
      ]);
      expect(expr.evaluate().toString()).toBe('(2, 4)');
      expect(result.success).toBe(false);
    }
  );

  // The call of a symbol whose value is the literal was declined before
  // this change, and stays declined.
  test.each([['any'], ['value'], [undefined]])(
    'a call of a symbol assigned the literal (parameter %s) is declined',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('W', 'function');
      ce.assign(
        'W',
        ce.box(['Function', ['Multiply', 2, 't'], param(type)] as never)
      );
      const expr = ce.box(['W', NESTED] as never);
      expect(expr.evaluate().toString()).toBe('[[2,4],[6,8]]');
      const result = compile(expr, {
        to: 'python',
        constantFold: false,
      } as never)!;
      expect(result.success).toBe(false);
    }
  );

  // `ApplyWhole` binds the list whole: the body reads it as a scalar.
  test('ApplyWhole of a body that reads a nested list is declined', () => {
    const { expr, result } = compilePython([
      'ApplyWhole',
      ['Function', ['Multiply', 2, 't'], 't'],
      NESTED,
    ]);
    expect(expr.evaluate().toString()).toBe('[[2,4],[6,8]]');
    expect(result.success).toBe(false);
  });
});

describe('PYTHON: A CALLBACK PARAMETER DECLARED ANY OR VALUE', () => {
  test.each([['any'], ['value']])(
    'Map over a nested list at a parameter declared %s is declined',
    (type) => {
      const { expr, result } = compilePython([
        'Map',
        ['Function', ['Multiply', 2, 't'], param(type)],
        NESTED,
      ]);
      expect(expr.evaluate().toString()).toBe('[[2,4],[6,8]]');
      expect(result.success).toBe(false);
    }
  );

  test('Reduce over a nested list at a parameter declared any is declined', () => {
    const { expr, result } = compilePython([
      'Reduce',
      NESTED,
      ['Function', ['Add', 'a', 't'], 'a', param('any')],
      0,
    ]);
    expect(expr.evaluate().toString()).toBe('[4,6]');
    expect(result.success).toBe(false);
  });

  // A tuple is bound whole: `a + t` adds the tuples component-wise in the
  // interpreter, and concatenates them in Python.
  test('Reduce over a list of tuples at a parameter declared any is declined', () => {
    const { expr, result } = compilePython([
      'Reduce',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['Function', ['Add', 'a', 't'], 'a', param('any')],
      ['Tuple', 0, 0],
    ]);
    expect(expr.evaluate().toString()).toBe('(4, 6)');
    expect(result.success).toBe(false);
  });

  test('Map over a list of numbers at a parameter declared any compiles', () => {
    const { result } = compilePython([
      'Map',
      ['Function', ['Multiply', 2, 't'], param('any')],
      ['List', 1, 2],
    ]);
    expect(result.success).toBe(true);
    expect(result.code).toBe(
      '(lambda _f: [_f(_x) for _x in [1, 2]])((lambda t: 2 * t))'
    );
    if (TEST_PYTHON === undefined) return;
    expect(runPython(result.code)).toBe('[2, 4]');
  });
});

// The accumulator of a fold receives the seed on the first step and the
// step's own result on the next steps. The signature of the step keeps an
// accumulator with no declaration `unknown`, and the emitted lambda read it
// as a scalar: `Reduce([[1, 2], [3, 4]], (a, t) ↦ a + t, 0)` compiled to
// `functools.reduce((lambda a, t: [a + _tv1 for _tv1 in t]), …, 0)`, whose
// second step raises a `TypeError`. The interpreter gives `[4, 6]`.
describe('PYTHON: A FOLD ACCUMULATOR THAT CAN BE A COLLECTION', () => {
  const STEP = ['Function', ['Add', 'a', 't'], 'a', 't'];
  test.each([
    ['Reduce with the seed 0', ['Reduce', NESTED, STEP, 0], '[4,6]'],
    [
      'Reduce with the seed [0, 0]',
      ['Reduce', NESTED, STEP, ['List', 0, 0]],
      '[4,6]',
    ],
    ['Reduce with no seed', ['Reduce', NESTED, STEP], '[4,6]'],
    ['Fold with the seed 0', ['Fold', STEP, 0, NESTED], '[4,6]'],
  ])('%s is declined', (_, json, value) => {
    const { expr, result } = compilePython(json);
    expect(expr.evaluate().toString()).toBe(value);
    expect(result.success).toBe(false);
  });

  test.each([
    ['with the seed 0', ['Scan', NESTED, STEP, 0]],
    ['with no seed', ['Scan', NESTED, STEP]],
  ])('Scan %s is declined', (_, json) => {
    expect(compilePython(json).result.success).toBe(false);
  });

  const COMPILED: Array<[string, unknown, string, string]> = [
    [
      'Reduce of a list of numbers',
      ['Reduce', ['List', 1, 2, 3], STEP, 0],
      "__import__('functools').reduce((lambda a, t: a + t), [1, 2, 3], 0)",
      '6',
    ],
    [
      'Reduce whose accumulator is typed a list from its uses',
      [
        'Reduce',
        NESTED,
        ['Function', ['Join', 'a', 't'], 'a', 't'],
        ['List'],
      ],
      "__import__('functools').reduce((lambda a, t: [*a, *t]), [[1, 2], [3, 4]], [])",
      '[1, 2, 3, 4]',
    ],
  ];
  test.each(COMPILED)('%s compiles', (_, json, code, value) => {
    const { result } = compilePython(json);
    expect(result.success).toBe(true);
    expect(result.code).toBe(code);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(result.code)).toBe(value);
  });
});
