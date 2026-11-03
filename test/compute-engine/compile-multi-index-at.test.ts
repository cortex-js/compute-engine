/**
 * A chained access `At(R, i, j)` (`R[i, j]`) compiles as the nested access
 * `At(At(R, i), j)`.
 *
 * The `evaluate` handler of `At` reads the indices one at a time, and each
 * index applies to the value that the index before it selected. The `At`
 * lowerings of every target compiled only the single-index form, so
 * `R[1, 2]`, `R[1, 1] + 1` and the call `h2(R[1, 1])` of an engine-level
 * function declined with "only the single-index form compiles", in the
 * modes `auto` and `strict`. The compiler now rewrites the chain to the
 * nested access before it calls the lowering of a target.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';

/** The declared type of `R` and the value given to it. */
const BASES: [string, unknown[]][] = [
  [
    'matrix<real^2x2>',
    [
      [1, 2],
      [3, 4],
    ],
  ],
  [
    'list<list<real>>',
    [
      [1, 2],
      [3, 4],
    ],
  ],
  [
    'tensor<real^2x2x2>',
    [
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
      ],
    ],
  ],
];

const READS: unknown[] = [
  ['At', 'R', 1, 2],
  ['At', 'R', 2, 1],
  ['At', 'R', -1, -1],
  ['At', 'R', 'n', 1],
  ['At', 'R', 1, 3],
  ['At', 'R', ['List', 2, 1], 1],
  ['Add', ['At', 'R', 1, 1], 1],
  ['h2', ['At', 'R', 1, 1]],
  ['h3', ['At', 'R', 1]],
];

/** An engine with `R` and `n` declared, and the functions of the calls. */
function engine(type: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('h2', ce.box(['Function', ['Add', 'p', 1], 'p'] as never));
  ce.assign('h3', ce.box(['Function', ['At', 'p', 2], 'p'] as never));
  ce.declare('R', type);
  ce.declare('n', 'integer');
  return ce;
}

function listJson(v: unknown): unknown {
  return Array.isArray(v) ? ['List', ...v.map(listJson)] : v;
}

/**
 * The interpreter's value as a JavaScript value: `NaN` for the numeric
 * absence marker and the string `'Missing'` for the other one.
 */
function interpreted(type: string, value: unknown, json: unknown): unknown {
  const ce = engine(type);
  ce.assign('R', ce.box(listJson(value) as never));
  ce.assign('n', 2);
  const v = ce.box(json as never).evaluate();
  return plainJson(v.json);
}

/** A MathJSON value as a JavaScript value: a list is an array. */
function plainJson(j: unknown): unknown {
  if (j === 'NaN') return NaN;
  if (Array.isArray(j) && j[0] === 'List') return j.slice(1).map(plainJson);
  return j;
}

/** A compiled value: an absent row (`undefined`) is `'Missing'`. */
function plain(v: unknown): unknown {
  if (v === undefined) return 'Missing';
  return Array.isArray(v) ? v.map(plain) : v;
}

describe('JavaScript: a chained At compiles as the nested access', () => {
  for (const [type, value] of BASES)
    for (const mode of ['complex', 'strict'] as const)
      test.each(READS.map((json) => [JSON.stringify(json), json]))(
        `${type}, ${mode}: %s`,
        (label, json) => {
          const ce = engine(type);
          // A read proved out of range in a base of static shape declines:
          // the chained access `R[1, 3]` is typed `real` (the absence marker
          // is implicit in the type of a read), and the nested access
          // `R[1][3]` is typed `nan`, which is not a subtype of `real`. The
          // interpreter gives `NaN`.
          if (label === '["At","R",1,3]' && type !== 'list<list<real>>') {
            expect(() =>
              compile(ce.box(json as never), { fallback: false, mode })
            ).toThrow(/not a subtype/);
            return;
          }
          const r = compile(ce.box(json as never), {
            fallback: false,
            mode,
          })!;
          expect(r.success).toBe(true);
          expect(plain(r.run!({ R: value, n: 2 }))).toEqual(
            interpreted(type, value, json)
          );
        }
      );
});

describe('A chained read whose nested type is not a subtype of its type', () => {
  // The `At` type handler gives some chained reads through a tuple, a record
  // or a dictionary a type that is not the type of their value: with
  // `t: tuple<list<real>, real>`, `At(t, 1, 2)` is typed `list<real>`, and
  // its value is the real number `2`. The `Add` parent chooses its lowering
  // from that type, so the compiler declines instead of compiling the
  // nested read `At(At(t, 1), 2)`, whose type is `nan | real`.
  test.each([
    ['tuple<list<real>, real>', 't', ['At', 't', 1, 2]],
    ['record{a: list<real>}', 'r', ['At', 'r', { str: 'a' }, 1]],
    ['list<record{a: real}>', 'L', ['At', 'L', 1, { str: 'a' }]],
  ] as const)('%s', (type, name, read) => {
    const ce = new ComputeEngine();
    ce.declare(name, type);
    for (const mode of ['complex', 'strict'] as const)
      expect(() =>
        compile(ce.box(['Add', read, 1] as never), { fallback: false, mode })
      ).toThrow(/Could not compile/);
  });

  test('a chained type `unknown` is no evidence of a shape', () => {
    // Every type matches `unknown`. `At(tl, i, 2, j)` is typed `unknown`,
    // and its first nested step `At(At(tl, i), 2)` is typed
    // `list<real> | missing`.
    const ce = new ComputeEngine();
    ce.declare('tl', 'list<tuple<real, list<real>>>');
    ce.declare('i', 'integer');
    ce.declare('j', 'integer');
    const read = ce.box(['At', 'tl', 'i', 2, 'j'] as never);
    expect(read.type.toString()).toBe('unknown');
    expect(() => compile(read, { fallback: false })).toThrow(
      /The first type gives no shape/
    );
  });
});

