import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { operandsFrom } from '../../src/compute-engine/boxed-expression/binding-sites';

// The engine keeps a cache version, the `any` axis (`axisMaskOf`,
// `engine-configuration-lifecycle.ts`). The cached types and signs of every
// expression are keyed on it.
//
// CE-535 asked whether the declaration of a binder's variable (`D`, `Sum`,
// `Integrate`, …) in the scope that `box.ts` creates for it can skip the
// advance of that version. It cannot. The value of a symbol is read BY NAME
// through the current scope chain (`BoxedSymbol._value`, `boxed-symbol.ts`),
// so while the binder's handler runs, any expression that existed before the
// scope (an operand boxed earlier, the stored value of an operand symbol, the
// body of a user function it calls) reads the binder's variable instead of
// the outer binding, and caches what it reads. The tests in the "binder"
// blocks below lock that in: without the advance, a sign cached outside was
// served inside, and a sign cached inside was served outside afterwards.
//
// CE-531 asked the same question for the parameters of a call of a function
// literal, declared in a new call scope. Same answer: the body of the literal
// is shared by all the calls, and a node of the body reads the value of a
// parameter through the call scope. The cached sign of `x + 1` from the call
// with `x = 3` would be served in the next call with `x = -5`.

const ce = new ComputeEngine();

ce.declare('h', { value: ce.parse('(t) \\mapsto t^2 + 1') });

describe('CE-535: the canonicalization of a binder', () => {
  test('the bound variable is declared in the scope of the binder', () => {
    const d = ce.box(['D', ['h', 'x'], 'x']) as Expression & {
      localScope?: { bindings: Map<string, unknown> };
    };
    expect(d.localScope?.bindings.has('x')).toBe(true);
  });

  test('the results of D, Integrate and Sum do not change', () => {
    expect(
      ce
        .box(['D', ['Power', 'x', 3], 'x'])
        .evaluate()
        .toString()
    ).toBe('3x^2');
    expect(ce.parse('\\frac{d}{dx} \\sin(x)').evaluate().toString()).toBe(
      'cos(x)'
    );
    expect(
      ce
        .box(['Integrate', ['Power', 'x', 2], 'x'])
        .evaluate()
        .toString()
    ).toBe('1/3 * x^3');
    expect(
      ce
        .box(['Integrate', ['Power', 'x', 2], ['Limits', 'x', 0, 3]])
        .evaluate()
        .toString()
    ).toBe('9');
    expect(ce.parse('\\sum_{k=1}^{4} k^2').evaluate().toString()).toBe('30');
    // The type of a call of the user function, read before and after a
    // binder that reads it, is the same.
    const call = ce.box(['h', 'y']);
    const before = call.type.toString();
    ce.box(['D', ['h', 'y'], 'y']);
    expect(call.type.toString()).toBe(before);
  });
});

describe('CE-531: the parameters of a call of a function literal keep the advance', () => {
  ce.declare('g', { value: ce.parse('(x) \\mapsto x') });

  // The same literal, called with an integer, a list, a string and an
  // integer again: the result and its type follow the argument on each
  // route.
  const calls: [string, () => Expression, string, string][] = [
    ['ce.parse g(3)', () => ce.parse('g(3)'), '3', 'finite_integer'],
    ['ce.parse g([1,2])', () => ce.parse('g([1,2])'), '[1,2]', 'list'],
    ['ce.parse g("ab")', () => ce.parse('g(\\text{ab})'), '"ab"', 'string'],
    ['ce.box g(3)', () => ce.box(['g', 3]), '3', 'finite_integer'],
    ['ce.box g([1,2])', () => ce.box(['g', ['List', 1, 2]]), '[1,2]', 'list'],
    ['ce.box g("ab")', () => ce.box(['g', { str: 'ab' }]), '"ab"', 'string'],
    [
      'ce.function g(3)',
      () => ce.function('g', [ce.box(3)]),
      '3',
      'finite_integer',
    ],
    [
      'ce.function g([1,2])',
      () => ce.function('g', [ce.box(['List', 1, 2])]),
      '[1,2]',
      'list',
    ],
    [
      'ce.function g("ab")',
      () => ce.function('g', [ce.string('ab')]),
      '"ab"',
      'string',
    ],
    ['ce.parse g(3) again', () => ce.parse('g(3)'), '3', 'finite_integer'],
  ];
  test.each(calls)('%s', (_label, make, value, type) => {
    const result = make().evaluate();
    expect(result.toString()).toBe(value);
    expect(result.type.matches(type)).toBe(true);
  });

  test('a cached sign of a node of the body is not served in the next call', () => {
    // An operator that reports the sign of its held operand. Its canonical
    // handler binds the operand, so the node `x + 1` belongs to the body of
    // the literal and is shared by the calls.
    ce.declare('SignOf531', {
      signature: '(any) -> string',
      lazy: true,
      canonical: (ops) =>
        ce._fn(
          'SignOf531',
          ops.map((op) => op.canonical)
        ),
      evaluate: (ops) => ce.string(String(ops[0].sgn)),
    });
    ce.declare('s531', {
      value: ce.box([
        'Function',
        ['Block', ['SignOf531', ['Add', 'x', 1]]],
        'x',
      ]),
    });
    expect(ce.box(['s531', 3]).evaluate().toString()).toBe('"positive"');
    expect(ce.box(['s531', -5]).evaluate().toString()).not.toBe('"positive"');
    expect(ce.box(['s531', 3]).evaluate().toString()).toBe('"positive"');
  });
});

