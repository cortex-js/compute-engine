import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/free-functions';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';
import { describe as describeOperand } from '../../src/compute-engine/boxed-expression/operand-descriptor';

/**
 * REST PARAMETERS of a function literal.
 *
 * A `Function` literal may end with one rest parameter, spelled
 * `["Spread", symbol]` in MathJSON and `...rest` in Epsil. It has no
 * positional slot: applying the literal binds its name to a `Tuple` of every
 * argument from that position onwards, empty when the call supplies none.
 */

/** The MathJSON of an Epsil source line, with the parser's source offsets
 * removed so two parses compare by shape alone. */
function epsilJson(source: string): unknown {
  const [ast, diagnostics] = parseEpsil(source);
  expect(diagnostics).toEqual([]);
  return stripOffsets(ast);
}

function stripOffsets(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(stripOffsets);
  if (x !== null && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>))
      if (k !== 'sourceOffsets') out[k] = stripOffsets(v);
    return out;
  }
  return x;
}

/** Evaluate an Epsil program and return the result as a string, asserting
 * that it parsed without a diagnostic. */
function epsilValue(source: string): string {
  const [ast, diagnostics] = parseEpsil(source);
  expect(diagnostics).toEqual([]);
  return new ComputeEngine()
    .box(ast as MathJsonExpression)
    .evaluate()
    .toString();
}

/** Apply `fn` to `args` (numbers), evaluated. */
function applyNumbers(
  ce: ComputeEngine,
  fn: ReturnType<ComputeEngine['box']>,
  ...args: number[]
): string {
  return ce
    .function('Apply', [fn, ...args.map((a) => ce.number(a))])
    .evaluate()
    .toString();
}

describe('Rest parameter — construction routes', () => {
  test('box route: the literal keeps its Spread parameter operand', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Tuple', 'a', 'rest'],
      'a',
      ['Spread', 'rest'],
    ]);
    expect(f.json).toEqual([
      'Function',
      ['Block', ['Tuple', 'a', 'rest']],
      'a',
      ['Spread', 'rest'],
    ]);
  });

  test('ce.function route: the literal keeps its Spread parameter operand', () => {
    const ce = new ComputeEngine();
    const f = ce.function('Function', [
      ce.function('Tuple', [ce.symbol('a'), ce.symbol('rest')]),
      ce.symbol('a'),
      ce.function('Spread', [ce.symbol('rest')]),
    ]);
    expect(f.json).toEqual([
      'Function',
      ['Block', ['Tuple', 'a', 'rest']],
      'a',
      ['Spread', 'rest'],
    ]);
  });

  test('Epsil parse route: `(a, ...rest) => …` lowers to a Spread parameter', () => {
    expect(epsilJson('(a, ...rest) => a')).toEqual({
      fn: [
        'Function',
        { sym: 'a' },
        { sym: 'a' },
        { fn: ['Spread', { sym: 'rest' }] },
      ],
    });
  });

  test('Epsil parse route: `(...args) => …` is a rest-only literal', () => {
    expect(epsilJson('(...args) => args')).toEqual({
      fn: ['Function', { sym: 'args' }, { fn: ['Spread', { sym: 'args' }] }],
    });
  });

  test('the rest name is bound in the literal scope on all three routes', () => {
    // `zz` is the control: it is genuinely free, so a route that reports only
    // `zz` has bound the rest name.
    const ce = new ComputeEngine();
    const body = ['Tuple', 'a', 'rest', 'zz'];
    expect(
      ce.box(['Function', body, 'a', ['Spread', 'rest']]).unknowns
    ).toEqual(['zz']);
    expect(
      ce.function('Function', [
        ce.function('Tuple', [
          ce.symbol('a'),
          ce.symbol('rest'),
          ce.symbol('zz'),
        ]),
        ce.symbol('a'),
        ce.function('Spread', [ce.symbol('rest')]),
      ]).unknowns
    ).toEqual(['zz']);
    const [ast] = parseEpsil('(a, ...rest) => (a, rest, zz)');
    expect(ce.box(ast as MathJsonExpression).unknowns).toEqual(['zz']);
  });
});