describe('Python: an index that is a collection declines', () => {
  // The Python lowering of `At` reads a scalar index only. It compared the
  // list index `[2, 1]` with integers and raised a `TypeError` at run time.
  // The interpreter reads the gather.
  test.each([
    [['At', 'R', ['List', 2, 1]]],
    [['At', 'R', ['List', 2, 1], 1]],
    [['At', 'R', ['List', 'True', 'False']]],
  ])('%j', (json) => {
    const ce = engine('list<list<real>>');
    expect(() =>
      new PythonTarget().compileFunction(ce.box(json as never), 'f', ['R'])
    ).toThrow(/the index .* is or may be a collection/);
  });

  test('a `broadcastable<integer>` index', () => {
    // A `broadcastable<integer>` value is an integer or a list of integers
    // at run time, and it is not a subtype of `collection`.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('bi', 'broadcastable<integer>');
    expect(() =>
      new PythonTarget().compileFunction(
        ce.box(['At', 'L', 'bi'] as never),
        'f',
        ['L', 'bi']
      )
    ).toThrow(/the index .* is or may be a collection/);
    // A scalar integer index still compiles.
    ce.declare('i', 'integer');
    expect(() =>
      new PythonTarget().compileFunction(
        ce.box(['At', 'L', 'i'] as never),
        'f',
        ['L', 'i']
      )
    ).not.toThrow();
  });
});

describe('The interval target compiles a chained At', () => {
  test.each(BASES.map(([t]) => [t]))('%s', (type) => {
    const ce = engine(type);
    const r = compile(ce.box(['At', 'R', 1, 2] as never), {
      to: 'interval-js',
      fallback: false,
    })!;
    expect(r.success).toBe(true);
    expect(r.code).toContain('_IA.at(_IA.at(_.R, _k1), _k2)');
  });
});

describe('Shader targets read a chained At as the nested access', () => {
  // A shader target has no lowering for an index into a multi-axis base or
  // into a list with no static length. The decline is the one of the nested
  // access `R[1][2]`, not the decline of the multi-index form.
  test.each([
    ['glsl', 'matrix<real^2x2>', /multi-axis/],
    ['wgsl', 'matrix<real^2x2>', /multi-axis/],
    ['glsl', 'list<list<real>>', /no statically known length/],
    ['wgsl', 'list<list<real>>', /no statically known length/],
  ] as const)('%s, %s', (to, type, message) => {
    const ce = engine(type);
    expect(() =>
      compile(ce.box(['At', 'R', 1, 2] as never), { to, fallback: false })
    ).toThrow(message);
  });
});

function pythonHasNumpy(): boolean {
  try {
    if (TEST_PYTHON === undefined || !fs.existsSync(TEST_PYTHON)) return false;
    execFileSync(TEST_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const describePython = pythonHasNumpy() ? describe : describe.skip;

describePython('Python: a chained At compiles as the nested access', () => {
  // Python has no lowering of a call of an engine-level function, and no
  // arithmetic on a row, so only the reads are compiled here. The gather
  // `R[[2, 1], 1]` declines on Python (see the test below).
  test.each(BASES.map(([t, v]) => [t, v]))('%s', (type, value) => {
    // A read proved out of range in a base of static shape declines, as on
    // JavaScript: the chained access `R[1, 3]` has the static type of an
    // element, and the nested access `R[1][3]` has the type of the absence
    // marker (`nan` or `missing`), which is not a subtype of it.
    let reads = READS.slice(0, 5);
    if (type !== 'list<list<real>>') {
      const outOfRange = ['At', 'R', 1, 3];
      expect(() =>
        new PythonTarget().compileFunction(
          engine(type).box(outOfRange as never),
          'g',
          ['R', 'n']
        )
      ).toThrow(/not a subtype/);
      reads = reads.filter(
        (r) => JSON.stringify(r) !== JSON.stringify(outOfRange)
      );
    }
    const lines: string[] = ['import numpy as np', 'import math'];
    const expected: string[] = [];
    reads.forEach((json, i) => {
      const ce = engine(type);
      lines.push(
        new PythonTarget().compileFunction(ce.box(json as never), `f${i}`, [
          'R',
          'n',
        ]),
        `_r = f${i}(${JSON.stringify(value)}, 2)`,
        `print(__import__('json').dumps(_r if not (isinstance(_r, float) and math.isnan(_r)) else 'nan'))`
      );
      const v = interpreted(type, value, json);
      expected.push(
        JSON.stringify(
          typeof v === 'number' && Number.isNaN(v)
            ? 'nan'
            : v === 'Missing'
              ? null
              : v
        )
      );
    });
    const out = execFileSync(TEST_PYTHON!, ['-c', lines.join('\n')], {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .map((line) => JSON.stringify(JSON.parse(line)));
    expect(reads.map((r, i) => [r, out[i]])).toEqual(
      reads.map((r, i) => [r, expected[i]])
    );
  });
});
