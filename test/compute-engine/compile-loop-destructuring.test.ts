import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';
import { parseEpsil } from '../../src/epsil/parse-epsil';

import type { MathJsonExpression } from '../../src/math-json/types';

//
// The compilation tails of `docs/epsil/ROADMAP.md` ("Compilation tails"):
//
// - a DESTRUCTURING loop binder, `for (p, q) in pairs { … }`, on the
//   JavaScript and Python targets. The interpreter binds the pattern only to
//   a TUPLE of the pattern's arity and answers a shape-mismatch error value
//   for anything else (a list of the right length included); compiled code
//   cannot tell a tuple from a list, so the pattern compiles only when the
//   source's static element type proves tuples of the matching arity at
//   every nesting (`BaseCompiler.elementClauseBinders`).
// - the Python target's `Loop` over several `Element` clauses, over a
//   stepped or descending literal `Range`, and its `Comprehension` — which
//   previously emitted the JAVASCRIPT comprehension behind `success: true`.
// - a `Range` whose bound is provably not a number (the chained `1..10..2`
//   spelling, `Range(Range(1, 10), 2)`) declines on the JavaScript target
//   instead of emitting an empty range.
//

const ce = new ComputeEngine();
const python = new PythonTarget();

/** The MathJSON of an Epsil program, source offsets stripped. */
function epsil(source: string): MathJsonExpression {
  const [ast, diagnostics] = parseEpsil(source);
  expect(diagnostics).toEqual([]);
  return JSON.parse(
    JSON.stringify(ast, (k, v) => (k === 'sourceOffsets' ? undefined : v))
  );
}

/** Compile to JavaScript with no fallback and no constant folding, so the
 * lowering itself is what runs. */
function js(expr: MathJsonExpression) {
  return compile(ce.box(expr), { fallback: false, constantFold: false });
}

/** The interpreter's answer for the same program. */
function interpreted(expr: MathJsonExpression): string {
  return new ComputeEngine().box(expr).evaluate().toString();
}

describe('COMPILE Loop — destructuring binder (JavaScript)', () => {
  it('a list of pairs destructures, and agrees with the interpreter', () => {
    const program = epsil(
      'let s = 0\nfor (i, j) in [(1, 4), (2, 5), (3, 6)] { s = s + i * j }\ns'
    );
    const r = js(program);
    expect(r.success).toBe(true);
    expect(r.code).toContain('for (const [i, j] of');
    expect(r.run!({})).toBe(32);
    expect(interpreted(program)).toBe('32');
  });

  it('`Zip` types its elements as tuples, so its pairs destructure', () => {
    expect(
      ce.box(['Zip', ['Range', 1, 3], ['Range', 4, 6]]).type.toString()
    ).toBe('list<tuple<integer, integer>>');
    // A source whose element type is unknown keeps the bare `list`.
    expect(
      ce.box(['Zip', 'unknownSource', ['Range', 1, 3]]).type.toString()
    ).toBe('list');
    const program = epsil(
      'let s = 0\nfor (i, j) in Zip(1..3, 4..6) { s = s + i * j }\ns'
    );
    const r = js(program);
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(32);
    expect(interpreted(program)).toBe('32');
  });

  it('nested patterns and `_` positions', () => {
    const nested = epsil(
      'let s = 0\nfor ((a, b), c) in [((1, 2), 3), ((4, 5), 6)] { s = s + a * b * c }\ns'
    );
    const r = js(nested);
    expect(r.success).toBe(true);
    expect(r.code).toContain('for (const [[a, b], c] of');
    expect(r.run!({})).toBe(126);
    expect(interpreted(nested)).toBe('126');

    // `_` spells as an array hole and binds nothing.
    const skip = epsil(
      'let s = 0\nfor (i, _) in Zip(1..3, 4..6) { s = s + i }\ns'
    );
    const r2 = js(skip);
    expect(r2.success).toBe(true);
    expect(r2.code).toContain('for (const [i, ] of');
    expect(r2.run!({})).toBe(6);
  });

  it('fails closed unless the elements are provably tuples of the arity', () => {
    // Lists of the right length: the interpreter refuses them, compiled code
    // could not.
    expect(() =>
      js(
        epsil('let s = 0\nfor (i, j) in [[1, 4], [2, 5]] { s = s + i * j }\ns')
      )
    ).toThrow(/not a tuple/);
    // Arity mismatch.
    expect(() =>
      js(epsil('let s = 0\nfor (i, j) in [(1, 2, 3)] { s = s + i }\ns'))
    ).toThrow(/2 positions but the elements are tuples of 3/);
    // Unknown element type.
    expect(() =>
      js(epsil('let s = 0\nfor (i, j) in xs { s = s + i }\ns'))
    ).toThrow(/type `unknown`, not a tuple/);
    // A nested pattern over a component that is not itself a tuple.
    expect(() =>
      js(epsil('let s = 0\nfor ((a, b), c) in [(1, 2)] { s = s + a }\ns'))
    ).toThrow(/not a tuple/);
  });

  it('a comprehension binder destructures too', () => {
    const r = js([
      'Comprehension',
      ['Multiply', 'p', 'q'],
      [
        'Element',
        ['Tuple', 'p', 'q'],
        ['List', ['Tuple', 1, 4], ['Tuple', 2, 5]],
      ],
    ]);
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual([4, 10]);
  });
});