describe('Rest parameter — binding', () => {
  test('binds the empty tuple, one argument, and many', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Tuple', 'a', 'rest'],
      'a',
      ['Spread', 'rest'],
    ]);
    expect(applyNumbers(ce, f, 1)).toBe('(1, ())');
    expect(applyNumbers(ce, f, 1, 2)).toBe('(1, (2))');
    expect(applyNumbers(ce, f, 1, 2, 3)).toBe('(1, (2, 3))');
  });

  test('a rest-only literal binds every argument', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', 'args', ['Spread', 'args']]);
    expect(applyNumbers(ce, f)).toBe('()');
    expect(applyNumbers(ce, f, 1, 2, 3)).toBe('(1, 2, 3)');
  });

  test('the rest tuple is a value the body can compute with', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Length', 'rest'], ['Spread', 'rest']]);
    expect(applyNumbers(ce, f, 7, 8, 9)).toBe('3');
  });
});

describe('Rest parameter — splicing it back into a call', () => {
  test('Apply(g, Spread(rest)) forwards the collected arguments', () => {
    // The motivating use: a wrapper that takes any argument list and passes it
    // on unchanged. `g` has no definition, so the result stays symbolic and
    // shows the argument list the callee received.
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Conjugate', ['Apply', 'g', ['Spread', 'args']]],
      ['Spread', 'args'],
    ]);
    expect(applyNumbers(ce, f, 1, 2)).toBe('Conjugate(g(1, 2))');
  });

  test('Epsil: `(...args) => Conjugate(g(...args))` computes through', () => {
    const ce = new ComputeEngine();
    const [ast, diagnostics] = parseEpsil(
      'g(x, y) = x + y; f = (...args) => Conjugate(g(...args)); f(1, 2)'
    );
    expect(diagnostics).toEqual([]);
    expect(
      ce
        .box(ast as MathJsonExpression)
        .evaluate()
        .toString()
    ).toBe('3');
  });
});

describe('Rest parameter — shadowing', () => {
  // A nested literal's rest parameter binds its own name. The name is only
  // reachable through the literal that declares it, so an inner one hides an
  // outer one exactly as an ordinary parameter does.

  test('an inner rest parameter shadows an outer one of the same name', () => {
    const ce = new ComputeEngine();
    ce.declare('chi', 'function');
    const f = ce.box([
      'Function',
      [
        'Apply',
        ['Function', ['Apply', 'chi', ['Spread', 'r']], ['Spread', 'r']],
        ['Spread', 'r'],
      ],
      ['Spread', 'r'],
    ]);
    expect(
      ce
        .function('Apply', [f, ce.number(5)])
        .evaluate()
        .toString()
    ).toBe('chi(5)');
  });

  test('nested rest parameters with different names compose', () => {
    const ce = new ComputeEngine();
    ce.declare('chi', 'function');
    const f = ce.box([
      'Function',
      [
        'Apply',
        ['Function', ['Apply', 'chi', ['Spread', 'r']], ['Spread', 'r']],
        ['Spread', 't'],
      ],
      ['Spread', 't'],
    ]);
    expect(
      ce
        .function('Apply', [f, ce.number(5)])
        .evaluate()
        .toString()
    ).toBe('chi(5)');
  });

  test('the control: ordinary nested parameters of the same name shadow', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Apply', ['Function', ['Add', 't', 1], 't'], 't'],
      't',
    ]);
    expect(
      ce
        .function('Apply', [f, ce.number(5)])
        .evaluate()
        .toString()
    ).toBe('6');
  });

  test('a literal with a rest parameter is inert when evaluated on its own', () => {
    // Evaluating the literal must not read an ambient symbol of the
    // parameter's name: the parameter list is a binder, never an argument
    // list, so nothing in it is spliced.
    const ce = new ComputeEngine();
    ce.declare('chi', 'function');
    const f = ce.box([
      'Function',
      ['Apply', 'chi', ['Spread', 'r']],
      ['Spread', 'r'],
    ]);
    ce.assign('r', ce.function('Tuple', [ce.number(5)]));
    expect(f.evaluate().json).toEqual(f.json);
  });
});

