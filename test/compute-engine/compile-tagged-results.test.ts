import { compile, ComputeEngine } from '../../src/compute-engine';
import type { Expression, IComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

function tagged(
  ce: IComputeEngine,
  tag: string,
  fields: Record<string, Expression>
) {
  return ce.function(
    'Dictionary',
    Object.entries({ __tag: ce.string(tag), ...fields }).map(([key, value]) =>
      ce.function('Tuple', [ce.string(key), value])
    )
  );
}

function engine() {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('HostPath', {
    signature: '(any) -> expression',
    compile: ([coordinates]) => tagged(ce, 'path', { coordinates }),
  });
  return ce;
}

const coords: MathJsonExpression = ['List', 1, 1, 2, 4, 3, 9, 4, 16, 5, 25];
const domain: MathJsonExpression = ['Element', 'k', ['List', 1, 2]];
const path = (coordinates: number[]) => ({ __tag: 'path', coordinates });

describe('host-declared tagged JavaScript results', () => {
  test('a single record can hold a list of runtime length', () => {
    const ce = engine();
    const result = compile(ce.expr(['HostPath', ['Take', coords, 'n']]), {
      fallback: false,
      symbolic: ['n'],
    });
    expect(result.run!({ n: 0 })).toEqual(path([]));
    expect(result.run!({ n: 4 })).toEqual(path([1, 1, 2, 4]));
    expect(result.shippable).toBe(false);
    expect(() => result.broadcast!({ n: 4 })).toThrow(/record/);
  });

  test('a literal list preserves each declaration, including empty fields', () => {
    const ce = engine();
    ce.declare('HostMarker', {
      signature: '(real) -> expression',
      compile: ([position]) => tagged(ce, 'marker', { position }),
    });
    const result = compile(
      ce.expr(['List', ['HostPath', ['List']], ['HostMarker', 'n']]),
      { fallback: false }
    );
    expect(result.run!({ n: 2 })).toEqual([
      path([]),
      { __tag: 'marker', position: 2 },
    ]);
  });

  test.each([true, false])(
    'a comprehension with fixed fields (optimize: %s)',
    (optimize) => {
      const ce = engine();
      const result = compile(
        ce.expr(['Comprehension', ['HostPath', ['List', 'k', 'n']], domain]),
        { fallback: false, optimize }
      );
      expect(result.run!({ n: 3 })).toEqual([path([1, 3]), path([2, 3])]);
    }
  );

  test.each([true, false])(
    'a comprehension with runtime-length fields (optimize: %s)',
    (optimize) => {
      const ce = engine();
      const result = compile(
        ce.expr([
          'Comprehension',
          ['HostPath', ['Take', coords, ['Multiply', 2, ['Add', 'k', 'n']]]],
          domain,
        ]),
        { fallback: false, optimize }
      );
      expect(result.run!({ n: -1 })).toEqual([path([]), path([1, 1])]);
      expect(result.run!({ n: 2 })).toEqual([
        path([1, 1, 2, 4, 3, 9]),
        path([1, 1, 2, 4, 3, 9, 4, 16]),
      ]);
      expect(result.run!({ n: 3 })).toEqual([
        path([1, 1, 2, 4, 3, 9, 4, 16]),
        path([1, 1, 2, 4, 3, 9, 4, 16, 5, 25]),
      ]);
    }
  );

  test('a host decides how to interleave a runtime list of points', () => {
    const ce = engine();
    const fn = (head: string, ...args: Expression[]) => ce.function(head, args);
    ce.declare('HostVertices', {
      signature: '(list<tuple<real, real>>) -> expression',
      compile: ([points]) => {
        const zero = ce.number(0);
        const one = ce.number(1);
        const two = ce.number(2);
        const i = ce.symbol('coordinate');
        const index = fn('Subtract', i, one);
        const vertex = fn(
          'At',
          points,
          fn('Add', one, fn('Floor', fn('Divide', index, two)))
        );
        const component = fn(
          'If',
          fn('Equal', fn('Mod', index, two), zero),
          fn('PointX', vertex),
          fn('PointY', vertex)
        );
        const count = fn('Multiply', two, fn('Length', points));
        const indices = fn('Range', one, count, one);
        return tagged(ce, 'path', {
          coordinates: fn('Comprehension', component, fn('Element', i, indices)),
        });
      },
    });
    const vertices: MathJsonExpression = [
      'List', ['Tuple', 1, 1], ['Tuple', 2, 4], ['Tuple', 3, 9],
    ];
    const result = compile(
      ce.expr([
        'Comprehension',
        ['HostVertices', ['Take', vertices, ['Add', 'k', 'n']]],
        domain,
      ]),
      { fallback: false, optimize: false }
    );
    expect(result.run!({ n: -1 })).toEqual([path([]), path([1, 1])]);
    expect(result.run!({ n: 1 })).toEqual([
      path([1, 1, 2, 4]),
      path([1, 1, 2, 4, 3, 9]),
    ]);
  });

  test('a record preserves non-finite slots and string-list fields', () => {
    const ce = engine();
    const expression = tagged(ce, 'labels', {
      positions: ce.expr(['List', 1, 'NaN', 2]),
      labels: ce.expr(['List', "'first'", "'last'"]),
    });
    expect(compile(expression, { fallback: false }).run!()).toEqual({
      __tag: 'labels',
      positions: [1, NaN, 2],
      labels: ['first', 'last'],
    });
  });

  test('rejects a tagged result that would be normalized as a complex number', () => {
    const ce = engine();
    const expression = tagged(ce, 'rectangular', { re: ce.One, im: ce.Zero });
    expect(() => compile(expression, { fallback: false })).toThrow(
      /reserved for complex results/
    );
  });

  test('a field of a run-time length is read where the record is not the result', () => {
    // The dictionary is a record whose field carries its length (README,
    // "Records"); its value is the interpreter's `Take(coords, n)`.
    const ce = engine();
    for (const optimize of [true, false]) {
      const result = compile(
        ce.expr(['At', ['HostPath', ['Take', coords, 'n']], "'coordinates'"]),
        { fallback: false, optimize }
      );
      for (const n of [0, 4]) {
        const expected = [
          ...ce.box(['Take', coords, n]).evaluate().each(),
        ].map((x) => x.re);
        expect(result.run!({ n })).toEqual(expected);
      }
    }
  });

  test('a field read from a list of strings at a run-time index', () => {
    // A record that reaches only the result holds the read; an absent
    // string is `undefined` there, as in any result.
    const ce = engine();
    ce.declare('names', 'list<string>');
    ce.declare('i', 'integer');
    const label: MathJsonExpression = [
      'Dictionary',
      ['Tuple', "'__tag'", "'label'"],
      ['Tuple', "'text'", ['At', 'names', 'i']],
    ];
    for (const expr of [label, ['List', label, label]] as MathJsonExpression[])
      for (const optimize of [true, false]) {
        const result = compile(ce.expr(expr), {
          fallback: false,
          optimize,
        } as any);
        for (const i of [1, 2]) {
          const expected = ce
            .expr(expr)
            .subs({ names: ce.expr(['List', "'a'", "'b'"]), i: ce.number(i) })
            .evaluate();
          const text = String.fromCharCode(96 + i);
          const one = { __tag: 'label', text };
          expect(expected.toString()).toContain(`"${text}"`);
          expect(result.run!({ names: ['a', 'b'], i })).toEqual(
            expr === label ? one : [one, one]
          );
        }
      }
  });

  test('a field of rank 2 of a run-time inner length declines', () => {
    // A tagged result is an ordinary record: an inner length of a field
    // that is not a constant declines, as in any record (README, "Records").
    const ce = engine();
    ce.declare('M', 'matrix<real>');
    expect(() =>
      compile(ce.expr(['HostPath', 'M']), { fallback: false })
    ).toThrow(/a run-time length of an inner axis/);
  });

  test.each(['glsl', 'interval-js'] as const)('declines on %s', (to) => {
    const ce = engine();
    expect(() =>
      compile(ce.expr(['HostPath', ['List', 1, 2]]), { to, fallback: false })
    ).toThrow();
  });
});