describe('COMPILE Range — a bound that is provably not a number fails closed', () => {
  it('the chained `1..10..2` spelling declines instead of emitting an empty range', () => {
    // `1..10..2` parses as `Range(Range(1, 10), 2)`, which the interpreter
    // leaves inert; the arithmetic lowering coerced the inner array to NaN
    // and emitted `[]` behind `success: true`.
    expect(() => js(epsil('Sum(1..10..2)'))).toThrow(
      /Range: the bound .* not a number|invalid expression/
    );
    // The three-operand form is the stepped range, and still compiles.
    const r = js(epsil('Sum(Range(1, 10, 2))'));
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(25);
  });
});

describe('COMPILE Loop / Comprehension — Python target', () => {
  // A statement-shaped program (a `Block` with a loop) has no Python
  // EXPRESSION form; the `def` route is the one that emits it. A bare
  // `Comprehension` is an expression and takes the source route.
  const py = (expr: MathJsonExpression): string => {
    const boxed = ce.box(expr);
    return boxed.operator === 'Block'
      ? python.compileFunction(boxed, 'fn', [], undefined, {
          constantFold: false,
        })
      : python.compileToSource(boxed, { constantFold: false });
  };

  it('several Element clauses nest one `for` under another', () => {
    const src = py([
      'Block',
      ['Declare', 's', ['Dictionary', ['KeyValuePair', 'value', 0]]],
      [
        'Loop',
        ['Block', ['Assign', 's', ['Add', 's', ['Multiply', 'i', 'j']]]],
        ['Element', 'i', ['Range', 1, 3]],
        ['Element', 'j', ['Range', 1, 2]],
      ],
      's',
    ]);
    expect(src).toMatch(
      /for i in range\(1, 4\):\n\s+for j in range\(1, 3\):\n\s+s =/
    );
  });

  it('a stepped or descending literal Range is a native `range`', () => {
    expect(
      py(epsil('let s = 0\nfor k in Range(1, 10, 3) { s = s + k }\ns'))
    ).toContain('for k in range(1, 11, 3):');
    expect(
      py(epsil('let s = 0\nfor k in Range(10, 1, -3) { s = s + k }\ns'))
    ).toContain('for k in range(10, 0, -3):');
    expect(py(epsil('let s = 0\nfor k in 10..1 { s = s + k }\ns'))).toContain(
      'for k in range(10, 0, -1):'
    );
  });

  it('a destructuring binder spells as a tuple pattern', () => {
    expect(
      py(
        epsil('let s = 0\nfor (i, j) in [(1, 4), (2, 5)] { s = s + i * j }\ns')
      )
    ).toContain('for (i, j) in [(1, 4), (2, 5)]:');
    expect(() =>
      py(
        epsil('let s = 0\nfor (i, j) in [[1, 4], [2, 5]] { s = s + i * j }\ns')
      )
    ).toThrow(/not a tuple/);
  });

  it('a Comprehension is a list comprehension, not the JavaScript IIFE', () => {
    expect(
      py([
        'Comprehension',
        ['Multiply', 'i', 'j'],
        ['Element', 'i', ['Range', 1, 3]],
        ['Element', 'j', ['Range', 1, 2]],
      ])
    ).toBe('[i * j for i in range(1, 4) for j in range(1, 3)]');
    expect(
      py([
        'Comprehension',
        ['Multiply', 'x', 2],
        ['Element', 'x', ['List', 1, 2, 3]],
      ])
    ).toBe('[2 * x for x in [1, 2, 3]]');
    // A multi-statement body has no list-comprehension form.
    expect(() =>
      py([
        'Comprehension',
        [
          'Block',
          ['Declare', 'y', ['Dictionary', ['KeyValuePair', 'value', 'x']]],
          ['Multiply', 'y', 2],
        ],
        ['Element', 'x', ['List', 1, 2, 3]],
      ])
    ).toThrow(/multi-statement body/);
  });
});

