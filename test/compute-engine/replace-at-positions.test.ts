/**
 * `ReplaceAt` with more than one position, `ReplaceAt(M, 2, 1, 9)`, and the
 * length that the result type of a position write keeps.
 *
 * The form with several positions is defined by the form with one: the element
 * at the first position is replaced by the same write on that element, with
 * the first position removed. So an inner level follows the rules of the outer
 * level: a negative position counts from the end, a position out of range
 * leaves the expression unevaluated, an absent element stays absent, and an
 * element that is not a list gives the `incompatible-type` error of the form
 * with one position.
 *
 * A form with more than one position is not a view. Its evaluation reads one
 * element of the source and gives the form with one position over the source,
 * so a large source stays a view with one position.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { parseType } from '../../src/common/type/parse';
import { signatureParamType } from '../../src/compute-engine/compilation/compile-assignment-checks';

type Json = unknown;

const M = ['List', ['List', 1, 2], ['List', 3, 4]];

function evaluated(ce: ComputeEngine, json: Json): Json {
  return ce.box(json as never).evaluate().json;
}

function typeOf(ce: ComputeEngine, json: Json): string {
  return ce.box(json as never).type.toString();
}

function compiled(ce: ComputeEngine, json: Json) {
  const r = compile(ce.box(json as never), { fallback: false });
  expect(r.success).toBe(true);
  return r;
}

function run(
  ce: ComputeEngine,
  json: Json,
  vars: Record<string, unknown> = {}
): unknown {
  return (compiled(ce, json).run as (v: unknown) => unknown)(vars);
}

describe('the interpreter', () => {
  const ce = new ComputeEngine();

  test('writes the element that `At` reads with the same positions', () => {
    expect(evaluated(ce, ['At', M, 2, 1])).toBe(3);
    expect(evaluated(ce, ['ReplaceAt', M, 2, 1, 9])).toEqual([
      'List',
      ['List', 1, 2],
      ['List', 9, 4],
    ]);
  });

  test('leaves the operand and its rows unchanged', () => {
    const local = new ComputeEngine();
    local.assign('m', local.box(M as never));
    expect(evaluated(local, ['ReplaceAt', 'm', 2, 1, 9])).toEqual([
      'List',
      ['List', 1, 2],
      ['List', 9, 4],
    ]);
    expect(evaluated(local, 'm')).toEqual(M);
  });

  test('a negative position counts from the end, at each level', () => {
    expect(evaluated(ce, ['ReplaceAt', M, -1, -1, 9])).toEqual([
      'List',
      ['List', 1, 2],
      ['List', 3, 9],
    ]);
    expect(evaluated(ce, ['ReplaceAt', M, 1, -2, 9])).toEqual([
      'List',
      ['List', 9, 2],
      ['List', 3, 4],
    ]);
  });

  test.each([
    ['outer position out of range', [3, 1]],
    ['inner position out of range', [1, 3]],
    ['outer zero', [0, 1]],
    ['inner zero', [1, 0]],
    ['inner negative position out of range', [1, -3]],
  ])('%s leaves the expression unevaluated', (_name, positions) => {
    const result = ce
      .box(['ReplaceAt', M, ...positions, 9] as never)
      .evaluate();
    expect(result.operator).toBe('ReplaceAt');
    expect(result.isValid).toBe(true);
  });

  test('three positions', () => {
    const cube = ['List', M, M];
    expect(evaluated(ce, ['At', cube, 2, 1, 2])).toBe(2);
    expect(evaluated(ce, ['ReplaceAt', cube, 2, 1, 2, 9])).toEqual([
      'List',
      M,
      ['List', ['List', 1, 9], ['List', 3, 4]],
    ]);
  });

  test('`Missing`: the rules of the form with one position', () => {
    // An absent collection answers `Missing`.
    expect(evaluated(ce, ['ReplaceAt', 'Missing', 1, 1, 9])).toBe('Missing');
    // An absent element is the same case one level down: it stays absent, and
    // the other elements stay in place.
    expect(
      evaluated(ce, ['ReplaceAt', ['List', 'Missing', ['List', 1, 2]], 1, 1, 9])
    ).toEqual(['List', 'Missing', ['List', 1, 2]]);
    // An absent value is stored as one element.
    expect(evaluated(ce, ['ReplaceAt', M, 1, 1, 'Missing'])).toEqual([
      'List',
      ['List', 'Missing', 2],
      ['List', 3, 4],
    ]);
    // An absent position is refused at boxing, at each level.
    expect(ce.box(['ReplaceAt', M, 'Missing', 1, 9] as never).isValid).toBe(
      false
    );
    expect(ce.box(['ReplaceAt', M, 1, 'Missing', 9] as never).isValid).toBe(
      false
    );
  });

  test('a position that is not an integer is refused', () => {
    expect(ce.box(['ReplaceAt', M, 1.5, 1, 9] as never).isValid).toBe(false);
    expect(ce.box(['ReplaceAt', M, 1, 1.5, 9] as never).isValid).toBe(false);
    // Past the second position, the signature cannot state the requirement,
    // and the level that reads the position refuses it at evaluation.
    expect(
      ce
        .box(['ReplaceAt', ['List', M], 1, 1, 1.5, 9] as never)
        .evaluate().isValid
    ).toBe(false);
  });

  test('too many positions for the shape: the error of an element that is not a list', () => {
    // The form with one position on an element that is not a list.
    const single = ce.box(['ReplaceAt', 10, 1, 9] as never);
    expect(single.isValid).toBe(false);
    const result = ce
      .box(['ReplaceAt', ['List', 10, 20], 1, 1, 9] as never)
      .evaluate();
    expect(result.json).toEqual(single.json);
    expect(result.isValid).toBe(false);
    expect(typeOf(ce, ['ReplaceAt', ['List', 10, 20], 1, 1, 9])).toBe('error');
  });

  test('an absent row is typed as absent, not as an error', () => {
    expect(typeOf(ce, ['ReplaceAt', ['List', 'Missing'], 1, 1, 9])).toBe(
      'list<missing^1>'
    );
    expect(evaluated(ce, ['ReplaceAt', ['List', 'Missing'], 1, 1, 9])).toEqual([
      'List',
      'Missing',
    ]);
    expect(
      typeOf(ce, ['ReplaceAt', ['List', 'Missing', ['List', 1, 2]], 1, 1, 9])
    ).toContain('missing');
  });

  test('a free symbol in the list keeps its unknown type', () => {
    const local = new ComputeEngine();
    const result = local
      .box(['ReplaceAt', ['List', 'x', 'y'], 1, 1, 9] as never)
      .evaluate();
    expect(result.operator).toBe('ReplaceAt');
    expect(local.box('x').type.toString()).toBe('unknown');
    expect(local.box('y').type.toString()).toBe('unknown');
  });

  test('a position whose type is provably not an integer types as an error', () => {
    const local = new ComputeEngine();
    local.declare('C', 'list<list<list<number>>>');
    local.declare('R', 'list<number>');
    expect(typeOf(local, ['ReplaceAt', 'C', 1, 1, { str: 'a' }, 9])).toBe(
      'error'
    );
    expect(typeOf(local, ['ReplaceAt', 'C', 1, 1, 'R', 9])).toBe('error');
  });

  test('a restriction on a position: the level of that position', () => {
    const c = ['Less', 'c', 0];
    // On the first position, the whole list is restricted.
    expect(evaluated(ce, ['ReplaceAt', M, ['If', c, 1], 1, 9])).toEqual([
      'If',
      c,
      ['List', ['List', 9, 2], ['List', 3, 4]],
    ]);
    // On a later position, only the row of that level is restricted.
    expect(evaluated(ce, ['ReplaceAt', M, 1, ['If', c, 1], 9])).toEqual([
      'List',
      ['If', c, ['List', 9, 2]],
      ['List', 3, 4],
    ]);
  });

  test('a consumer can read the form before it is evaluated', () => {
    const W = ['ReplaceAt', M, 2, 1, 9];
    const b = ce.box(W as never);
    expect(b.count).toBe(2);
    expect(b.at(2)?.json).toEqual(['List', 9, 4]);
    expect([...b.each()].map((x) => x.json)).toEqual([
      ['List', 1, 2],
      ['List', 9, 4],
    ]);
    expect(evaluated(ce, ['Sum', W])).toEqual(['List', 10, 6]);
    expect(
      evaluated(ce, [
        'ListFrom',
        ['Map', ['Function', ['At', 'r', 1], 'r'], W],
      ])
    ).toEqual(['List', 1, 9]);
    // A form with no value has no elements to read.
    const none = ce.box(['ReplaceAt', M, 1, 5, 9] as never);
    expect(none.count).toBeUndefined();
    expect(evaluated(ce, ['Sum', ['ReplaceAt', M, 1, 5, 9]])).toEqual([
      'Sum',
      ['ReplaceAt', M, 1, 5, 9],
    ]);
  });

  describe('a value that is not pure', () => {
    // A new engine for each test, with `tick` counting its runs.
    function setup() {
      const local = new ComputeEngine();
      const runs = { count: 0 };
      local.declare('tick', {
        signature: '() -> integer',
        pure: false,
        evaluate: () => local.number(++runs.count),
      } as never);
      return { local, runs };
    }
    const W = ['ReplaceAt', M, 1, 1, ['tick']];

    test.each([
      ['Map', ['ListFrom', ['Map', ['Function', 'r', 'r'], W]]],
      ['Sum', ['Sum', W]],
      ['Reverse', ['ListFrom', ['Reverse', W]]],
    ])('`%s` runs it once', (_name, json) => {
      const { local, runs } = setup();
      local.box(json as never).evaluate();
      expect(runs.count).toBe(1);
    });

    test('the same runs as the form with one position', () => {
      const { local, runs } = setup();
      local
        .box([
          'ListFrom',
          ['Map', ['Function', 'r', 'r'], ['ReplaceAt', M, 1, ['tick']]],
        ] as never)
        .evaluate();
      expect(runs.count).toBe(1);
    });

    test('reading the shape does not run it', () => {
      const { local, runs } = setup();
      const b = local.box(W as never);
      expect(b.count).toBe(2);
      expect(b.isEmptyCollection).toBe(false);
      expect(b.isFiniteCollection).toBe(true);
      expect(b.isEnumerableCollection).toBe(true);
      expect(runs.count).toBe(0);
    });

    test('reading another element does not run it, and the written one does', () => {
      const { local, runs } = setup();
      const b = local.box(W as never);
      expect(b.at(2)?.json).toEqual(['List', 3, 4]);
      expect(runs.count).toBe(0);
      expect(b.at(1)?.json).toEqual(['List', 1, 2]);
      expect(runs.count).toBe(1);
    });
  });

  test('a restricted collection is threaded whole', () => {
    const c = ['Less', 'c', 0];
    expect(evaluated(ce, ['ReplaceAt', ['If', c, M], 1, 1, 9])).toEqual([
      'If',
      c,
      ['List', ['List', 9, 2], ['List', 3, 4]],
    ]);
  });

  test('a string element is written as its characters', () => {
    const result = ce
      .box(['ReplaceAt', ['List', { str: 'ab' }], 1, 2, { str: 'x' }] as never)
      .evaluate();
    expect(result.operator).toBe('List');
    expect(result.at(1)?.count).toBe(2);
    expect(result.at(1)?.at(2)?.json).toEqual("'x'");
  });

  describe('a large source stays a view', () => {
    const big = [
      'Map',
      ['Function', ['List', 'i', 'i'], 'i'],
      ['Range', 1, 200000],
    ];

    test('the view reads the written element and the others', () => {
      const local = new ComputeEngine();
      const view = local.box(['ReplaceAt', big, 3, 1, 99] as never);
      const value = view.evaluate();
      expect(value.operator).toBe('ReplaceAt');
      expect(value.count).toBe(200000);
      const read = (i: number, j: number) =>
        evaluated(local, ['At', ['ReplaceAt', big, 3, 1, 99], i, j]);
      expect(read(3, 1)).toBe(99);
      expect(read(3, 2)).toBe(3);
      expect(read(4, 1)).toBe(4);
    });

    test('an inner position out of range gives no view', () => {
      const local = new ComputeEngine();
      const value = local.box(['ReplaceAt', big, 3, 5, 99] as never).evaluate();
      expect(value.operator).toBe('ReplaceAt');
      expect(value.count).toBeUndefined();
    });

    test('the written row is read as a value, not as an unevaluated write', () => {
      const local = new ComputeEngine();
      const view = ['ReplaceAt', big, 2, 1, 99];
      expect(evaluated(local, ['At', view, 2])).toEqual(['List', 99, 2]);
      expect(evaluated(local, ['ListFrom', ['Take', view, 3]])).toEqual([
        'List',
        ['List', 1, 1],
        ['List', 99, 2],
        ['List', 3, 3],
      ]);
    });

    test('a chain of writes reads each row once at each level', () => {
      // Each read of the rewritten row used to read the row of the level below
      // twice, so 20 levels did not finish.
      const local = new ComputeEngine();
      let chain: unknown = big;
      for (let k = 1; k <= 20; k++)
        chain = ['ReplaceAt', chain, 2, 1 + (k % 2), k];
      const value = local.box(chain as never).evaluate();
      expect(value.count).toBe(200000);
      expect(evaluated(local, ['At', chain, 2])).toEqual(['List', 20, 19]);
      expect(local.box(chain as never).at(2)?.json).toEqual(['List', 20, 19]);
    });

    test('a chain of writes that have no value finishes', () => {
      const local = new ComputeEngine();
      let chain: unknown = M;
      for (let k = 1; k <= 24; k++) chain = ['ReplaceAt', chain, 1, 5, k];
      expect(local.box(chain as never).evaluate().count).toBeUndefined();
    });

    test('an absent row of a large source: the view reads it as absent', () => {
      const local = new ComputeEngine();
      const joined = [
        'ReplaceAt',
        ['Join', ['List', 'Missing'], ['Repeat', ['List', 1, 2], 200000]],
        1,
        1,
        9,
      ];
      expect(local.box(joined as never).evaluate().count).toBe(200001);
      expect(evaluated(local, ['At', joined, 1])).toBe('Missing');
      expect(evaluated(local, ['At', joined, 2])).toEqual(['List', 1, 2]);

      const restricted = [
        'ReplaceAt',
        [
          'Map',
          ['Function', ['If', ['Greater', 't', 5], ['List', 't']], 't'],
          ['Range', 1, 200000],
        ],
        3,
        1,
        99,
      ];
      expect(evaluated(local, ['At', restricted, 3])).toBe('Missing');
      expect(evaluated(local, ['At', restricted, 6])).toEqual(['List', 6]);
    });

    test('an element of a large source that is not a list: as in a small source', () => {
      const local = new ComputeEngine();
      const write = (n: number) => [
        'ReplaceAt',
        ['Map', ['Function', 't', 't'], ['Range', 1, n]],
        3,
        1,
        99,
      ];
      const large = local.box(write(200000) as never).evaluate();
      const small = local.box(write(5) as never).evaluate();
      expect(large.isValid).toBe(false);
      expect(large.json).toEqual(small.json);
    });
  });
});

describe('compiled JavaScript', () => {
  const ce = new ComputeEngine();
  ce.declare('X', 'list<list<number>>');
  ce.declare('V', 'list<number>');
  ce.declare('j', 'integer');
  ce.declare('i', 'integer');

  test('gives the value of the interpreter, and leaves the input unchanged', () => {
    const row1 = [1, 2];
    const row2 = [3, 4];
    const X = [row1, row2];
    const json = ['ReplaceAt', 'X', 2, 1, 9];
    expect(compiled(ce, json).code).toContain('_SYS.replaceAtPath(');
    expect(run(ce, json, { X })).toEqual([
      [1, 2],
      [9, 4],
    ]);
    expect(X).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(X[0]).toBe(row1);
    expect(X[1]).toBe(row2);
  });

  test('positions that are not literals, and negative positions', () => {
    const json = ['ReplaceAt', 'X', 'j', 'i', 9];
    expect(run(ce, json, { X: [[1, 2], [3, 4]], j: -1, i: -2 })).toEqual([
      [1, 2],
      [9, 4],
    ]);
  });

  test('three positions', () => {
    ce.declare('C', 'list<list<list<number>>>');
    expect(
      run(ce, ['ReplaceAt', 'C', 1, 2, 1, 9], { C: [[[1], [2]]] })
    ).toEqual([[[1], [9]]]);
  });

  test.each([
    ['outer out of range', [3, 1]],
    ['inner out of range', [1, 3]],
    ['inner zero', [1, 0]],
  ])('%s throws, as the form with one position does', (_name, [p, q]) => {
    const f = compiled(ce, ['ReplaceAt', 'X', 'j', 'i', 9]).run as (
      v: unknown
    ) => unknown;
    expect(() => f({ X: [[1, 2], [3, 4]], j: p, i: q })).toThrow(RangeError);
  });

  // Compiled code tests no type at run time, so each level the write copies
  // must be a list by its static type.
  test.each([
    ['a row of any type', 'list<any>', 2],
    ['a row that is a string', 'list<string>', 2],
    ['a source that is a tuple', 'tuple<list<number>, list<number>>', 1],
  ])('%s declines, and names the level', (_name, type, level) => {
    const local = new ComputeEngine();
    local.declare('Y', type);
    expect(() =>
      compile(local.box(['ReplaceAt', 'Y', 1, 1, 9] as never), {
        fallback: false,
      })
    ).toThrow(`level ${level} of the operand`);
  });

  test('a row that may be absent declines', () => {
    const local = new ComputeEngine();
    expect(() =>
      compile(
        local.box([
          'ReplaceAt',
          ['List', 'Missing', ['List', 1, 2]],
          2,
          1,
          9,
        ] as never),
        { fallback: false }
      )
    ).toThrow('level 2 of the operand');
  });

  test('the type of the value does not matter', () => {
    expect(run(ce, ['ReplaceAt', 'X', 1, 1, { str: 'a' }], { X: [[1]] })).toEqual(
      [['a']]
    );
  });

  test('a shape with too few levels declines', () => {
    expect(() =>
      compile(ce.box(['ReplaceAt', 'V', 1, 1, 9] as never), { fallback: false })
    ).toThrow(/sub-expression of type 'error'/);
  });
});

describe('a block local written at two levels', () => {
  const ce = new ComputeEngine();
  ce.declare('X', 'list<list<number>>');
  ce.declare('n', 'integer');
  const range = ['Element', 'k', ['Range', 1, 'n']];
  const declare = ['Declare', 'L', "'list<list<number>>'", 'X'];
  const update = [
    'Assign',
    'L',
    ['ReplaceAt', 'L', 'k', 1, ['Add', ['At', 'L', 'k', 1], 10]],
  ];

  test('compiles to one deep copy, and then writes in place', () => {
    const json = ['Block', declare, ['Loop', update, range], 'L'];
    const code = compiled(ce, json).code;
    // The declaration copies both levels, and each update writes with no
    // test (`ownedFromDeclaration` in `compile-blocks.ts`).
    expect(code).toContain('let L = _SYS.ownedCopyLevels(_.X, 2)');
    expect(code).toContain('L = _SYS.replaceAtPathInPlace(L, 2, k, 1,');
    const row = [1, 2];
    const X = [row, [3, 4]];
    expect(run(ce, json, { X, n: 2 })).toEqual([
      [11, 2],
      [13, 4],
    ]);
    // The input matrix and a row of it stay unchanged after the loop.
    expect(X).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(row).toEqual([1, 2]);
    expect(X[0]).toBe(row);
  });

  test('a row read from the input before the loop stays unchanged', () => {
    // `r` holds the first row of the input. If the write changed that row,
    // the sum would be 11 + 11.
    const json = [
      'Block',
      ['Declare', 'r', "'list<number>'", ['At', 'X', 1]],
      declare,
      ['Loop', update, range],
      ['Add', ['At', 'r', 1], ['At', 'L', 1, 1]],
    ];
    expect(compiled(ce, json).code).toContain('replaceAtPathInPlace');
    expect(run(ce, json, { X: [[1, 2], [3, 4]], n: 2 })).toBe(12);
  });

  test('a row that the input holds twice is written once', () => {
    const json = ['Block', declare, ['Loop', update, range], 'L'];
    const row = [1, 2];
    expect(compiled(ce, json).code).toContain('replaceAtPathInPlace');
    expect(run(ce, json, { X: [row, row], n: 1 })).toEqual([
      [11, 2],
      [1, 2],
    ]);
    expect(row).toEqual([1, 2]);
  });

  test('a row read from the local keeps the copying form', () => {
    const json = [
      'Block',
      declare,
      ['Declare', 'r', "'list<number>'", ['At', 'L', 1]],
      ['Loop', update, range],
      'r',
    ];
    const code = compiled(ce, json).code;
    expect(code).not.toContain('replaceAtPathInPlace');
    expect(run(ce, json, { X: [[1, 2], [3, 4]], n: 2 })).toEqual([1, 2]);
  });

  test.each([
    ['First', ['First', 'L']],
    ['Last', ['Last', 'L']],
    ['At', ['At', 'L', 1]],
  ])('`%s` of the local keeps the copying form', (_name, read) => {
    const json = [
      'Block',
      declare,
      ['Loop', update, range],
      ['Declare', 'r', "'list<number>'", read],
      ['Assign', 'L', ['ReplaceAt', 'L', 1, 1, 99]],
      'r',
    ];
    const code = compiled(ce, json).code;
    expect(code).not.toContain('replaceAtPathInPlace');
  });

  test('the reads that allow the in-place form', () => {
    const json = [
      'Block',
      declare,
      ['Declare', 'c', "'integer'", ['Length', 'L']],
      [
        'Loop',
        [
          'Assign',
          'L',
          ['ReplaceAt', 'L', 'k', 2, ['Add', ['At', 'L', 'k', 1], 'c']],
        ],
        range,
      ],
      'L',
    ];
    expect(compiled(ce, json).code).toContain('replaceAtPathInPlace');
    expect(run(ce, json, { X: [[1, 2], [3, 4]], n: 2 })).toEqual([
      [1, 3],
      [3, 5],
    ]);
  });

  test('a local also written at one level keeps the copying form', () => {
    // A write at one level can store a row that the block does not own, which
    // a later write at two levels would change.
    ce.declare('R', 'list<number>');
    const json = [
      'Block',
      declare,
      ['Assign', 'L', ['ReplaceAt', 'L', 1, 'R']],
      ['Assign', 'L', ['ReplaceAt', 'L', 1, 1, 99]],
      'L',
    ];
    expect(compiled(ce, json).code).not.toContain('InPlace');
    const R = [7, 8];
    expect(run(ce, json, { X: [[1, 2], [3, 4]], R })).toEqual([
      [99, 8],
      [3, 4],
    ]);
    expect(R).toEqual([7, 8]);
  });

  test('a value that is another row is stored, and not written later', () => {
    // A write at two levels stores `v` below the arrays that the block owns.
    const ce = new ComputeEngine();
    ce.declare('C', 'list<list<list<number>>>');
    ce.declare('R', 'list<number>');
    const json = [
      'Block',
      ['Declare', 'K', "'list<list<list<number>>>'", 'C'],
      ['Assign', 'K', ['ReplaceAt', 'K', 1, 1, 'R']],
      ['Assign', 'K', ['ReplaceAt', 'K', 1, 2, 'R']],
      'K',
    ];
    expect(compiled(ce, json).code).toContain('replaceAtPathInPlace');
    const R = [5];
    expect(run(ce, json, { C: [[[1], [2]]], R })).toEqual([[[5], [5]]]);
    expect(R).toEqual([5]);
  });

  test('two chains of two writes each are written in place', () => {
    const json = [
      'Block',
      declare,
      ['Assign', 'L', ['ReplaceAt', ['ReplaceAt', 'L', 1, 1, 5], 1, 1, 6]],
      [
        'Assign',
        'L',
        ['ReplaceAt', ['ReplaceAt', 'L', 2, 2, 7], 1, 2, ['At', 'L', 2, 2]],
      ],
      'L',
    ];
    const code = compiled(ce, json).code;
    expect(code).toContain('ownedCopyLevels(L, 2)), 2, 1, 1, 5, 1, 1, 6)');
    expect(code).toContain('2, 2, 2, 7, 1, 2,');
    const X = [
      [1, 2],
      [3, 4],
    ];
    // Both operands of the last write are read before the first write of its
    // chain, so `At(L, 2, 2)` is 4.
    expect(run(ce, json, { X })).toEqual([
      [6, 4],
      [3, 7],
    ]);
    expect(X).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('a chain that mixes one level and two levels keeps the copying form', () => {
    const json = [
      'Block',
      declare,
      [
        'Assign',
        'L',
        ['ReplaceAt', ['ReplaceAt', 'L', 1, ['List', 0, 0]], 1, 1, 9],
      ],
      'L',
    ];
    const code = compiled(ce, json).code;
    expect(code).not.toContain('InPlace');
    expect(code).toContain('_SYS.replaceAtPath(');
    expect(run(ce, json, { X: [[1, 2], [3, 4]] })).toEqual([
      [9, 0],
      [3, 4],
    ]);
  });

  test('an assignment of another list copies again', () => {
    const json = [
      'Block',
      declare,
      ['Assign', 'L', ['ReplaceAt', 'L', 1, 1, 7]],
      ['Assign', 'L', 'X'],
      ['Assign', 'L', ['ReplaceAt', 'L', 2, 1, 8]],
      'L',
    ];
    const X = [
      [1, 2],
      [3, 4],
    ];
    expect(run(ce, json, { X })).toEqual([
      [1, 2],
      [8, 4],
    ]);
    expect(X).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('a fold keeps the copying form, and gives the value', () => {
    const json = [
      'Fold',
      [
        'Function',
        ['ReplaceAt', 'acc', 'k', 1, 'k'],
        'acc',
        'k',
      ],
      'X',
      ['Range', 1, 2],
    ];
    const X = [
      [1, 2],
      [3, 4],
    ];
    const r = compile(ce.box(json as never), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('InPlace');
    expect((r.run as (v: unknown) => unknown)({ X })).toEqual([
      [1, 2],
      [2, 4],
    ]);
    expect(X).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe('the other targets decline a form with more than one position', () => {
  const ce = new ComputeEngine();
  ce.declare('X', 'matrix<2x2>');
  const json = ['ReplaceAt', 'X', 1, 1, 9];

  test.each([
    ['python', /this target writes at one position/],
    ['glsl', /target 'glsl' has no lowering/],
  ])('%s', (to, message) => {
    expect(() =>
      compile(ce.box(json as never), { to, fallback: false } as never)
    ).toThrow(message);
  });

  test('interval-js', () => {
    const r = compile(ce.box(json as never), {
      to: 'interval-js',
      fallback: false,
    } as never);
    expect(r.success).toBe(false);
  });

  test('the JavaScript `bigint` mode', () => {
    ce.declare('B', 'list<list<integer>>');
    expect(() =>
      compile(ce.box(['ReplaceAt', 'B', 1, 1, 9] as never), {
        mode: 'bigint',
        fallback: false,
      })
    ).toThrow(/takes a list, a position and a value/);
  });

  test('the `bigint` mode reads the position as an integer promise', () => {
    // The signature of `ReplaceAt` is an overload set. Position 1 is `integer`
    // in both options, so `n/2` is under an integer promise. Without it, this
    // call declines.
    ce.declare('B2', 'list<integer>');
    ce.declare('n', 'integer');
    const r = compile(
      ce.box(['ReplaceAt', 'B2', ['Divide', 'n', 2], 9] as never),
      { mode: 'bigint', fallback: false }
    );
    expect(r.success).toBe(true);
    expect((r.run as (v: unknown) => unknown)({ B2: [1n, 2n], n: 4n })).toEqual(
      [1n, 9n]
    );
  });

  test('python keeps the form with one position', () => {
    ce.declare('V', 'list<number>');
    const r = compile(ce.box(['ReplaceAt', 'V', 1, 9] as never), {
      to: 'python',
      fallback: false,
    } as never);
    expect(r.success).toBe(true);
  });
});

describe('the length in the type', () => {
  const ce = new ComputeEngine();
  ce.declare('v3', 'vector<3>');
  ce.declare('n3', 'list<integer^3>');
  ce.declare('m23', 'matrix<2x3>');
  ce.declare('ls', 'list<number>');
  ce.declare('ll', 'list<list<integer>>');

  test('a write keeps a known length when the value fits', () => {
    expect(typeOf(ce, ['ReplaceAt', 'v3', 1, 9])).toBe('vector<3>');
    expect(typeOf(ce, ['ReplaceAt', 'n3', 1, 9])).toBe('vector<integer^3>');
    expect(typeOf(ce, ['ReplaceAt', ['List', 1, 2, 3], 1, 9])).toBe(
      'vector<integer^3>'
    );
    expect(typeOf(ce, ['ReplaceAt', 'm23', 1, ['List', 1, 2, 3]])).toBe(
      'matrix<2x3>'
    );
  });

  test('a value that does not fit widens the element type, and the length goes', () => {
    expect(typeOf(ce, ['ReplaceAt', 'v3', 1, { str: 'a' }])).toBe(
      'list<number | string>'
    );
    expect(typeOf(ce, ['ReplaceAt', 'n3', 1, 1.5])).toBe('list<real>');
    expect(typeOf(ce, ['ReplaceAt', ['List', 1, 2, 3], 1, 'Missing'])).toBe(
      'list<integer | missing>'
    );
  });

  test('a list with no known length keeps the existing rule', () => {
    expect(typeOf(ce, ['ReplaceAt', 'ls', 1, 9])).toBe('list<number>');
    expect(typeOf(ce, ['ReplaceAt', ['Tuple', 1, 2], 1, 9])).toBe(
      'list<integer>'
    );
    expect(typeOf(ce, ['ReplaceAt', { str: 'ab' }, 1, { str: 'x' }])).toBe(
      'list<character | string>'
    );
  });

  test('a matrix with an unknown dimension: a row can have another length', () => {
    ce.declare('mm', 'matrix');
    ce.declare('m2q', 'matrix<2x?>');
    ce.declare('mq3', 'matrix<?x3>');
    const row = ['List', 1, 2, 3];
    expect(typeOf(ce, ['ReplaceAt', 'mm', 1, row])).toBe('list<vector>');
    expect(typeOf(ce, ['ReplaceAt', 'm2q', 1, row])).toBe('list<vector>');
    // Each dimension below the first is known, so a row that fits has the
    // length of the others.
    expect(typeOf(ce, ['ReplaceAt', 'mq3', 1, row])).toBe('matrix<?x3>');
    // A write below a row keeps the length of that row.
    expect(typeOf(ce, ['ReplaceAt', 'mm', 1, 2, 9])).toBe('matrix');
    expect(typeOf(ce, ['ReplaceAt', 'm2q', 1, 2, 9])).toBe('matrix<2x?>');
  });

  test('a tensor of unknown rank has no length to keep', () => {
    ce.declare('tn', 'tensor<number>');
    expect(typeOf(ce, ['ReplaceAt', 'tn', 1, 9])).toBe('list<number | tensor>');
  });

  test('the form with several positions follows the same rule', () => {
    expect(typeOf(ce, ['ReplaceAt', 'm23', 1, 2, 9])).toBe('matrix<2x3>');
    expect(typeOf(ce, ['ReplaceAt', M, 1, 2, 9])).toBe(
      'matrix<integer^(2x2)>'
    );
    expect(typeOf(ce, ['ReplaceAt', 'll', 1, 2, 9])).toBe(
      'list<list<integer>>'
    );
    expect(typeOf(ce, ['ReplaceAt', 'll', 1, 2, 1.5])).toBe('list<list<real>>');
    expect(typeOf(ce, ['ReplaceAt', 'm23', 1, 2, { str: 'x' }])).toBe(
      'list<list<number | string>>'
    );
    expect(typeOf(ce, ['ReplaceAt', 'm23', 1, 2, 3, 9])).toBe('error');
  });

  test('a consumer reads the kept length', () => {
    expect(typeOf(ce, ['First', ['ReplaceAt', 'v3', 1, 9]])).toBe('number');
    expect(
      ce.box(['Length', ['ReplaceAt', ['List', 1, 2, 3], 1, 9]] as never)
        .evaluate().json
    ).toBe(3);
  });

  test('on GLSL, `ReplaceAt` declines, so a block with a write has no shader', () => {
    // GLSL reads the length of a local from its type for `At`. `ReplaceAt`
    // has no shader form, so a block that writes the local never reaches that
    // read.
    ce.declare('u3', 'vector<3>');
    const read = compile(ce.box(['At', 'u3', 2] as never), {
      to: 'glsl',
      fallback: false,
    } as never);
    expect(read.success).toBe(true);
    expect(() =>
      compile(
        ce.box([
          'Block',
          ['Declare', 'L', "'vector<3>'", 'u3'],
          ['Assign', 'L', ['ReplaceAt', 'L', 1, 9]],
          ['At', 'L', 2],
        ] as never),
        { to: 'glsl', fallback: false } as never
      )
    ).toThrow(/target 'glsl' has no lowering/);
  });
});

describe('`signatureParamType` of an overload set', () => {
  test('the type on which every option that has the parameter agrees', () => {
    const t = parseType(
      '((list<number>, integer, string) -> string) & ((list<number>, integer, integer, number) -> number)'
    );
    expect(signatureParamType(t, 0)).toEqual(parseType('list<number>'));
    expect(signatureParamType(t, 1)).toBe('integer');
    // The options differ here.
    expect(signatureParamType(t, 2)).toBeUndefined();
    // Only one option has this parameter.
    expect(signatureParamType(t, 3)).toBe('number');
    // No option has this parameter.
    expect(signatureParamType(t, 4)).toBeUndefined();
  });
});