describe('Rest parameter — arity', () => {
  test('a rest parameter removes the upper arity limit', () => {
    // Without a rest parameter, a surplus argument throws.
    const ce = new ComputeEngine();
    const fixed = ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']);
    expect(() => applyNumbers(ce, fixed, 1, 2, 3)).toThrow(
      /Too many arguments/
    );
    const rest = ce.box([
      'Function',
      ['Tuple', 'a', 'b', 'more'],
      'a',
      'b',
      ['Spread', 'more'],
    ]);
    expect(applyNumbers(ce, rest, 1, 2, 3, 4)).toBe('(1, 2, (3, 4))');
  });

  test('too few arguments curry, and the residual keeps the rest parameter', () => {
    // Currying — not an error — is what a short call does to a literal with or
    // without a rest parameter. The residual is applied again below to show
    // that its own rest parameter still collects.
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Tuple', 'a', 'b', 'more'],
      'a',
      'b',
      ['Spread', 'more'],
    ]);
    const curried = ce.function('Apply', [f, ce.number(1)]).evaluate();
    expect(curried.json).toEqual([
      'Function',
      ['Block', ['Tuple', 1, '_1', '_2']],
      '_1',
      ['Spread', '_2'],
    ]);
    expect(applyNumbers(ce, curried, 5, 6, 7)).toBe('(1, 5, (6, 7))');
  });
});

describe('Rest parameter — ill-formed literals', () => {
  test('a rest parameter that is not last is rejected', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'a', 1], ['Spread', 'r'], 'a']);
    expect(f.toString()).toContain('Error("unexpected-argument"');
  });

  test('a Spread holding something other than a symbol is rejected', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', 'a', 1],
      'a',
      ['Spread', ['Tuple', 'x']],
    ]);
    expect(f.toString()).toContain('Error("expected-a-symbol"');
  });

  test('an annotated rest parameter is rejected', () => {
    // `Typed(Spread(r), …)` is not supported: a rest parameter states no type.
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', 'a', 1],
      'a',
      ['Typed', ['Spread', 'r'], "'list<integer>'"],
    ]);
    expect(f.toString()).toContain('Error("expected-a-symbol"');
  });

  test('Epsil rejects a rest parameter that is not last', () => {
    const [, diagnostics] = parseEpsil('(a, ...rest, b) => a');
    expect(diagnostics.map((d) => d.message)).toEqual([['symbol-expected']]);
  });

  test('Epsil rejects a spread in a parenthesized group that is not a parameter list', () => {
    const [, diagnostics] = parseEpsil('x = (a, ...b)');
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['unexpected-symbol', '...'],
    ]);
  });
});

describe('Rest parameter — typing', () => {
  test('the literal signature gains a variadic argument', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Tuple', 'a', 'rest'],
      'a',
      ['Spread', 'rest'],
    ]);
    expect(f.type.toString()).toBe(
      '(unknown, any*) -> tuple<unknown, unknown>'
    );
  });

  test('a rest-only literal has an all-variadic signature', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Length', 'args'], ['Spread', 'args']]);
    expect(f.type.toString()).toBe('(any*) -> integer');
  });
});

describe('Rest parameter — Epsil serialization', () => {
  test.each([
    '(a, ...rest) => a',
    '(...args) => args',
    '(a: integer, ...rest) => a',
  ])('round-trips %p', (source) => {
    const [ast, diagnostics] = parseEpsil(source);
    expect(diagnostics).toEqual([]);
    const text = serializeEpsil(ast as MathJsonExpression);
    expect(text).toBe(source);
    expect(stripOffsets(parseEpsil(text)[0])).toEqual(stripOffsets(ast));
  });
});

describe('Rest parameter — compilation', () => {
  test('the compiler declines cleanly instead of emitting a positional slot', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'a', 1], 'a', ['Spread', 'rest']]);
    const result = compile(f);
    expect(result.success).toBe(false);
  });
});

describe('Rest parameter — argument errors', () => {
  it('propagates an argument that errors when evaluated, on the held pipe route', () => {
    const ce = new ComputeEngine();
    ce.declare('boom', {
      signature: '() -> number',
      evaluate: (_ops, { engine }) => engine.error('boom-failed'),
    });
    // The pipe hands its topic to the callee unevaluated; the trailing
    // arguments are collected only after evaluation, so the error bubbles
    // exactly as it does for an ordinary parameter.
    const viaRest = ce
      .box(['Pipe', ['boom'], ['Function', 42, ['Spread', 'r']]])
      .evaluate();
    const viaParam = ce
      .box(['Pipe', ['boom'], ['Function', 42, 'a']])
      .evaluate();
    expect(viaParam.operator).toBe('Error');
    expect(viaRest.json).toEqual(viaParam.json);
  });
});