// CE-543. The call of a function literal declares its parameters, with their
// values, in a new call scope BEFORE it pushes that scope. The pop compared
// the cache versions at the push with the versions at the pop, saw no change,
// and was `clean`: it did not advance the `any` axis. A node of the body
// that cached an answer derived from a parameter value (the sign of `x + 1`
// with `x = 3`) kept it after the call returned, where `x` has no value.
// The pop of a call frame that holds parameter values now always advances
// the axis (`_bindsValues`, `types-kernel-evaluation.ts`).
describe('CE-543: a cache filled during a call does not outlive the call', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('SignOf543', {
    signature: '(any) -> string',
    lazy: true,
    canonical: (ops) =>
      ce2._fn(
        'SignOf543',
        ops.map((op) => op.canonical)
      ),
    evaluate: (ops) => ce2.string(String(ops[0].sgn)),
  });
  const literal = ce2.box([
    'Function',
    ['Block', ['SignOf543', ['Add', 'x', 1]]],
    'x',
  ]);
  ce2.declare('f', { value: literal });
  // The node `x + 1` of the body: Function → Block → SignOf543 → Add.
  const stored = ce2.box('f').value ?? literal;
  const node = stored.op1.op1.op1;

  test.each([
    ['ce.parse', () => ce2.parse('f(3)')],
    ['ce.box', () => ce2.box(['f', 3])],
    ['ce.function', () => ce2.function('f', [ce2.box(3)])],
  ])(
    'the sign of a node of the body after a call on the %s route',
    (_route, make) => {
      expect(node.toString()).toBe('x + 1');
      expect(node.sgn).toBeUndefined();
      expect(make().evaluate().toString()).toBe('"positive"');
      // Outside the call, `x` has no value: the sign is unknown again.
      expect(node.sgn).toBeUndefined();
      expect(node.isPositive).toBeUndefined();
    }
  );

  // Bodies whose value depends on the parameter through a cached
  // intermediate value (a lazy collection, a comprehension, a sum): each
  // call gives the value for its own argument, on each route.
  const L = (...a: unknown[]) => ['List', ...a];
  const bodies: [string, unknown, (x: number) => string][] = [
    [
      'comp',
      [
        'At',
        [
          'Comprehension',
          ['Multiply', 'i', 'x'],
          ['Element', 'i', ['Range', 1, 3]],
        ],
        2,
      ],
      (x) => String(2 * x),
    ],
    [
      'mapAt',
      ['At', ['Map', ['Function', ['Add', 't', 'x'], 't'], L(1, 2, 3)], 3],
      (x) => String(3 + x),
    ],
    [
      'filterLen',
      [
        'Length',
        ['Filter', L(1, 2, 3, 4, 5), ['Function', ['Greater', 't', 'x'], 't']],
      ],
      (x) => String(5 - x),
    ],
    [
      'sumx',
      ['Sum', ['Multiply', 'i', 'x'], ['Limits', 'i', 1, 'x']],
      (x) => String((x * x * (x + 1)) / 2),
    ],
  ];
  for (const [name, body] of bodies)
    ce2.declare(name, {
      value: ce2.box(['Function', ['Block', body], 'x'] as never),
    });
  test.each(bodies)('%s across calls', (name, _body, expected) => {
    for (const x of [2, 4, 2, 3]) {
      expect(ce2.box([name, x]).evaluate().toString()).toBe(expected(x));
      expect(
        ce2
          .function(name, [ce2.box(x)])
          .evaluate()
          .toString()
      ).toBe(expected(x));
      expect(
        ce2.parse(`\\operatorname{${name}}(${x})`).evaluate().toString()
      ).toBe(expected(x));
    }
  });
});

