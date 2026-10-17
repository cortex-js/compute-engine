/**
 * A symbol declared `any` or `value` under a numeric element-wise operator
 * gives the application that type (user decision 2026-10-17, Tycho ledger
 * row 379).
 *
 * Such a symbol may hold a number, a point, a list or a matrix, and
 * `2·(1, 2, 3)` evaluates to `(2, 4, 6)`, `(1, 2)^2` to `(1, 4)`, `\sin (1, 2)`
 * to `(\sin 1, \sin 2)`. The product was typed `number`, which a point value
 * contradicts, while `Add` and `Negate` already answered `any` for the same
 * operand. `broadcastable<number>` does not admit a tuple, so the operand's
 * own type is the only type that covers the result. The rule reaches an
 * application typed `any` (a call of a function declared `-> any`, the power
 * `a^2`), and a top-typed cell of an abstract collection.
 *
 * Unchanged on purpose: a symbol declared `unknown` and an auto-declared
 * symbol are read as scalars (the arithmetic's inference refines them), a
 * call of an undeclared function keeps its `broadcastable<number>` reading,
 * a comparison over the symbol keeps `broadcastable<boolean>` (its value is
 * never a point), and compiled code reads the symbol as a scalar.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('a', 'any');
ce.declare('v', 'value');
ce.declare('u', 'unknown');
ce.declare('c', 'tuple<number, number, number>');
ce.declare('L', 'list<number>');
ce.declare('g', '(number) -> any');
ce.declare('p', 'number');

const typeOf = (latex: string) => ce.parse(latex).type.toString();

describe('a symbol declared `any` under Multiply, Divide and Power', () => {
  test('the product with a number is `any`, on both sides', () => {
    expect(typeOf('2a')).toBe('any');
    expect(typeOf('a \\cdot 2')).toBe('any');
    expect(ce.parse('2a').json).toEqual(['Multiply', 2, 'a']);
  });

  test('the quotient is `any` whichever side holds the symbol', () => {
    // `a/2` canonicalizes to a product; `2/a` stays a quotient.
    expect(typeOf('a/2')).toBe('any');
    expect(typeOf('2/a')).toBe('any');
    expect(ce.parse('2/a').json).toEqual(['Divide', 2, 'a']);
  });

  test('the power is `any` with the symbol as base or as exponent', () => {
    expect(typeOf('a^2')).toBe('any');
    expect(typeOf('2^a')).toBe('any');
  });

  test('the type is the one Tycho reads against a tuple (the row instrument)', () => {
    const t = typeOf('2a');
    expect(t).not.toBe('number');
    expect(ce.type(t).couldMatch('tuple<number, number, number>')).toBe(true);
    // A sum of the product and a point is valid.
    const sum = ce.parse('2a + c');
    expect(sum.isValid).toBe(true);
    expect(sum.type.toString()).toBe('any');
  });

  test('a point value of the symbol agrees with the type', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'any');
    expect(ce2.parse('2a').type.toString()).toBe('any');
    ce2.assign('a', ce2.parse('(1, 2, 3)'));
    expect(ce2.parse('2a').evaluate().toString()).toBe('(2, 4, 6)');
    expect(ce2.parse('a^2').evaluate().toString()).toBe('(1, 4, 9)');
    expect(ce2.parse('\\sin a').evaluate().toString()).toBe(
      '(sin(1), sin(2), sin(3))'
    );
    expect(ce2.parse('2a').type.toString()).toBe('any');
  });

  test('the symbol itself is not narrowed by the product', () => {
    ce.parse('2a');
    expect(ce.box('a').type.toString()).toBe('any');
    const def = ce.lookupDefinition('a')?.value;
    expect(def).toBeDefined();
    expect(def!.inferredType).toBe(false);
  });
});

describe('a symbol declared `any` under a unary numeric function', () => {
  test('the application is `any`: the symbol may be a point', () => {
    expect(typeOf('\\sin a')).toBe('any');
    expect(typeOf('\\sqrt{a}')).toBe('any');
    expect(typeOf('|a|')).toBe('any');
    expect(typeOf('a!')).toBe('any');
    expect(typeOf('\\lfloor a \\rfloor')).toBe('any');
    expect(typeOf('\\sin(a) + \\cos(a)')).toBe('any');
  });

  test('a comparison keeps `broadcastable<boolean>`: its value is never a point', () => {
    expect(typeOf('a = 1')).toBe('broadcastable<boolean>');
    expect(typeOf('a < 2')).toBe('broadcastable<boolean>');
  });

  test('a comparison with a list is element-wise once the symbol has a value', () => {
    // The symbol may be a collection, so the comparison with a definite
    // list is not decided whole: it is `broadcastable<boolean>`, and with
    // `a = 1` evaluates element-wise.
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'any');
    const eq = ce2.parse('a = [1, 2]');
    expect(eq.type.toString()).toBe('broadcastable<boolean>');
    expect(eq.evaluate().json).toEqual(['Equal', 'a', ['List', 1, 2]]);
    ce2.assign('a', 1);
    expect(ce2.parse('a = [1, 2]').evaluate().json).toEqual([
      'List',
      'True',
      'False',
    ]);
  });

  test('a user function over the symbol is `any`', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'any');
    ce2.parse('g(x) := 2x + 1').evaluate();
    expect(ce2.parse('g(a)').type.toString()).toBe('any');
    ce2.assign('a', ce2.box(['List', 1, 2]));
    expect(ce2.parse('g(a)').evaluate().json).toEqual(['List', 3, 5]);
  });

  test('a fold over the symbol stays unevaluated until it has a value', () => {
    // `Sum(a)` folded to `a` before, as if `a` were a scalar; it may be a
    // list, whose sum is a number.
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'any');
    expect(ce2.parse('\\sum(a)').evaluate().json).toEqual(['Sum', 'a']);
    ce2.assign('a', ce2.box(['List', 1, 2]));
    expect(ce2.parse('\\sum(a)').evaluate().json).toEqual(3);
  });
});

describe('beside a point or a collection', () => {
  test('the product and the quotient with a point are `any`: a list value gives a list of points', () => {
    expect(typeOf('a c')).toBe('any');
    expect(typeOf('2 a c')).toBe('any');
    expect(typeOf('c / a')).toBe('any');
    expect(typeOf('[1, 2] a')).toBe('any');
  });

  test('beside a list the cells are `any` in every operator', () => {
    expect(typeOf('a L')).toBe('list<any>');
    expect(typeOf('L / a')).toBe('list<any>');
    expect(typeOf('a / L')).toBe('list<any>');
    expect(typeOf('L^a')).toBe('list<any>');
    expect(typeOf('L + a')).toBe('list<any>');
    expect(typeOf('\\sin(a) L')).toBe('list<any>');
  });

  test('a literal point scaled by a number keeps the tuple type', () => {
    expect(typeOf('2(1, 2, 3)')).toBe('tuple<integer, integer, integer>');
    expect(typeOf('2c')).toBe('tuple<number, number, number>');
    expect(typeOf('\\sin(L)')).toBe('list<number>');
  });
});

describe('a symbol declared `value`', () => {
  test('the product, quotient, power and sine are `value`, as the sum and the negation are', () => {
    expect(typeOf('v + 1')).toBe('value');
    expect(typeOf('-v')).toBe('value');
    expect(typeOf('2v')).toBe('value');
    expect(typeOf('2/v')).toBe('value');
    expect(typeOf('v^2')).toBe('value');
    expect(typeOf('\\sin v')).toBe('value');
  });

  test('`any` is the wider of the two when both appear', () => {
    expect(typeOf('a v')).toBe('any');
    expect(typeOf('2 v a')).toBe('any');
  });
});

describe('an application typed `any`', () => {
  test('under a numeric operator it is `any`, as the symbol is', () => {
    expect(typeOf('2g(p)')).toBe('any');
    expect(typeOf('g(p) + 1')).toBe('any');
    expect(typeOf('2a^2')).toBe('any');
    expect(typeOf('g(p)^2')).toBe('any');
    expect(typeOf('\\sin(g(p))')).toBe('any');
  });

  test('a call of an undeclared function keeps the `broadcastable<number>` reading', () => {
    expect(typeOf('2h(p)')).toBe('broadcastable<number>');
    expect(typeOf('\\sin(h(p))')).toBe('broadcastable<number>');
  });

  test('a colour mix over an `any`-typed call is summed with a point without an error', () => {
    // The shape of Tycho's `art/ifnnzttcqg`: a mix `b(E(q), col, t)` whose
    // first argument is a call typed `any`.
    const ce2 = new ComputeEngine();
    ce2.declare('E', '(number) -> any');
    ce2.declare('col', 'tuple<number, number, number>');
    ce2.declare('q', 'number');
    ce2.declare('b', '(unknown, unknown, unknown) -> unknown');
    ce2.assign('b', ce2.parse('(x, y, t) \\mapsto x + t(y - x)'));
    const call = ce2.parse('b(E(q), col, 5)');
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('any');
    expect(ce2.parse('b(E(q), col, 5) + col').isValid).toBe(true);
  });
});

describe('unchanged readings', () => {
  test('a symbol declared `unknown` is read as a scalar', () => {
    expect(typeOf('2u')).toBe('number');
    expect(typeOf('u + 1')).toBe('number');
  });

  test('an auto-declared symbol is read as a scalar', () => {
    expect(typeOf('2w')).toBe('number');
    expect(ce.lookupDefinition('w')?.value?.inferredType).toBe(true);
  });

  test('`Add` and `Negate` answer `any` as before', () => {
    expect(typeOf('a + 1')).toBe('any');
    expect(typeOf('a + c')).toBe('any');
    expect(typeOf('-a')).toBe('any');
  });
});

describe('compiled code reads the symbol as a scalar', () => {
  test('no broadcast wrapper over a symbol declared `any` or library arithmetic over it', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'any');
    expect(compile(ce2.box(['Abs', 'a']), { to: 'javascript' }).code).toBe(
      '_SYS.absAny(_.a)'
    );
    expect(compile(ce2.parse('2a + 1'), { to: 'javascript' }).code).toBe(
      '2 * _.a + 1'
    );
    expect(compile(ce2.parse('\\sin(2a + 1)'), { to: 'javascript' }).code).toBe(
      'Math.sin(2 * _.a + 1)'
    );
  });

  test('the scalar reading reaches the arms of a selection', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'any');
    ce2.declare('d', 'number');
    ce2.declare('z', 'number');
    const code = compile(
      ce2.box(['Add', ['If', ['Less', 'd', 0], 'a', 5], 'z']),
      {
        to: 'javascript',
      }
    ).code;
    expect(code).not.toContain('_SYS.bcast');
  });
});