describe('Rest parameter — named definitions', () => {
  // A rest parameter is part of a definition's parameter list, not only of an
  // anonymous lambda's: the arrow a NAMED definition installs must state the
  // same "N arguments or more" contract the literal's own arrow does.

  test('an assigned symbol carries the variadic tail in its signature', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box(['Function', ['Length', 'rest'], 'a', ['Spread', 'rest']])
    );
    expect(ce.symbol('f').type.toString()).toBe('(unknown, any*) -> integer');
  });

  test('the Assign box route agrees with ce.assign', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'g',
      ['Function', ['Length', 'rest'], 'a', ['Spread', 'rest']],
    ]).evaluate();
    expect(ce.symbol('g').type.toString()).toBe('(unknown, any*) -> integer');
  });

  test('a rest-only definition has an all-variadic signature', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box(['Function', ['Length', 'args'], ['Spread', 'args']])
    );
    expect(ce.symbol('f').type.toString()).toBe('(any*) -> integer');
  });

  test('call arities on the box route', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box(['Function', ['Length', 'rest'], 'a', ['Spread', 'rest']])
    );
    expect(ce.box(['f', 1]).evaluate().toString()).toBe('0');
    expect(ce.box(['f', 1, 2]).evaluate().toString()).toBe('1');
    expect(ce.box(['f', 1, 2, 3, 4]).evaluate().toString()).toBe('3');
  });

  test('a type-strict definition accepts the variadic tail and refuses a short call', () => {
    // An annotated fixed parameter turns apply-time validation on. The tail
    // stays unchecked (a rest parameter is `any*`), so extra arguments are
    // accepted, while the missing FIXED argument is reported as it is for any
    // other annotated parameter.
    const ce = new ComputeEngine();
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Length', 'rest'],
        ['Typed', 'a', "'integer'"],
        ['Spread', 'rest'],
      ])
    );
    expect(ce.symbol('g').type.toString()).toBe(
      '(a: integer, any*) -> integer'
    );
    expect(ce.box(['g', 1]).evaluate().toString()).toBe('0');
    expect(ce.box(['g', 1, 2, 3]).evaluate().toString()).toBe('2');
    expect(ce.box(['g']).toString()).toContain('missing');
  });

  test('a declared signature must be variadic where the literal is', () => {
    const literal = () =>
      ce.box(['Function', ['Length', 'rest'], 'a', ['Spread', 'rest']]);
    let ce = new ComputeEngine();
    ce.declare('f', '(integer, any*) -> integer');
    expect(() => ce.assign('f', literal())).not.toThrow();

    ce = new ComputeEngine();
    ce.declare('f', '(integer, integer) -> integer');
    expect(() => ce.assign('f', literal())).toThrow(/1 or more/);

    // `any+` requires a non-empty tail; a rest parameter admits an empty one.
    ce = new ComputeEngine();
    ce.declare('f', '(integer, any+) -> integer');
    expect(() => ce.assign('f', literal())).toThrow(/1 or more/);
  });

  test('the operand descriptor marks the rest parameter', () => {
    const ce = new ComputeEngine();
    const s = describeOperand(
      ce.box(['Function', ['Length', 'rest'], 'a', ['Spread', 'rest']])
    ).structureOf?.();
    expect(s?.kind).toBe('function-literal');
    if (s?.kind === 'function-literal') {
      expect(s.parameters).toEqual([
        { name: 'a' },
        { name: 'rest', rest: true },
      ]);
    }
  });

  test('Epsil: the equation form accepts a rest parameter', () => {
    expect(epsilValue('h(a, ...rest) = Length(rest)\nh(1, 2, 3)')).toBe('2');
    expect(epsilValue('h(a, ...rest) = Length(rest)\nh(1)')).toBe('0');
    expect(epsilValue('h(...all) = Length(all)\nh(1, 2, 3)')).toBe('3');
  });

  test('Epsil: the `function` form accepts a rest parameter', () => {
    expect(
      epsilValue('function h(a, ...rest) { Length(rest) }\nh(1, 2, 3, 4)')
    ).toBe('3');
  });

  test('Epsil: a named definition behaves like the equivalent lambda', () => {
    const named = epsilValue('h(a, ...rest) = Length(rest)\nh(1, 2, 3)');
    const lambda = epsilValue(
      'let h = (a, ...rest) => Length(rest)\nh(1, 2, 3)'
    );
    expect(named).toBe(lambda);
  });

  test('Epsil: a definition with a rest parameter and literal clauses dispatches', () => {
    expect(
      epsilValue(
        'h(0, ...rest) = 0\nh(n, ...rest) = Length(rest)\n(h(0, 9, 9), h(5, 9, 9), h(5))'
      )
    ).toBe('(0, 2, 0)');
  });

  test.each([
    'h(a, ...rest) = Length(rest)',
    'h(...all) = Length(all)',
    'function h(a, ...rest) {Length(rest)}',
  ])('Epsil round-trips the named form %p', (source) => {
    const [ast, diagnostics] = parseEpsil(source);
    expect(diagnostics).toEqual([]);
    const text = serializeEpsil(ast as MathJsonExpression);
    expect(text).toBe(source);
    expect(stripOffsets(parseEpsil(text)[0])).toEqual(stripOffsets(ast));
  });

  test('Epsil rejects a misplaced or malformed spread in a definition head', () => {
    // The same diagnostic the mapsto parameter list reports, and the same
    // recovery: the spread is dropped, the other parameters survive.
    const [ast, diagnostics] = parseEpsil('h(a, ...rest, b) = a');
    expect(diagnostics.map((d) => d.message)).toEqual([['symbol-expected']]);
    expect(stripOffsets(ast)).toEqual({
      fn: [
        'DefineFunction',
        { sym: 'h' },
        { fn: ['Function', { sym: 'a' }, { sym: 'a' }, { sym: 'b' }] },
      ],
    });
    expect(parseEpsil('h(...1) = 2')[1].map((d) => d.message)).toEqual([
      ['symbol-expected'],
    ]);
    expect(
      parseEpsil('h(a, ...rest: integer) = a')[1].map((d) => d.message)
    ).toEqual([['symbol-expected']]);
  });
});

