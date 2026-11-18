/**
 * A chained access `At(R, i, j)` (`R[i, j]`) has the type and the value of
 * the nested access `At(At(R, i), j)`: the `evaluate` handler of `At` reads
 * the indices one at a time, and each index applies to the value that the
 * index before it selected. The compiler declines the chained form.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** An engine with `R` and `n` declared, and the functions of the calls. */
function engine(type: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('h2', ce.box(['Function', ['Add', 'p', 1], 'p'] as never));
  ce.assign('h3', ce.box(['Function', ['At', 'p', 2], 'p'] as never));
  ce.declare('R', type);
  ce.declare('n', 'integer');
  return ce;
}

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

describe('Shader targets decline a chained At', () => {
  // The compiler declines an `At` with an index for each level.
  test.each([
    ['glsl', 'matrix<real^2x2>', /At with an index for each level/],
    ['glsl', 'list<list<real>>', /At with an index for each level/],
  ] as const)('%s, %s', (to, type, message) => {
    const ce = engine(type);
    expect(() =>
      compile(ce.box(['At', 'R', 1, 2] as never), { to, fallback: false })
    ).toThrow(message);
  });
});
