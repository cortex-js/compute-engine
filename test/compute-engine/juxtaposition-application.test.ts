import { ComputeEngine } from '../../src/compute-engine';
import { OPENING_PARENTHESIS } from '../../src/compute-engine/latex-syntax/delimiter-tables';

/**
 * A symbol with NO type information — undeclared, or auto-declared by the
 * engine from a bare use with its type still unknown — followed by a
 * parenthesized argument is an APPLICATION: `f(x)` is `f` applied to `x`. It
 * used to be the product `f·x` whenever the argument could be a number, which
 * is silent when wrong (`\operatorname{conj}(L)` over a list was `conj·L`,
 * and a piecewise over that condition could decide nothing).
 *
 * The product reading remains for a head that IS a value: declared with a
 * concrete type, declared `unknown` by the host (a value whose type is not
 * known yet), assigned a value, a parameter of the literal being read, or a
 * head its own argument refers to (`q(2q)`).
 */

describe('JUXTAPOSITION ON A HEAD WITH NO TYPE INFORMATION', () => {
  describe('is an application', () => {
    test('parse route, one argument', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('f(z)').json).toEqual(['f', 'z']);
      expect(ce.parse('k(3)').json).toEqual(['k', 3]);
      expect(ce.parse('a(b+c)').json).toEqual(['a', ['Add', 'b', 'c']]);
    });

    test('parse route, `\\operatorname` spelling', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('\\operatorname{foo}(z)').json).toEqual(['foo', 'z']);
      expect(ce.parse('\\operatorname{foo}(z)^2').json).toEqual([
        'Power',
        ['foo', 'z'],
        2,
      ]);
    });

    test('box route, `InvisibleOperator` with a `Delimiter`', () => {
      const ce = new ComputeEngine();
      expect(
        ce.box(['InvisibleOperator', 'h', ['Delimiter', ['Add', 'y', 1]]]).json
      ).toEqual(['h', ['Add', 'y', 1]]);
      expect(
        ce.box(['InvisibleOperator', 'h', ['Delimiter', ['Sequence', 'y', 1]]])
          .json
      ).toEqual(['h', 'y', 1]);
    });

    test('a coefficient or a power around the application', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('2f(x)').json).toEqual(['Multiply', 2, ['f', 'x']]);
      expect(ce.parse('2f(3)^2').json).toEqual([
        'Multiply',
        2,
        ['Power', ['f', 3], 2],
      ]);
      expect(ce.parse('2xy(z+1)').json).toEqual([
        'Multiply',
        2,
        'x',
        ['y', ['Add', 'z', 1]],
      ]);
    });

    test('a head auto-declared from a bare use, still of unknown type', () => {
      // `y = u` auto-declares `u` with an inferred unknown type: the engine's
      // own placeholder, which carries no information.
      const ce = new ComputeEngine();
      ce.parse('y = u');
      expect(ce.parse('u(2)').json).toEqual(['u', 2]);
    });

    test('every route infers the head as a function', () => {
      // On the multi-operand route the head symbol is canonicalized, which
      // auto-declares it with an unknown type, before it is applied; the
      // application must still infer `function`, as the two-operand route
      // does.
      for (const source of ['f(3)', '2f(3)', '2f(3)^2']) {
        const ce = new ComputeEngine();
        ce.parse(source);
        expect([source, ce.symbol('f').type.toString()]).toEqual([
          source,
          'function',
        ]);
      }
      const ce = new ComputeEngine();
      ce.box(['InvisibleOperator', 2, 'f', ['Delimiter', 3]]);
      expect(ce.symbol('f').type.toString()).toBe('function');
    });

    test('the application evaluates to itself, and is visible', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('f(2)').evaluate().toString()).toBe('f(2)');
    });

    test('an integrand of two applications stays inside the integral', () => {
      // `g(x)` used to be the product `g·x`, and `g` was pulled out of the
      // integral as a constant.
      const ce = new ComputeEngine();
      expect(ce.parse('\\int f(x) g(x) dx').evaluate().toString()).toBe(
        'int(g(x) * f(x) dx)'
      );
    });
  });

  describe('stays a product', () => {
    test('when the argument refers to the head', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('q(2q)').json).toEqual(['Multiply', 2, 'q', 'q']);
      expect(ce.parse('x(x+1)').json).toEqual([
        'Multiply',
        'x',
        ['Add', 'x', 1],
      ]);
    });

    test('when the host declared the head `unknown`', () => {
      // A document manager pre-declares its value heads `unknown` before
      // their values are assigned (`k` before `k = 0.6`): the declaration
      // says the name is a value, so `k(1-w)` stays the product it will be.
      const ce = new ComputeEngine();
      ce.declare('k', 'unknown');
      expect(ce.parse('k(1-w)').json).toEqual([
        'Multiply',
        'k',
        ['Add', ['Negate', 'w'], 1],
      ]);
      ce.assign('k', 0.6);
      expect(ce.parse('k(1-w)').subs({ w: 0.5 }).evaluate().re).toBeCloseTo(
        0.3,
        12
      );
    });

    test('when the head is declared with a concrete type', () => {
      const ce = new ComputeEngine();
      ce.declare('a', 'real');
      ce.declare('v', 'value');
      expect(ce.parse('a(b+c)').json).toEqual([
        'Multiply',
        'a',
        ['Add', 'b', 'c'],
      ]);
      expect(ce.parse('v(b+1)').json).toEqual([
        'Multiply',
        'v',
        ['Add', 'b', 1],
      ]);
    });

    test('when the head has a value', () => {
      const ce = new ComputeEngine();
      ce.assign('k', 3);
      expect(ce.parse('k(2)').json).toEqual(['Multiply', 2, 'k']);
    });

    test('when the head holds a symbolic value of unknown type', () => {
      // `a := b` gives `a` a value whose type is still unknown: `a` stands
      // for `b`, so `a(2)` is the product `2a`, not a call that fails on `b`.
      const ce = new ComputeEngine();
      ce.assign('a', ce.symbol('b'));
      expect(ce.parse('a(2)').json).toEqual(['Multiply', 2, 'a']);
    });

    test('when the head is a constant', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('\\pi(x+1)').json).toEqual([
        'Multiply',
        'Pi',
        ['Add', 'x', 1],
      ]);
    });

    test('when the head is a parameter of the function literal', () => {
      // An untyped parameter is a value: `x(N+1)` is a product, and the
      // literal applies to two numbers.
      const ce = new ComputeEngine();
      const literal = ce.parse('(x, N) \\mapsto x(N+1)');
      expect(literal.json).toEqual([
        'Function',
        ['Block', ['Multiply', 'x', ['Add', 'N', 1]]],
        'x',
        'N',
      ]);
      expect(ce.box(['Apply', literal.json, 2, 3]).evaluate().toString()).toBe(
        '8'
      );
    });
  });

  describe('the `resolveSymbol` handler decides like a declaration', () => {
    // A host that knows a name is a value before the scope does — a name a
    // later pass will declare — answers through `resolveSymbol`. The parser
    // consults it first; the canonicalization of the parse result must read
    // the same answer for the product-or-application question.
    const oracle = (answer: { type: string } | undefined) => {
      const ce = new ComputeEngine();
      ce.latexOptions = {
        ...ce.latexOptions,
        resolveSymbol: (id) =>
          id === 's' || id === 'alpha' ? answer : undefined,
      };
      return ce;
    };

    test('a value type from the handler keeps the product', () => {
      for (const type of ['number', 'real', 'value', 'unknown']) {
        const ce = oracle({ type });
        expect([type, ce.parse('s(x+1)').json]).toEqual([
          type,
          ['Multiply', 's', ['Add', 'x', 1]],
        ]);
        expect(ce.parse('s+1').isValid).toBe(true);
      }
    });

    test('a value type from the handler multiplies a collection argument', () => {
      // The non-numeric-argument route reads the head's scalability: the
      // handler's answer stands for the declaration it would be.
      const ce = oracle({ type: 'real' });
      ce.declare('S', 'list');
      expect(ce.parse('s(S)').json).toEqual(['Multiply', 'S', 's']);
      const lists = oracle({ type: 'list<number>' });
      expect(lists.parse('s(2)').json).toEqual(['Multiply', 2, 's']);
    });

    test('a function type from the handler is applied', () => {
      const ce = oracle({ type: 'function' });
      expect(ce.parse('s(x+1)').json).toEqual(['s', ['Add', 'x', 1]]);
    });

    test('a dictionary-trigger head reaches the handler too', () => {
      // `\\alpha` is a dictionary trigger for the symbol `alpha`.
      expect(oracle({ type: 'number' }).parse('\\alpha(x)').json).toEqual([
        'Multiply',
        'alpha',
        'x',
      ]);
      expect(oracle(undefined).parse('\\alpha(x)').json).toEqual([
        'alpha',
        'x',
      ]);
    });

    test('a per-call handler applies to that parse only', () => {
      const ce = new ComputeEngine();
      const resolveSymbol = (id: string) =>
        id === 's' ? { type: 'real' } : undefined;
      expect(ce.parse('s(x+1)', { resolveSymbol }).json).toEqual([
        'Multiply',
        's',
        ['Add', 'x', 1],
      ]);
      expect(ce.parse('t(x+1)').json).toEqual(['t', ['Add', 'x', 1]]);
    });

    test('a result canonicalized after the parse reads the engine-wide handler', () => {
      // A raw or structural result canonicalized later must read as a
      // canonical parse does: the engine-wide handler applies outside a
      // parse too. A per-call handler is known for its call only.
      const ce = oracle({ type: 'number' });
      const structural = ce.parse('s(x+1)', { form: 'structural' });
      expect(structural.json).toEqual([
        'InvisibleOperator',
        's',
        ['Delimiter', ['Add', 'x', 1]],
      ]);
      const product = ['Multiply', 's', ['Add', 'x', 1]];
      expect(structural.canonical.json).toEqual(product);
      expect(ce.parse('s(x+1)', { form: 'raw' }).canonical.json).toEqual(
        product
      );
      const perCall = new ComputeEngine();
      const resolveSymbol = (id: string) =>
        id === 't' ? { type: 'real' } : undefined;
      expect(
        perCall.parse('t(x+1)', { form: 'raw', resolveSymbol }).canonical.json
      ).toEqual(['t', ['Add', 'x', 1]]);
    });

    test('an inferred function declaration yields to the handler', () => {
      // A raw parse canonicalized while the handler was not consulted left
      // `b` an inferred, bodiless function; a later canonical parse must
      // still read the product the handler asks for, and a coefficient
      // handler that answers `value` counts as a value.
      const ce = new ComputeEngine();
      ce.parse('b(y+1)'); // `b` is now an inferred function
      expect(ce.lookupDefinition('b')).toBeDefined();
      ce.latexOptions = {
        ...ce.latexOptions,
        resolveSymbol: (id) => (id === 'b' ? { type: 'value' } : undefined),
      };
      const term = ce.parse('b(\\cos(NX)-1)');
      expect(term.operator).toBe('Multiply');
      expect(term.ops!.map((op) => op.json)).toContainEqual('b');
      expect(
        ce.parse('b(\\cos(NX)-1)', { form: 'raw' }).canonical.operator
      ).toBe('Multiply');
      // An `unknown` answer is a value answer too, and a parenthesized head
      // in a longer product takes the same override.
      const forgotten = new ComputeEngine();
      forgotten.parse('b(y+1)');
      forgotten.latexOptions = {
        ...forgotten.latexOptions,
        resolveSymbol: (id) => (id === 'b' ? { type: 'unknown' } : undefined),
      };
      expect(forgotten.parse('b(2)').json).toEqual(['Multiply', 2, 'b']);
      expect(forgotten.parse('2(b)(3)').json).toEqual(['Multiply', 6, 'b']);
      // A host declaration stands against the handler.
      const declared = new ComputeEngine();
      declared.declare('g', 'function');
      declared.latexOptions = {
        ...declared.latexOptions,
        resolveSymbol: (id) => (id === 'g' ? { type: 'value' } : undefined),
      };
      expect(declared.parse('g(2)').json).toEqual(['g', 2]);
    });

    test('an invalid type string from the handler is reported as the parser reports it', () => {
      const ce = oracle({ type: 'not a type' });
      expect(() => ce.parse('s(x+1)')).toThrow(
        /resolveSymbol\("s"\) returned invalid type string/
      );
    });

    test('a parse made from inside a handler restores the outer handler', () => {
      const ce = new ComputeEngine();
      const inner = (id: string) => (id === 'u' ? { type: 'real' } : undefined);
      const outer = (id: string) => {
        if (id === 's') {
          // A nested parse with its own handler, then back to this one.
          ce.parse('u(x+1)', { resolveSymbol: inner });
          return { type: 'real' };
        }
        return undefined;
      };
      expect(ce.parse('s(x+1)', { resolveSymbol: outer }).json).toEqual([
        'Multiply',
        's',
        ['Add', 'x', 1],
      ]);
    });
  });

  describe('a speculative parse reads as a normal one', () => {
    test('for a host-declared unknown head and for an inferred one', () => {
      for (const src of ['k(2)', 'k(1-w)']) {
        const ce = new ComputeEngine();
        ce.declare('k', 'unknown');
        expect([src, ce.parse(src, { speculative: true }).json]).toEqual([
          src,
          ce.parse(src).json,
        ]);
      }
      const ce = new ComputeEngine();
      ce.parse('y = u');
      expect(ce.parse('u(2)', { speculative: true }).json).toEqual(
        ce.parse('u(2)').json
      );
    });
  });

  describe('definition order does not change the reading', () => {
    test('a call with closed arguments inside a literal binds the later definition', () => {
      // `a(2^i t)` has no symbol argument, so nothing else would re-derive
      // the literal when `a` is defined; the application must bind it.
      const ce = new ComputeEngine();
      ce.parse('A(t)\\coloneq\\sum_{i=0}^{2}h(i)a(2^it)').evaluate();
      ce.parse('a(t)\\coloneq t^2').evaluate();
      ce.parse('h(t)\\coloneq t+1').evaluate();
      expect(ce.parse('A(3)').evaluate().toString()).toBe('513');
    });

    test('a head that later gains a value is re-read as a product', () => {
      const ce = new ComputeEngine();
      ce.parse('g(t)\\coloneq 2x(t+1)').evaluate();
      expect(ce.parse('g(3)').evaluate().toString()).toBe('2x(4)');
      ce.assign('x', 5);
      expect(ce.parse('g(3)').evaluate().toString()).toBe('40');
    });

    test('a head applied to a non-numeric argument is tracked too', () => {
      // `f(S)` with `S` a list takes the non-numeric-argument route; the
      // application must still bind a later definition and be re-read as a
      // product when `f` becomes a value.
      {
        const ce = new ComputeEngine();
        ce.declare('S', 'list');
        ce.parse('g(t)\\coloneq f(S)').evaluate();
        ce.parse('f(x)\\coloneq 2x').evaluate();
        ce.assign('S', ce.box(['List', 1, 2]));
        expect(ce.parse('g(1)').evaluate().json).toEqual(['List', 2, 4]);
      }
      {
        const ce = new ComputeEngine();
        ce.declare('S', 'list');
        ce.parse('g(t)\\coloneq f(S)').evaluate();
        ce.assign('f', 5);
        ce.assign('S', ce.box(['List', 1, 2]));
        expect(ce.parse('g(1)').evaluate().json).toEqual(['List', 5, 10]);
      }
    });

    test('a host-declared unknown head applied to a collection is tracked too', () => {
      // `f(S)` with `f` declared `unknown` and `S` a list was always a call;
      // it is noted so that `f := 5` re-reads it as a product.
      const ce = new ComputeEngine();
      ce.declare('f', 'unknown');
      ce.declare('S', 'list');
      ce.parse('g(t)\\coloneq f(S)').evaluate();
      ce.assign('f', 5);
      ce.assign('S', ce.box(['List', 1, 2]));
      expect(ce.parse('g(1)').evaluate().json).toEqual(['List', 5, 10]);
    });

    test('a head that is later declared a number is re-read as a product', () => {
      const ce = new ComputeEngine();
      ce.parse('g(t)\\coloneq 2x(t+1)').evaluate();
      ce.declare('x', 'number');
      expect(ce.parse('g(3)').evaluate().toString()).toBe('8x');
    });
  });

  describe('serialization survives the reading', () => {
    test('a product of a symbol and a parenthesized group gets an explicit multiply', () => {
      // `s(x+1)` would re-parse as the application of `s`.
      const ce = new ComputeEngine();
      for (const json of [
        ['Multiply', 's', ['Add', 'x', 1]],
        ['Multiply', 2, 's', ['Add', 'x', 1]],
        ['Multiply', 'a', 'b', ['Add', 'x', 1]],
      ]) {
        const expr = ce.box(json as any);
        expect(expr.latex).toContain('\\times(');
        expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
      }
      expect(ce.box(['Multiply', 's', ['Add', 'x', 1]]).latex).toBe(
        's\\times(x+1)'
      );
    });

    test('a sized parenthesis counts as a parenthesized group', () => {
      // The serializer may open a group with `\\left(` or `\\Bigl(`; the
      // separator rule must see those as parentheses too.
      for (const open of [
        '(',
        '\\left(',
        '\\bigl(',
        '\\Bigl(',
        '\\biggl(',
        '\\Biggl(',
      ]) {
        expect([open, OPENING_PARENTHESIS.test(`${open}x+1)`)]).toEqual([
          open,
          true,
        ]);
      }
      expect(OPENING_PARENTHESIS.test('[1,2]')).toBe(false);
      expect(OPENING_PARENTHESIS.test('\\lbrack 1\\rbrack')).toBe(false);
    });

    test('a number, a constant, or a group before a group stays juxtaposed', () => {
      const ce = new ComputeEngine();
      expect(ce.box(['Multiply', 2, ['Add', 'x', 1]]).latex).toBe('2(x+1)');
      expect(ce.box(['Multiply', 'Pi', ['Add', 'x', 1]]).latex).toBe(
        '\\pi(x+1)'
      );
      expect(ce.box(['Multiply', ['Add', 'x', 1], ['Add', 'y', 1]]).latex).toBe(
        '(x+1)(y+1)'
      );
    });

    test('a non-canonical juxtaposition serializes as written', () => {
      // `InvisibleOperator` is the juxtaposition itself: `x(a+b)` parsed
      // without canonicalization round-trips to the same node.
      const ce = new ComputeEngine();
      const raw = ce.parse('x(a+b)', { canonical: false });
      expect(raw.latex).toBe('x(a+b)');
      expect(ce.parse(raw.latex, { canonical: false }).json).toEqual(raw.json);
    });
  });
});