describe('Rest parameter — signature markers on named definitions', () => {
  /** The marker signature text an Epsil definition lowered, or `undefined`. */
  function markerOf(source: string): string | undefined {
    const [ast, diagnostics] = parseEpsil(source);
    expect(diagnostics).toEqual([]);
    const found = JSON.stringify(ast).match(/"str":"(\([^"]*)"/);
    return found?.[1];
  }

  // A definition that carries an effect specifier or a type-parameter clause
  // lowers a FULL SIGNATURE marker mirroring its parameter list. The rest
  // parameter has no positional slot there either: it is the variadic tail.

  test('a generic definition states the tail, not an extra fixed slot', () => {
    expect(markerOf('function h<T>(x: T, ...rest) -> T { x }')).toBe(
      '(x: T, any*) -> T where T'
    );
  });

  test('an effect-annotated definition states the tail', () => {
    expect(markerOf('function h(x, ...rest) scope -> integer { x }')).toBe(
      '(x: unknown, any*) scope -> integer'
    );
    expect(markerOf('h(x, ...rest) scope -> integer = x')).toBe(
      '(x: unknown, any*) scope -> integer'
    );
  });

  test('a generic definition with a rest parameter accepts any tail length', () => {
    expect(epsilValue('function h<T>(x: T, ...rest) -> T { x }\nh(1)')).toBe(
      '1'
    );
    expect(
      epsilValue('function h<T>(x: T, ...rest) -> T { x }\nh(1, 2, 3)')
    ).toBe('1');
  });

  test('an effect-annotated definition accepts any tail length, both forms', () => {
    expect(
      epsilValue(
        'function h(a, ...rest) pure -> integer { Length(rest) }\n(h(1), h(1, 2, 3))'
      )
    ).toBe('(0, 2)');
    expect(
      epsilValue(
        'h(a, ...rest) scope -> integer = Length(rest)\n(h(1), h(1, 2))'
      )
    ).toBe('(0, 1)');
  });
});

