import { ComputeEngine } from '../../src/compute-engine';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

const json = (latex: string) => new ComputeEngine().parse(latex).json;

describe('an expression index of a subscript is canonical', () => {
  test.each([
    ['A_{n+1}', ['Add', 'n', 1]],
    ['A_{(n+1)}', ['Add', 'n', 1]],
    ['A_{n-1}', ['Add', 'n', -1]],
    ['A_{1+n}', ['Add', 'n', 1]],
    ['A_{n,m}', ['Sequence', 'n', 'm']],
    ['A_{(n,m)}', ['Sequence', 'n', 'm']],
  ])('%s', (latex, index) => {
    const e = new ComputeEngine().parse(latex);
    expect(e.json).toEqual(['Subscript', 'A', index]);
    expect(e.op2?.isCanonical).toBe(true);
  });

  test('a free `i` in an index is the imaginary unit, as in a comma index', () => {
    expect(json('A_{i+1}')).toEqual(['Subscript', 'A', ['Complex', 1, 1]]);
    expect(json('A_{i,j}')).toEqual([
      'Subscript',
      'A',
      ['Sequence', ['Complex', 0, 1], 'j'],
    ]);
  });

  test('a declared `i` in an index is the symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('i', 'integer');
    expect(ce.parse('A_{i+1}').json).toEqual([
      'Subscript',
      'A',
      ['Add', 'i', 1],
    ]);
  });

  test('a binder index named `i` in an index is the binder index', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{i=1}^{3} A_{i+1}').evaluate().json).toEqual([
      'Add',
      'A_2',
      'A_3',
      'A_4',
    ]);
  });

  test('the box and the parse routes give the same expression', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Subscript', 'A', ['Sequence', 'n', 'm']])
        .isSame(ce.parse('A_{n,m}'))
    ).toBe(true);
    expect(
      ce.box(['Subscript', 'A', ['Add', 'n', 1]]).isSame(ce.parse('A_{n+1}'))
    ).toBe(true);
    expect(
      ce
        .function('Subscript', [ce.symbol('A'), ce.parse('n+1')])
        .isSame(ce.parse('A_{n+1}'))
    ).toBe(true);
  });
});