describe('COMPILE Loop — shapes that fail closed on both targets (review pins)', () => {
  const py = (expr: MathJsonExpression): string =>
    python.compileFunction(ce.box(expr), 'fn', [], undefined, {
      constantFold: false,
    });
  const loopOver = (
    binder: MathJsonExpression,
    source: MathJsonExpression,
    body: MathJsonExpression = ['Assign', 's', ['Add', 's', 1]]
  ): MathJsonExpression => [
    'Block',
    ['Declare', 's', ['Dictionary', ['KeyValuePair', 'value', 0]]],
    ['Loop', ['Block', body], ['Element', binder, source]],
    's',
  ];

  it('a `break` under several Element clauses declines: it would leave only the innermost loop', () => {
    const program: MathJsonExpression = [
      'Block',
      ['Declare', 's', ['Dictionary', ['KeyValuePair', 'value', 0]]],
      [
        'Loop',
        ['Block', ['Assign', 's', ['Add', 's', 1]], ['Break']],
        ['Element', 'i', ['Range', 1, 3]],
        ['Element', 'j', ['Range', 1, 3]],
      ],
      's',
    ];
    expect(() => js(program)).toThrow(/stops the whole loop/);
    expect(() => py(program)).toThrow(/stops the whole loop/);
    // The interpreter stops the whole traversal: one turn, not three.
    expect(interpreted(program)).toBe('1');
  });

  it('a name bound twice in one pattern declines', () => {
    const program = loopOver(['Tuple', 'a', 'a'], ['List', ['Tuple', 1, 2]]);
    expect(() => js(program)).toThrow(/more than once/);
    expect(() => py(program)).toThrow(/more than once/);
  });

  it('a one-position Python pattern keeps its trailing comma', () => {
    const program = loopOver(
      ['Tuple', 'x'],
      ['List', ['Tuple', 1], ['Tuple', 2]],
      ['Assign', 's', ['Add', 's', 'x']]
    );
    expect(py(program)).toContain('for (x,) in');
    expect(js(program).run!({})).toBe(3);
  });

  it('a `_` position is a generated temporary in Python, never the name `_`', () => {
    const src = py(
      epsil('let s = 0\nfor (i, _) in [(1, 4), (2, 5)] { s = s + i }\ns')
    );
    expect(src).toMatch(/for \(i, _tv\d+\) in/);
    expect(src).not.toContain('(i, _)');
  });

  it('a string source declines on Python (grapheme clusters)', () => {
    expect(() =>
      py(epsil('let s = 0\nfor c in "abc" { s = s + 1 }\ns'))
    ).toThrow(/grapheme/);
  });

  it('a symbolic two-bound Range picks its direction at run time on Python', () => {
    const src = python.compileFunction(
      ce.box(epsil('let s = 0\nfor k in Range(a, b) { s = s + k }\ns')),
      'fn',
      ['a', 'b'],
      undefined,
      { constantFold: false }
    );
    expect(src).toContain(
      'range(_a, _b + 1) if _b >= _a else range(_a, _b - 1, -1)'
    );
  });

  it('a statement-shaped comprehension body declines on Python', () => {
    for (const body of [
      ['Assign', 's', 'x'],
      ['Break'],
      ['Block', ['Assign', 's', 'x']],
    ])
      expect(() =>
        python.compileToSource(
          ce.box([
            'Comprehension',
            body as MathJsonExpression,
            ['Element', 'x', ['List', 1, 2]],
          ]),
          { constantFold: false }
        )
      ).toThrow(/statement|declaration/);
  });

  it('a non-numeric Range bound declines on every operand count', () => {
    // A bound canonicalization lets through but whose static type is a
    // collection (a boolean or string bound is already an invalid
    // expression before the compiler sees it).
    // A range as a bound is provably not a number, so boxing already wraps
    // it in an `incompatible-type` error and the compiler refuses the
    // invalid expression; a bound the types cannot refute still reaches
    // the compiler's own bound check.
    expect(() => js(['Range', ['Range', 1, 10]])).toThrow(
      /not a number|invalid expression/
    );
    expect(() => js(['Range', ['Range', 1, 10], 2])).toThrow(
      /not a number|invalid expression/
    );
  });

  it('a destructuring binder declines on the interval target', () => {
    const r = new IntervalJavaScriptTarget().compile(
      ce.box(
        loopOver(
          ['Tuple', 'a', 'b'],
          ['List', ['Tuple', 1, 2]],
          ['Assign', 's', ['Add', 's', 'a']]
        )
      )
    );
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Execution parity: run the emitted Python and compare with the interpreter
// (the harness of `compile-python-arity.test.ts`; skipped without the venv).
// ---------------------------------------------------------------------------

const VENV_PYTHON =
  [
    path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
    path.join(process.cwd(), 'venv', 'bin', 'python3'),
  ].find((p) => fs.existsSync(p)) ??
  path.join(process.cwd(), 'venv', 'bin', 'python3');

// None of the cases below lowers through numpy, so the block needs only the
// venv's Python itself.
const describeVenv = fs.existsSync(VENV_PYTHON) ? describe : describe.skip;

describeVenv(
  'COMPILE Loop / Comprehension — Python execution parity (venv)',
  () => {
    const CASES: Array<{
      name: string;
      expr: MathJsonExpression;
      expected: unknown;
    }> = [
      {
        name: 'nested loops',
        expr: epsil(
          'let s = 0\nfor i in 1..3 { for j in 1..2 { s = s + i * j } }\ns'
        ),
        expected: 18,
      },
      {
        name: 'descending stepped range',
        expr: epsil('let s = 0\nfor k in Range(10, 1, -3) { s = s + k }\ns'),
        expected: 22,
      },
      {
        name: 'destructuring',
        expr: epsil(
          'let s = 0\nfor (i, j) in [(1, 4), (2, 5), (3, 6)] { s = s + i * j }\ns'
        ),
        expected: 32,
      },
      {
        name: 'comprehension',
        expr: [
          'Comprehension',
          ['Multiply', 'i', 'j'],
          ['Element', 'i', ['Range', 1, 3]],
          ['Element', 'j', ['Range', 1, 2]],
        ],
        expected: [1, 2, 2, 4, 3, 6],
      },
    ];

    it('the emitted Python evaluates to the interpreter value', () => {
      let program = 'import cmath, math, json\n\n';
      CASES.forEach((c, i) => {
        program += `${python.compileFunction(ce.box(c.expr), `fn_${i}`, [])}\n`;
      });
      program += 'results = []\n';
      CASES.forEach((_c, i) => {
        program += `results.append(fn_${i}())\n`;
      });
      program += 'print(json.dumps(results))\n';

      const file = path.join(os.tmpdir(), `ce-py-loops-${process.pid}.py`);
      fs.writeFileSync(file, program);
      let out = '';
      try {
        out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
      } finally {
        fs.unlinkSync(file);
      }
      const actual = JSON.parse(out) as unknown[];
      CASES.forEach((c, i) => {
        expect([c.name, actual[i]]).toEqual([c.name, c.expected]);
        expect(interpreted(c.expr)).toBe(
          Array.isArray(c.expected)
            ? `[${c.expected.join(',')}]`
            : String(c.expected)
        );
      });
    });
  }
);