// A binder whose operand is a canonical expression boxed BEFORE the binder's
// scope existed. With `x := 3`, the sign of `x + 1` is cached as positive.
// Inside the binder, `x` is the binder's variable and has no value, so the
// handler must not read that cached sign, and a sign read inside must not be
// served outside afterwards either.
describe('CE-535: an operand boxed before the scope of a binder', () => {
  const routes = ['ce.function', 'ce.box', 'ce.parse'] as const;
  const cases = routes.flatMap((route) =>
    [false, true].map((warm) => [route, warm] as const)
  );
  test.each(cases)('%s route, sign read before: %s', (route, warm) => {
    const ce3 = new ComputeEngine();
    const seen: (string | undefined)[] = [];
    ce3.declare('MyBinder535', {
      signature: '(any, symbol) -> any',
      scoped: operandsFrom(1),
      canonical: (ops, { engine }) => {
        const body = ops[0].canonical;
        seen.push(String(body.sgn));
        return engine._fn('MyBinder535', [body, ops[1]]);
      },
    });
    ce3.assign('x', 3);
    const outer = ce3.box(['Add', 'x', 1]);
    if (warm) expect(outer.sgn).toBe('positive');
    if (route === 'ce.function')
      ce3.function('MyBinder535', [outer, ce3.symbol('x')]);
    else if (route === 'ce.box') ce3.box(['MyBinder535', ['Add', 'x', 1], 'x']);
    else ce3.parse('\\operatorname{MyBinder535}(x+1, x)');
    // Inside the binder, `x` has no value.
    expect(seen).toEqual(['undefined']);
    // Outside, `x` is 3 again.
    expect(outer.sgn).toBe('positive');
    expect(ce3.box(['Add', 'x', 1]).sgn).toBe('positive');
  });
});

// The partial application of a function literal (`f(3)` for a literal with
// two parameters) evaluates the body in a call frame that holds the value of
// the applied parameter. Its pop must advance the cache version too
// (`_bindsValues`), so a sign cached in the body during the call is not kept.
describe('CE-543: a partial application', () => {
  const ce4 = new ComputeEngine();
  ce4.declare('SignOf543b', {
    signature: '(any) -> string',
    lazy: true,
    canonical: (ops) =>
      ce4._fn(
        'SignOf543b',
        ops.map((op) => op.canonical)
      ),
    evaluate: (ops) => ce4.string(String(ops[0].sgn)),
  });
  const literal = ce4.box([
    'Function',
    ['Block', ['Tuple', ['SignOf543b', ['Add', 'x', 1]], 'y']],
    'x',
    'y',
  ]);
  ce4.declare('p', { value: literal });
  // The node `x + 1` of the body: Function → Block → Tuple → SignOf543b → Add.
  const stored = ce4.box('p').value ?? literal;
  const node = stored.op1.op1.op1.op1;

  test.each([
    ['ce.parse', () => ce4.parse('p(3)')],
    ['ce.box', () => ce4.box(['p', 3])],
    ['ce.function', () => ce4.function('p', [ce4.box(3)])],
  ])('the sign of a node of the body after %s', (_route, make) => {
    expect(node.toString()).toBe('x + 1');
    expect(node.sgn).toBeUndefined();
    // Read the sign at each scope pop made outside every call frame: the
    // first one is the pop of the frame of the partial application. Later
    // declarations (the residual literal is boxed after the pop) advance the
    // version anyway, so a read after the call alone would not see a pop
    // that left the cache in place.
    const engine4 = ce4 as unknown as {
      _noteStateEvent: (e: { kind: string }) => void;
      _evalContextStack: { name?: string }[];
    };
    const original = engine4._noteStateEvent;
    const signs: string[] = [];
    engine4._noteStateEvent = function (e) {
      original.call(this, e);
      if (
        e.kind === 'scope-pop' &&
        !engine4._evalContextStack.some((c) => c.name === 'call')
      )
        signs.push(String(node.sgn));
    };
    let result: Expression;
    try {
      result = make().evaluate();
    } finally {
      engine4._noteStateEvent = original;
    }
    // A function of the remaining parameter `y`.
    expect(result.operator).toBe('Function');
    expect(result.toString()).toContain('"positive"');
    expect(signs.length).toBeGreaterThan(0);
    expect(signs.every((s) => s === 'undefined')).toBe(true);
    expect(node.sgn).toBeUndefined();
  });
});

// A binder whose operand is a symbol whose stored value is an expression:
// `a := x + 1` with `x := 3`. The sign of `a` is the sign of its stored value,
// a node that existed before the binder. Inside the binder, `x` is the
// binder's variable and has no value; outside, `x` is 3 again.
describe('CE-535: an operand symbol whose value is an expression', () => {
  test.each([true, false])('sign of `a` read before the binder: %s', (warm) => {
    const ce5 = new ComputeEngine();
    const seen: string[] = [];
    ce5.declare('MyBinder535b', {
      signature: '(any, symbol) -> any',
      scoped: operandsFrom(1),
      canonical: (ops, { engine }) => {
        const body = ops[0].canonical;
        seen.push(String(body.sgn));
        return engine._fn('MyBinder535b', [body, ops[1]]);
      },
    });
    ce5.assign('x', 3);
    ce5.assign('a', ce5.box(['Add', 'x', 1], { form: 'raw' }));
    if (warm) expect(ce5.symbol('a').sgn).toBe('positive');
    ce5.box(['MyBinder535b', 'a', 'x']);
    // Inside the binder, `x` has no value.
    expect(seen).toEqual(['undefined']);
    // After the binder, `x` is 3 again.
    expect(ce5.symbol('a').sgn).toBe('positive');
  });
});