describe('an index read by value that is a bare symbol keeps a marker', () => {
  const marked: MathJsonExpression = ['Subscript', 'A', ['Delimiter', 'n']];

  test.each(['A_{(n)}', 'A_{((n))}', 'A_{n+0}', 'A_{1\\cdot n}', 'A_{\\frac{n}{1}}'])(
    '%s has the marker',
    (latex) => {
      const e = new ComputeEngine().parse(latex);
      expect(e.json).toEqual(marked);
      expect(e.latex).toBe('A_{(n)}');
      expect(e.isCanonical).toBe(true);
    }
  );

  test('a plain name stays a compound symbol', () => {
    expect(json('A_n')).toBe('A_n');
    expect(new ComputeEngine().box(['Subscript', 'A', 'n']).json).toBe('A_n');
  });

  test('the marked form is not the compound symbol', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('A_{(n)}').isSame(ce.parse('A_n'))).toBe(false);
  });

  test('an unassigned index gives the same family of symbols', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('A_{(n)}').evaluate().json).toBe('A_n');
  });

  test.each(['A_{n+0}', 'A_{(n)}', 'A_{(i)}'])(
    'a sum over the index of %s reads its value',
    (latex) => {
      const ce = new ComputeEngine();
      const index = latex === 'A_{(i)}' ? 'i' : 'n';
      const sum = ce.parse(`\\sum_{${index}=1}^{3} ${latex}`);
      expect(sum.evaluate().json).toEqual(['Add', 'A_1', 'A_2', 'A_3']);
      expect(sum.simplify().evaluate().json).toEqual([
        'Add',
        'A_1',
        'A_2',
        'A_3',
      ]);
    }
  );

  test('the type allows arithmetic, as for any other expression index', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('A_{(n)}').type.toString()).toBe('unknown');
    expect(ce.parse('A_{(n)}+1').isValid).toBe(true);
  });

  test('an index with a value below a marker resolves or stays symbolic', () => {
    const ce = new ComputeEngine();
    ce.assign('n', 3);
    ce.assign('A_3', 42);
    expect(ce.parse('A_{(n)}').evaluate().json).toBe(42);
    expect(ce.parse('A_{(n)}').N().json).toBe(42);
    ce.assign('n', 2.5);
    expect(ce.parse('A_{(n)}').evaluate().json).toEqual(['Subscript', 'A', 2.5]);
  });

  describe('saving and restoring keeps the value', () => {
    const restoredValue = (route: 'json' | 'latex') => {
      const ce = new ComputeEngine();
      const e = ce.parse('A_{n+0}');
      const restored = route === 'json' ? ce.box(e.json) : ce.parse(e.latex);
      ce.assign('n', 3);
      ce.assign('A_3', 42);
      ce.assign('A_n', 7);
      return restored.evaluate().json;
    };
    test('through MathJSON', () => expect(restoredValue('json')).toBe(42));
    test('through LaTeX', () => expect(restoredValue('latex')).toBe(42));
    test('Epsil writes the marker in the call form', () => {
      const text = serializeEpsil(['Subscript', 'A', ['Delimiter', 'n']]);
      expect(text).toBe('Subscript(A, Delimiter(n))');
    });
  });

  describe('an operation that rewrites operands keeps the meaning', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('A_{n+0}');

    test('subs() with a name keeps the marker', () => {
      expect(e.subs({ n: 'm' }).json).toEqual([
        'Subscript',
        'A',
        ['Delimiter', 'm'],
      ]);
    });
    test('subs() with a number gives the symbol that the number names', () => {
      expect(e.subs({ n: 3 }).json).toBe('A_3');
    });
    test('subs() with an expression needs no marker', () => {
      expect(e.subs({ n: ce.parse('x+1') }).json).toEqual([
        'Subscript',
        'A',
        ['Add', 'x', 1],
      ]);
    });
    test.each([
      ['A_{n+m}', { m: 0 }],
      ['A_{k\\cdot n}', { k: 1 }],
    ])('a rewrite that reduces %s to the symbol n adds the marker', (latex, sub) => {
      expect(ce.parse(latex).subs(sub).json).toEqual(marked);
    });
    test('a rewrite that reduces the index in a sum still reads its value', () => {
      const sum = ce.parse('\\sum_{n=1}^{3} A_{n+m}');
      const values = ['Add', 'A_1', 'A_2', 'A_3'];
      expect(sum.subs({ m: 0 }).evaluate().json).toEqual(values);
      expect(
        sum
          .replace([{ match: ce.symbol('m'), replace: ce.number(0) }], {
            recursive: true,
          })
          ?.evaluate().json
      ).toEqual(values);
    });
    test('a rewrite that reduces the base to a symbol adds the marker', () => {
      expect(ce.parse('(x+y)_{n}').subs({ y: 0 }).json).toEqual([
        'Subscript',
        'x',
        ['Delimiter', 'n'],
      ]);
    });
    test('a rewrite of the base to a list or a ring has no marker', () => {
      expect(e.subs({ A: ce.box(['List', 1, 2, 3]) }).json).toEqual([
        'At',
        ['List', 1, 2, 3],
        'n',
      ]);
      expect(e.subs({ A: 'Integers' }).isSame(ce.parse('\\Z_{(n)}'))).toBe(true);
    });
    test('map() keeps the marker', () => {
      expect(
        e.map((x) => (x.symbol === 'n' ? ce.symbol('m') : x), {
          canonical: true,
          recursive: true,
        }).json
      ).toEqual(['Subscript', 'A', ['Delimiter', 'm']]);
    });
    test('replace() keeps the marker', () => {
      expect(
        e.replace([{ match: ce.symbol('n'), replace: ce.symbol('m') }], {
          recursive: true,
        })?.json
      ).toEqual(['Subscript', 'A', ['Delimiter', 'm']]);
    });
    test('the structural form keeps the marker', () => {
      expect(e.structural.canonical.isSame(e)).toBe(true);
    });
    test('a partial canonical form gives the same result', () => {
      const viaFlatten = (expr: MathJsonExpression) =>
        ce.box(expr, { form: ['Flatten'] }).canonical.json;
      expect(viaFlatten(['Subscript', 'A', ['Add', 'n', 0]])).toEqual(marked);
      expect(viaFlatten(marked)).toEqual(marked);
      expect(viaFlatten(['Subscript', 'A', 'n'])).toBe('A_n');
    });
  });

  test('a symbol passed as a canonical expression is a value', () => {
    const ce = new ComputeEngine();
    expect(ce.function('Subscript', [ce.symbol('A'), ce.symbol('n')]).json).toEqual(
      marked
    );
  });

  test('a written name stays a name in each partial form', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const written: MathJsonExpression = ['Subscript', 'A', 'n'];
    expect(ce.box(written, { form: 'structural' }).canonical.json).toBe('A_n');
    expect(ce.box(written, { form: ['Number'] }).canonical.json).toBe('A_n');
    expect(ce.parse('A_{\\pi}').json).toBe(
      ce.parse('A_{\\pi}', { form: 'structural' }).canonical.json
    );
  });

  test('a rewrite of a written name keeps the name', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const written = ce.box(['Subscript', 'A', 'n'], { form: 'structural' });
    expect(written.subs({ A: 'B' }, { canonical: true }).json).toBe('B_n');
    expect(
      written.map((x) => x, { canonical: true, recursive: false }).json
    ).toBe('A_n');
    const held = ce.box(['Hold', ['Subscript', 'A', 'n']]);
    const replaced = held.replace(
      [{ match: ce.symbol('A'), replace: ce.symbol('B') }],
      { recursive: true }
    );
    expect(replaced?.op1.canonical.json).toBe('B_n');
  });

  test('a canonical form keeps the source offsets of a written index', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.declare('k', 'integer');
    const index = ce.symbol('k', { metadata: { sourceOffsets: [3, 4] } });
    const written = ce.function('Subscript', [ce.symbol('L'), index], {
      form: 'structural',
    });
    expect(written.canonical.json).toEqual(['At', 'L', 'k']);
    expect(written.canonical.op2?.sourceOffsets).toEqual([3, 4]);
  });

  test('a base that is not a symbol needs no marker', () => {
    expect(json('(x+1)_{n+0}')).toEqual(['Subscript', ['Add', 'x', 1], 'n']);
  });

  test('parentheses outside a subscript are still only grouping', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.parse('(x)').json).toBe('x');
    expect(ce.parse('(x)+1').json).toEqual(['Add', 'x', 1]);
    expect(ce.box(['Delimiter', 'x']).json).toBe('x');
    expect(ce.box(['Delimiter', 'x'], { form: 'raw' }).canonical.json).toBe('x');
    expect(
      ce.box(['Add', ['Delimiter', 'x'], 1], { form: 'structural' }).canonical
        .json
    ).toEqual(['Add', 'x', 1]);
    expect(ce.parse('(x)+1').subs({ x: 'y' }).json).toEqual(['Add', 'y', 1]);
    expect(ce.function('Delimiter', [ce.symbol('x')]).json).toBe('x');
    expect(ce.box(['Delimiter', ce.symbol('x')]).json).toBe('x');
    expect(
      ce.parse('(\\pi)^2', { form: 'structural' }).canonical.isSame(ce.parse('\\pi^2'))
    ).toBe(true);
    expect(
      ce.box(['Power', ['Delimiter', 'x'], 2], { form: ['Number'] }).canonical.json
    ).toEqual(['Power', 'x', 2]);
    expect(
      ce.parse('(x)-x', { form: 'raw' }).subs({ x: ce.symbol('y') }).canonical.simplify()
        .json
    ).toBe(0);
  });
});

