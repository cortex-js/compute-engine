import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/free-functions';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

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
