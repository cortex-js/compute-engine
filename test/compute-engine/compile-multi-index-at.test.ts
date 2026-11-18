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
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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

describe('A chained read has the type of the nested read', () => {
  // The chained read `At(x, i, j)` is the nested read `At(At(x, i), j)`: each
  // index applies to the value that the index before it selected. So a step
  // through a tuple reads a slot, through a record a field, and through a
  // dictionary a value. They were peeled with the element type of an
  // iteration: with `t: tuple<list<real>, real>`, `At(t, 1, 2)` was typed
  // `list<real>`, and its value is a real number.
  const BASES_OF_READS = [
    ['tuple<list<real>, real>', 't', ['At', 't', 1, 2], 'real'],
    ['record{a: list<real>}', 'r', ['At', 'r', { str: 'a' }, 1], 'real'],
    ['list<record{a: real}>', 'L', ['At', 'L', 1, { str: 'a' }], 'real'],
    ['dictionary<list<real>>', 'd', ['At', 'd', { str: 'a' }, 1], 'real'],
    [
      'list<tuple<real, list<real>>>',
      'tl',
      ['At', 'tl', 1, 2, 1],
      'real',
    ],
    ['list<list<real>>', 'm', ['At', 'm', 1, ['List', 1, 2]], 'list<real>'],
    ['list<list<real>>', 'm', ['At', 'm', ['List', 1, 2], 1], 'list<real>'],
  ] as const;
  test.each(BASES_OF_READS)('%s: %s', (type, name, read, expected) => {
    const ce = new ComputeEngine();
    ce.declare(name, type);
    const chained = ce.box(read as never);
    expect(chained.type.toString()).toBe(expected);
    const [, base, ...indexes] = read as readonly unknown[];
    let nested: unknown = base;
    for (const i of indexes) nested = ['At', nested, i];
    expect(ce.box(nested as never).type.toString()).toBe(expected);
  });

  test('a chained read through a tuple compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'tuple<list<real>, real>');
    ce.declare('tl', 'list<tuple<real, list<real>>>');
    ce.declare('i', 'integer');
    ce.declare('j', 'integer');
    for (const mode of ['complex', 'strict'] as const) {
      const r = compile(ce.box(['Add', ['At', 't', 1, 2], 1] as never), {
        fallback: false,
        mode,
      })!;
      expect(r.run!({ t: [[1.5, 2.5], 3.5] })).toBe(3.5);
      const s = compile(ce.box(['At', 'tl', 'i', 2, 'j'] as never), {
        fallback: false,
        mode,
      })!;
      expect(s.run!({ tl: [[1, [5, 6]]], i: 1, j: 2 })).toBe(6);
    }
  });

  test.each([[['At', 't', 2, 1]], [['At', 't', 2, 1, 1]]])(
    'a read of a scalar with more indexes is an error, and declines: %j',
    (json) => {
      const ce = new ComputeEngine();
      ce.declare('t', 'tuple<list<real>, real>');
      const read = ce.box(json as never);
      expect(read.type.toString()).toBe('error');
      expect(() => compile(read, { fallback: false })).toThrow(
        /Could not compile/
      );
    }
  );

  // JavaScript has no lowering of a read of a record or a dictionary.
  test.each([
    ['record{a: list<real>}', 'r', ['At', 'r', { str: 'a' }, 1]],
    ['list<record{a: real}>', 'L', ['At', 'L', 1, { str: 'a' }]],
    ['dictionary<list<real>>', 'd', ['At', 'd', { str: 'a' }, 1]],
  ] as const)('a read through %s declines', (type, name, read) => {
    const ce = new ComputeEngine();
    ce.declare(name, type);
    expect(() => compile(ce.box(read as never), { fallback: false })).toThrow(
      /Could not compile/
    );
  });

  // A literal index outside a tuple: the read is absent, and the type `unknown`
  // holds its value.
  test('an absent step absorbs the remaining steps', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'tuple<list<real>, real>');
    ce.assign('t', ce.box(['Tuple', ['List', 1.5, 2.5], 3.5] as never));
    const read = ce.box(['At', 't', 9, 1] as never);
    expect(read.type.toString()).toBe('unknown');
    expect(read.evaluate().toString()).toBe('"Missing"');
  });

  // The marker has the domain of the read: a number gives `NaN`, as the nested
  // read does, also when a step goes through a record, a dictionary or a tuple.
  test.each([
    ['list<tuple<real, string>>', 'X', ['List', ['Tuple', 1.5, "'a'"]], ['At', 'X', 9, 1]],
    ['list<record{a: real}>', 'L', ['List', ['Dictionary', ['KeyValuePair', "'a'", 1.5]]], ['At', 'L', 9, { str: 'a' }]],
    ['dictionary<list<real>>', 'd', ['Dictionary', ['KeyValuePair', "'a'", ['List', 1.5]]], ['At', 'd', { str: 'z' }, 1]],
  ] as const)('%s: the marker is NaN', (type, name, value, read) => {
    const ce = new ComputeEngine();
    ce.declare(name, type);
    ce.assign(name, ce.box(value as never));
    expect(ce.box(read as never).evaluate().toString()).toBe('NaN');
  });
});

describe('The interval target compiles a chained At', () => {
  // `R[1, 2]` of a rank-3 tensor is a row, which an interval cannot hold:
  // `_IA.at` answered `entire` where the interpreter gives `[3, 4]`. The
  // read declines (`At` on interval-js declines a read of a list or a point
  // that is used as a value).
  test('a read of a row of a rank-3 tensor declines', () => {
    const ce = engine('tensor<real^2x2x2>');
    let success: boolean;
    try {
      success = compile(ce.box(['At', 'R', 1, 2] as never), {
        to: 'interval-js',
        fallback: false,
      })!.success;
    } catch {
      success = false;
    }
    expect(success).toBe(false);
  });
});

describe('Shader targets read a chained At as the nested access', () => {
  // A shader target has no lowering for an index into a multi-axis base or
  // into a list with no static length. The decline is the one of the nested
  // access `R[1][2]`, not the decline of the multi-index form.
  test.each([
    ['glsl', 'matrix<real^2x2>', /`At` is in the GLSL fragment with one index/],
    ['glsl', 'list<list<real>>', /`At` is in the GLSL fragment with one index/],
  ] as const)('%s, %s', (to, type, message) => {
    const ce = engine(type);
    expect(() =>
      compile(ce.box(['At', 'R', 1, 2] as never), { to, fallback: false })
    ).toThrow(message);
  });
});