describe('an index whose canonical form is a literal', () => {
  test.each([
    ['A_{(3)}', 'A_3'],
    ['A_{3+0}', 'A_3'],
    ['A_{("x")}', 'A_x'],
  ])('%s is the compound symbol %s', (latex, name) => {
    expect(json(latex)).toBe(name);
  });

  test('a negative index is not a part of a name', () => {
    expect(json('A_{(-1)}')).toEqual(['Subscript', 'A', -1]);
  });
});

describe('the written name of a base survives a rebuild', () => {
  test.each([
    ['e_{n+0}', 'e_3'],
    ['e_{n+1}', 'e_4'],
    ['i_{n+0}', 'i_3'],
    ['i_{n+1}', 'i_4'],
  ])('%s with n = 3', (latex, name) => {
    const ce = new ComputeEngine();
    expect(ce.parse(latex).subs({ n: 3 }).evaluate().json).toBe(name);
    const assigned = new ComputeEngine();
    assigned.assign('n', 3);
    expect(assigned.parse(latex).evaluate().json).toBe(name);
  });

  test('a canonical name as a MathJSON base is the written name', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Subscript', 'ExponentialE', 'n']).json).toBe('e_n');
  });

  test.each(['e_{n+0}', 'i_{n+0}'])('%s reads back as written', (latex) => {
    const ce = new ComputeEngine();
    const e = ce.parse(latex);
    expect(ce.box(e.json).isSame(e)).toBe(true);
    expect(ce.parse(e.latex).isSame(e)).toBe(true);
    expect(e.simplify().isSame(e)).toBe(true);
  });
});

describe('the LaTeX of an expression index reads back as written', () => {
  test.each([
    ['A_{(n)}', 'A_{(n)}'],
    ['A_{n+1}', 'A_{n+1}'],
    ['A_{n\\cdot m}', 'A_{(mn)}'],
    ['A_{(nm)}', 'A_{(mn)}'],
    ['A_{(2n)}', 'A_{(2n)}'],
    ['A_{(2(n+1))}', 'A_{2(n+1)}'],
    ['A_{(i)}', 'A_{(\\imaginaryI)}'],
    ['A_{(2i)}', 'A_{(2\\imaginaryI)}'],
    ['A_{i\\cdot n}', 'A_{(\\imaginaryI n)}'],
    ['A_{2+i}', 'A_{2+\\imaginaryI}'],
    ['A_{\\frac{n}{m}}', 'A_{\\frac{n}{m}}'],
    ['\\sum_{n=1}^{3} A_{(n)}', '\\sum_{n=1}^3A_{(n)}'],
  ])('%s', (latex, written) => {
    const ce = new ComputeEngine();
    const e = ce.parse(latex);
    expect(e.latex).toBe(written);
    expect(ce.parse(e.latex).isSame(e)).toBe(true);
    expect(ce.box(e.json).isSame(e)).toBe(true);
  });

  test('a term of an indexed sequence keeps the plain notation', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\{a_n\\}_{n=1}^{\\infty}').latex).toBe(
      '\\left\\{a_{n}\\right\\}_{n=1}^{\\infty}'
    );
  });
});