describe('Rest parameter — declared signatures', () => {
  const restLiteral = (ce: ComputeEngine) =>
    ce.box(['Function', ['Length', 'rest'], 'a', ['Spread', 'rest']]);

  /** Assign the one-fixed-parameter rest literal under `declared`; return the
   * thrown arity message, or `undefined` when the assignment was accepted. */
  function assignUnder(declared: string): string | undefined {
    const ce = new ComputeEngine();
    ce.declare('f', declared);
    try {
      ce.assign('f', restLiteral(ce));
      return undefined;
    } catch (e) {
      return (e as Error).message;
    }
  }

  test('a variadic declaration fits when the MINIMUM call arities agree', () => {
    // `(a, ...rest) => …` accepts one argument or more. So does `(unknown+)`:
    // no required argument, but a non-empty tail. Comparing `variadicMin` to
    // zero instead of comparing minimum arities refused this.
    expect(assignUnder('(unknown+) -> integer')).toBeUndefined();
    expect(assignUnder('(number+) -> integer')).toBeUndefined();
    expect(assignUnder('(integer, any*) -> integer')).toBeUndefined();
  });

  test('a variadic declaration with a different minimum does not fit', () => {
    // `(integer, any+)` and `(integer, integer, any*)` both need two arguments;
    // the literal promises only one.
    expect(assignUnder('(integer, any+) -> integer')).toMatch(
      /takes 1 or more parameter\(s\).*accepts 2 or more/s
    );
    expect(assignUnder('(integer, integer, any*) -> integer')).toMatch(
      /takes 1 or more parameter\(s\).*accepts 2 or more/s
    );
    // `(any*)` admits a zero-argument call, which the literal cannot serve.
    expect(assignUnder('(any*) -> integer')).toMatch(/accepts 0 or more/);
  });

  test('a fixed-arity declaration never fits a literal with a rest parameter', () => {
    expect(assignUnder('(integer, integer) -> integer')).toMatch(
      /accepts exactly 2/
    );
  });

  test('`(any+)` is refused by the ordinary any/unknown rule, not by arity', () => {
    // The arity check now passes; what remains is the pre-existing rule that
    // `any` is not assignable to an `unknown` parameter slot — a fixed literal
    // under `(any) -> integer` is refused in exactly the same way.
    const message = assignUnder('(any+) -> integer');
    expect(message).toBeDefined();
    expect(message).not.toMatch(/parameter\(s\)/);
    expect(message).toMatch(/not compatible with the type/);
  });

  test('a rest-only literal matches a declaration that admits an empty call', () => {
    const restOnly = ['Function', ['Length', 'rest'], ['Spread', 'rest']];
    let ce = new ComputeEngine();
    ce.declare('f', '(unknown*) -> integer');
    expect(() => ce.assign('f', ce.box(restOnly))).not.toThrow();
    ce = new ComputeEngine();
    ce.declare('f', '(unknown+) -> integer');
    expect(() => ce.assign('f', ce.box(restOnly))).toThrow(
      /takes 0 or more parameter\(s\)/
    );
  });

  test('the declared argument types are ascribed onto the FIXED parameters', () => {
    // A non-scalar declared type is stamped onto the parameter it governs, as
    // it is for a fixed-arity literal; the rest parameter is left alone.
    const ce = new ComputeEngine();
    ce.declare('g', '(list<integer>, any*) -> integer');
    ce.assign(
      'g',
      ce.box(['Function', ['Length', 'a'], 'a', ['Spread', 'rest']])
    );
    const stored = (
      ce.lookupDefinition('g') as { value?: { value?: { json: unknown } } }
    ).value?.value;
    expect(stored?.json).toEqual([
      'Function',
      ['Block', ['Length', 'a']],
      ['Typed', 'a', "'list<integer>'"],
      ['Spread', 'rest'],
    ]);
  });

  test('the Epsil clause route accepts a variadic declaration', () => {
    // `declare` then `define` is the prescribed form for a recursive
    // definition, and it stamps SCALAR declared types too, so the body reads
    // `a` as an integer here.
    expect(
      epsilValue(
        'let f: (integer, any*) -> integer\nf(a, ...rest) = a + Length(rest)\n(f(1), f(1, 2, 3))'
      )
    ).toBe('(1, 3)');
    expect(
      epsilValue(
        'let f: (any*) -> integer\nf(...rest) = Length(rest)\n(f(), f(1, 2))'
      )
    ).toBe('(0, 2)');
  });

  test('the clause route still refuses a fixed declaration', () => {
    const [ast] = parseEpsil(
      'let f: (integer, integer) -> integer\nf(a, ...rest) = a\nf(1, 2)'
    );
    expect(
      new ComputeEngine()
        .box(ast as MathJsonExpression)
        .evaluate()
        .toString()
    ).toContain('invalid-clause-definition');
  });
});
