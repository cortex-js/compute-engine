import { ComputeEngine } from '../../src/compute-engine';

/**
 * Component-wise broadcast of a `broadcastable` operator over a TUPLE
 * operand: `Sin((1, 2))` evaluates to `(sin 1, sin 2)`, the same rule the
 * arithmetic operators already apply to `(1, 2) · 3` and the one the compiled
 * kernels apply. Before this behavior the interpreter left such an
 * application inert while the compiled lane broadcast it, so the two lanes
 * disagreed.
 *
 * A tuple stays ATOMIC for the heads that give it a meaning of their own: the
 * `'tuples'`-exempt arithmetic heads (component-wise in their own handlers),
 * `Abs`/`Hypot` (the point's norm), and the relational heads (a point is
 * compared as one value).
 */

const ce = new ComputeEngine();

/** Run the expression through the JavaScript compile target, or report why
 * the target declined. Constant folding is off so the compiled LOWERING is
 * exercised rather than an interpreter-computed literal. */
function compiled(json: any): unknown | string {
  try {
    const r = (ce as any)._compile(ce.box(json), {
      fallback: false,
      constantFold: false,
    });
    if (!r?.run) return 'NO-RUN';
    return r.run({});
  } catch (e) {
    return 'DECLINE';
  }
}

describe('tuple broadcast — unary component-wise heads', () => {
  test('Sqrt over a tuple maps each component', () => {
    expect(
      ce
        .box(['Sqrt', ['Tuple', 4, 9]])
        .evaluate()
        .toString()
    ).toBe('(2, 3)');
  });

  test('Sin over a tuple maps each component', () => {
    expect(
      ce
        .box(['Sin', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('(sin(1), sin(2))');
  });

  test('the result is a TUPLE, not a list', () => {
    const v = ce.box(['Sqrt', ['Tuple', 4, 9]]).evaluate();
    expect(v.operator).toBe('Tuple');
    expect(v.type.matches('tuple<integer, integer>')).toBe(true);
  });

  test('the DECLARED type is a tuple of the per-component type', () => {
    expect(ce.box(['Sin', ['Tuple', 1, 2]]).type.toString()).toBe(
      'tuple<number, number>'
    );
  });

  test('an operand that only BECOMES a tuple at evaluation broadcasts too', () => {
    expect(
      ce
        .box(['Sin', ['Multiply', ['Tuple', 1, 2], 3]])
        .evaluate()
        .toString()
    ).toBe('(sin(3), sin(6))');
  });

  test('a nested tuple broadcasts one rank at a time', () => {
    expect(
      ce
        .box(['Sin', ['Tuple', ['Tuple', 1, 2], 3]])
        .evaluate()
        .toString()
    ).toBe('((sin(1), sin(2)), sin(3))');
  });
});

describe('tuple broadcast — binary component-wise heads', () => {
  test('a scalar operand is lifted into every component', () => {
    expect(
      ce
        .box(['Power', ['Tuple', 1, 2], 2])
        .evaluate()
        .toString()
    ).toBe('(1, 4)');
  });

  test('two tuples zip component by component', () => {
    expect(
      ce
        .box(['Power', ['Tuple', 1, 2], ['Tuple', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('(1, 16)');
  });

  test('two tuples of different lengths are an error, not a truncation', () => {
    const v = ce.box(['Power', ['Tuple', 1, 2], ['Tuple', 1, 2, 3]]).evaluate();
    expect(v.operator).toBe('Error');
    expect(v.toString()).toContain('incompatible-dimensions');
  });
});

describe('tuple broadcast — heads that keep a tuple atomic', () => {
  test('Abs answers the point NORM', () => {
    expect(
      ce
        .box(['Abs', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('sqrt(5)');
  });

  test('Hypot takes a point through its norm', () => {
    expect(
      ce
        .box(['Hypot', ['Tuple', 1, 2], 2])
        .evaluate()
        .toString()
    ).toBe('3');
  });

  test('the arithmetic heads keep their own component-wise handlers', () => {
    expect(
      ce
        .box(['Multiply', ['Tuple', 1, 2], 3])
        .evaluate()
        .toString()
    ).toBe('(3, 6)');
    expect(
      ce
        .box(['Add', ['Tuple', 1, 2], ['Tuple', 10, 20]])
        .evaluate()
        .toString()
    ).toBe('(11, 22)');
    expect(
      ce
        .box(['Negate', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('(-1, -2)');
  });

  test('an ordering comparison stays inert', () => {
    expect(ce.box(['Less', ['Tuple', 1, 2], 3]).evaluate().operator).toBe(
      'Less'
    );
  });

  test('Equal compares two points as ONE value', () => {
    expect(
      ce
        .box(['Equal', ['Tuple', 1, 2], ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('"True"');
  });

  test('a non-broadcastable head is unaffected', () => {
    // `Length`, `First` and `Reverse` read the tuple as one collection.
    expect(
      ce
        .box(['Length', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('2');
    expect(
      ce
        .box(['First', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('1');
    expect(
      ce
        .box(['Reverse', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[2,1]');
  });
});

describe('tuple broadcast — a list operand still supplies the cells', () => {
  test('a tuple zipped against a list yields a List', () => {
    const v = ce.box(['Power', ['Tuple', 1, 2], ['List', 3, 4]]).evaluate();
    expect(v.operator).toBe('List');
    expect(v.toString()).toBe('[1,16]');
  });

  describe('a tuple beside a list of another length is an error', () => {
    // A built-in operator reads the tuple by position, so the tuple supplies
    // cells and its length counts, as for two lists.
    const mismatch = (detail: string) =>
      `Error("incompatible-dimensions", "${detail}")`;

    test.each([
      ['Power', ['Tuple', 1, 2], ['List', 3, 4, 5], '2 vs 3'],
      ['Power', ['List', 3, 4, 5], ['Tuple', 1, 2], '3 vs 2'],
      ['Power', ['Tuple', 1, 2, 3], ['List', 4, 5], '3 vs 2'],
      ['Arctan2', ['List', 3, 4, 5], ['Tuple', 1, 2], '3 vs 2'],
      ['Mod', ['Tuple', 1, 2], ['List', 3, 4, 5], '2 vs 3'],
      ['Less', ['Tuple', 1, 2], ['List', 3, 4, 5], '2 vs 3'],
      ['ElementMax', ['Tuple', 1, 2], ['List', 3, 4, 5], '2 vs 3'],
    ] as const)('%s(%j, %j)', (head, a, b, detail) => {
      const expr = ce.box([head, a, b] as any);
      expect(expr.evaluate().toString()).toBe(mismatch(detail));
      expect(expr.N().toString()).toBe(mismatch(detail));
    });

    test('with evaluateAsync()', async () => {
      const expr = ce.box(['Power', ['Tuple', 1, 2], ['List', 3, 4, 5]]);
      expect((await expr.evaluateAsync()).toString()).toBe(mismatch('2 vs 3'));
    });

    test('a symbol that holds the tuple', () => {
      const engine = new ComputeEngine();
      engine.assign('P', engine.box(['Tuple', 1, 2]));
      const expr = engine.box(['Power', 'P', ['List', 3, 4, 5]]);
      expect(expr.evaluate().toString()).toBe(mismatch('2 vs 3'));
    });

    test.each(['tuple<real, real>', 'tuple'])(
      'a symbol declared %s with no value is not compared',
      (type) => {
        const engine = new ComputeEngine();
        engine.declare('V', type);
        const expr = engine.box(['Power', 'V', ['List', 3, 4, 5]]);
        expect(expr.evaluate().toString()).toBe('[V^3,V^4,V^5]');
      }
    );

    test('a tuple type that an assignment can replace is not compared', () => {
      // The call infers the type of `x`, and that type does not limit the
      // value that the assignment gives.
      const inferred = new ComputeEngine();
      inferred.declare('h', '(tuple<real, real>) -> real');
      inferred.box(['h', 'x']);
      const power = () => inferred.box(['Power', 'x', ['List', 3, 4, 5]]);
      expect(power().evaluate().toString()).toBe('[x^3,x^4,x^5]');
      inferred.assign('x', inferred.box(['List', 1, 2, 3]));
      expect(power().evaluate().toString()).toBe('[1,16,243]');

      // `forget()` keeps the type of the old value as an inferred type.
      const forgotten = new ComputeEngine();
      forgotten.assign('P', forgotten.box(['Tuple', 1, 2]));
      forgotten.forget('P');
      const sine = forgotten.box(['Power', ['Sin', 'P'], ['List', 3, 4, 5]]);
      expect(sine.evaluate().toString()).toBe(
        '[sin(P)^3,sin(P)^4,sin(P)^5]'
      );
      forgotten.assign('P', 2);
      expect(
        forgotten.box(['Power', 'P', ['List', 3, 4, 5]]).evaluate().toString()
      ).toBe('[8,16,32]');
    });

    test('an application that gives a tuple', () => {
      const engine = new ComputeEngine();
      engine.assign('Q', engine.box(['Tuple', 1, 2]));
      const expr = engine.box(['Power', ['Sin', 'Q'], ['List', 3, 4, 5]]);
      expect(expr.evaluate().toString()).toBe(mismatch('2 vs 3'));
    });

    test('a comparison with a computed list and a list with no value', () => {
      const engine = new ComputeEngine();
      engine.declare('s', 'list<real>');
      engine.assign('g', engine.box(['Function', ['List', 3, 4, 5]]));
      const expr = engine.box(['Less', ['Tuple', 1, 2], ['g'], 's']);
      expect(expr.evaluate().toString()).toBe(mismatch('2 vs 3'));
    });

    test('an operand that becomes a list only at evaluation', async () => {
      const engine = new ComputeEngine();
      engine.assign('g', engine.box(['Function', ['List', 3, 4, 5]]));
      const expr = engine.box(['Power', ['Tuple', 1, 2], ['g']]);
      expect(expr.evaluate().toString()).toBe(mismatch('2 vs 3'));
      expect((await expr.evaluateAsync()).toString()).toBe(mismatch('2 vs 3'));
    });

    test('an empty list', () => {
      const expr = ce.box(['Power', ['Tuple', 1, 2], ['List']]);
      expect(expr.evaluate().toString()).toBe(mismatch('2 vs 0'));
    });

    test('a list too long for an eager broadcast', () => {
      const expr = ce.box(['Power', ['Tuple', 1, 2], ['Range', 1, 1000000]]);
      expect(expr.evaluate().toString()).toBe(mismatch('2 vs 1000000'));
    });

    test('an unbounded list', () => {
      const expr = ce.box(['Power', ['Tuple', 1, 2], ['Cycle', ['List', 1, 2]]]);
      expect(expr.evaluate().toString()).toBe(mismatch('2 vs Infinity'));
    });

    test('a list with no value beside the two that disagree', () => {
      const engine = new ComputeEngine();
      engine.declare('s', 'list<real>');
      const expr = engine.box([
        'ElementMax',
        ['Tuple', 1, 2],
        ['List', 3, 4, 5],
        's',
      ]);
      expect(expr.evaluate().toString()).toBe(mismatch('2 vs 3'));
    });

    test('a list with no value is not compared', () => {
      const engine = new ComputeEngine();
      engine.declare('s', 'list<real>');
      const expr = engine.box(['Power', ['Tuple', 1, 2], 's']);
      expect(expr.evaluate().operator).not.toBe('Error');
    });
  });

  describe('a tuple that is not read by position has no length to agree', () => {
    test('a head that combines points repeats the point in each cell', () => {
      const v = ce.box(['Multiply', ['Tuple', 1, 2], ['List', 3, 4, 5]]);
      expect(v.evaluate().toString()).toBe('[(3, 6),(4, 8),(5, 10)]');
    });

    test('a head that reads the norm of the point', () => {
      const v = ce.box(['Hypot', ['Tuple', 3, 4], ['List', 1, 2, 3]]);
      expect(v.evaluate().operator).toBe('List');
      expect(v.evaluate().nops).toBe(3);
    });

    test('a user function repeats the tuple in each cell', async () => {
      const engine = new ComputeEngine();
      engine.assign('f', engine.box(['Function', ['Power', 'a', 'b'], 'a', 'b']));
      const expr = engine.box(['f', ['Tuple', 1, 2], ['List', 3, 4, 5]]);
      expect(expr.evaluate().toString()).toBe('[(1, 8),(1, 16),(1, 32)]');
      expect((await expr.evaluateAsync()).toString()).toBe(
        '[(1, 8),(1, 16),(1, 32)]'
      );
    });

    test('a pairing constructor stops at the shorter operand', () => {
      const v = ce.box(['Zip', ['Tuple', 1, 2], ['List', 3, 4, 5]]);
      expect(v.count).toBe(2);
    });
  });

  test('a SET sibling is not a source of cells', () => {
    // A set is a collection but not an INDEXED one, so it has no component
    // order to pair with the tuple's components. The tuple broadcast declines
    // the whole application rather than letting the set fan the tuple out
    // over its members, and the operand mismatch is reported exactly as it is
    // for a scalar head applied to a set (`Power(5, {3, 4})`).
    const v = ce.box(['Power', ['Tuple', 1, 2], ['Set', 3, 4]]).evaluate();
    expect(v.operator).toBe('Error');
    expect(v.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "number", "set<integer>"), Set(3, 4))'
    );
  });
});

describe('tuple broadcast — the declared type stays in step with the value', () => {
  test('a tuple with a LIST component types as `error`', () => {
    // The VALUE is an `incompatible-type` error (user decision 2026-09-25):
    // a tuple with a list coordinate is data, not a point, and a function
    // applied to each coordinate of it gave a tuple of lists
    // (`([sin(1),sin(2)], sin(3))`) that no consumer can use. The declared
    // type says so: `error`, not the wide bare `tuple` it was.
    const e = ce.box(['Sin', ['Tuple', ['List', 1, 2], 3]]);
    expect(e.type.toString()).toBe('error');
    const v = e.evaluate();
    expect(v.operator).toBe('Error');
    expect(v.op1.op1?.string).toBe('incompatible-type');
  });

  test('an EMPTY tuple neither broadcasts nor types as a tuple', () => {
    // There is no component to map, so the application stays inert. The
    // declared type must not promise a tuple the value never becomes.
    const e = ce.box(['Sin', ['Tuple']]);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().operator).not.toBe('Tuple');
    expect(e.evaluate().toString()).toBe('sin(())');
  });
});

describe('tuple broadcast — evaluate/compiled parity', () => {
  // Each cell: the compiled JavaScript kernel already broadcast over the
  // tuple; the interpreter now agrees instead of staying inert.
  const cases: [string, any, string][] = [
    ['Sin', ['Sin', ['Tuple', 1, 2]], '(sin(1), sin(2))'],
    ['Exp', ['Exp', ['Tuple', 0, 1]], '(1, e)'],
    ['Sqrt', ['Sqrt', ['Tuple', 4, 9]], '(2, 3)'],
    ['Floor', ['Floor', ['Tuple', 1.5, 2.7]], '(1, 2)'],
    ['Power', ['Power', ['Tuple', 1, 2], 2], '(1, 4)'],
    ['Mod', ['Mod', ['Tuple', 1, 2], 2], '(1, 0)'],
  ];

  test.each(cases)('%s agrees with the compiled kernel', (_name, json) => {
    const interpreted = ce.box(json).evaluate();
    expect(interpreted.operator).toBe('Tuple');
    const c = compiled(json);
    expect(Array.isArray(c)).toBe(true);
    const asNumbers = interpreted.ops!.map((x) => x.N().re);
    expect(asNumbers).toEqual(
      (c as number[]).map((x) => expect.closeTo(x, 10) as unknown as number)
    );
  });

  test.each(cases)('%s evaluates to the expected components', (_n, json, s) => {
    expect(ce.box(json).evaluate().toString()).toBe(s);
  });
});

describe('tuple broadcast — every entry route', () => {
  test('the box route broadcasts', () => {
    expect(
      ce
        .box(['Sqrt', ['Tuple', 4, 9]])
        .evaluate()
        .toString()
    ).toBe('(2, 3)');
  });

  test('the parse route broadcasts', () => {
    expect(ce.parse('\\sqrt{(4, 9)}').evaluate().toString()).toBe('(2, 3)');
  });

  test('the function route broadcasts', () => {
    expect(
      ce
        .function('Sqrt', [ce.function('Tuple', [ce.box(4), ce.box(9)])])
        .evaluate()
        .toString()
    ).toBe('(2, 3)');
  });

  test('the async route broadcasts like the sync one', async () => {
    const v = await ce.box(['Sqrt', ['Tuple', 4, 9]]).evaluateAsync();
    expect(v.toString()).toBe('(2, 3)');
  });
});
