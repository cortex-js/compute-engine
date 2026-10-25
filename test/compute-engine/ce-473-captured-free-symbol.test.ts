/**
 * ROADMAP CE-473 (user decision 2026-10-25, options (a) and (c)): a free
 * symbol of the body of a function literal (`y` in `x ↦ [-x, y]`) is read
 * from the binding of the scope that the literal is written in when the
 * literal is called.
 *
 * - (a) A use of the symbol in the body (the list `[-x, y]`, the operand of
 *   `Not`) narrows that outer binding, as a use outside the literal does.
 *   Before, it narrowed a copy in the scope of the body, so with
 *   `y := "abc"`, `Apply(g, 3)` had the static type `vector<2>` and the
 *   value `[-3, "abc"]`.
 * - (c) A call whose captured symbol holds a value outside the type that
 *   the body was typed with, or whose stored signature no longer holds the
 *   type of the literal, gives an `incompatible-type` error. The compiled
 *   route refuses the same calls.
 *
 * Each case checks that the value of the expression is of its static type,
 * or that the value is the error.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { capturedTypesWidened } from '../../src/compute-engine/boxed-expression/function-literal';

const LITERAL = ['Function', ['List', ['Negate', 'x'], 'y'], 'x'] as const;

/** The value of `expr`, after a check that it is of the static type of
 * `expr`, or that it is an `incompatible-type` error. */
function sound(expr: Expression): Expression {
  const value = expr.evaluate();
  if (value.operator === 'Error')
    expect(JSON.stringify(value.json)).toContain('incompatible-type');
  else expect(value.type.matches(expr.type)).toBe(true);
  return value;
}

function isTypeError(value: Expression): boolean {
  return (
    value.operator === 'Error' &&
    JSON.stringify(value.json).includes('incompatible-type')
  );
}

describe('CE-473 (a): THE USE NARROWS THE OUTER BINDING', () => {
  test('box route: the list literal narrows the outer `y`', () => {
    const ce = new ComputeEngine();
    const g = ce.box(LITERAL as any);
    expect(g.type.toString()).toBe('(x: unknown) -> vector<2>');
    expect(ce.box('y').type.toString()).toBe('number');
  });

  test('parse route: the list literal narrows the outer `y`', () => {
    const ce = new ComputeEngine();
    const g = ce.parse('x \\mapsto [-x, y]');
    expect(g.type.toString()).toBe('(x: unknown) -> vector<2>');
    expect(ce.box('y').type.toString()).toBe('number');
  });

  test('an operator use narrows the outer binding too', () => {
    const ce = new ComputeEngine();
    const g = ce.box(['Function', ['Not', 'W'], 'x']);
    expect(g.type.toString()).toBe('(x: unknown) -> boolean');
    expect(ce.box('W').type.toString()).toBe('boolean');
  });

  test('a parameter is not narrowed by the list', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Function', ['List', 'x'], 'x']).type.toString()).toBe(
      '(x: unknown) -> list<unknown>'
    );
  });

  test('an assignment of another type is handled as for a top-level use', () => {
    // A symbol that a top-level use inferred `number` accepts a string: the
    // inferred type is replaced. A captured symbol is handled the same way.
    const top = new ComputeEngine();
    top.box(['Add', 'z', 1]);
    expect(top.box('z').type.toString()).toBe('number');
    top.assign('z', top.string('abc'));
    expect(top.box('z').type.toString()).toBe('string');

    const ce = new ComputeEngine();
    const g = ce.box(LITERAL as any);
    ce.assign('y', ce.string('abc'));
    expect(ce.box('y').type.toString()).toBe('string');
    // The literal reads the outer binding, so its type follows the
    // assignment, and the value of a call is of the type of the call.
    expect(g.type.toString()).toBe('(x: unknown) -> list<number | string>');
    const call = ce.box(['Apply', g, 3]);
    expect(call.type.toString()).toBe('list<integer | string>');
    expect(sound(call).toString()).toBe('[-3,"abc"]');
  });

  test('a value assigned before the literal is read by its type', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.string('abc'));
    const g = ce.box(LITERAL as any);
    expect(g.type.toString()).toBe('(x: unknown) -> list<number | string>');
    expect(sound(ce.box(['Apply', g, 3])).toString()).toBe('[-3,"abc"]');
  });

  test('parse route: the call after the assignment is sound', () => {
    const ce = new ComputeEngine();
    const g = ce.parse('x \\mapsto [-x, y]');
    ce.assign('y', ce.string('abc'));
    expect(sound(ce.box(['Apply', g, 3])).toString()).toBe('[-3,"abc"]');
  });
});

describe('CE-473 (c): A CALL CHECKS THE CAPTURED VALUES', () => {
  test('a value written on the definition directly is refused', () => {
    const ce = new ComputeEngine();
    const g = ce.box(LITERAL as any);
    const def = ce.lookupDefinition('y') as {
      value: { value: Expression | undefined };
    };
    def.value.value = ce.string('abc');
    const call = ce.box(['Apply', g, 3]);
    expect(call.type.toString()).toBe('vector<2>');
    expect(isTypeError(sound(call))).toBe(true);
  });

  test('a nullary literal is checked too', () => {
    const ce = new ComputeEngine();
    const h = ce.box(['Function', ['List', 'u']]);
    expect(h.type.toString()).toBe('() -> vector<1>');
    const def = ce.lookupDefinition('u') as {
      value: { value: Expression | undefined };
    };
    def.value.value = ce.string('abc');
    expect(isTypeError(sound(ce.box(['Apply', h])))).toBe(true);
  });

  test('a captured value of the type of the body is read', () => {
    const ce = new ComputeEngine();
    const g = ce.box(LITERAL as any);
    ce.assign('y', 5);
    expect(sound(ce.box(['Apply', g, 3])).toString()).toBe('[-3,5]');
  });

  test('the index of an enclosing Sum is read as its value', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Sum',
      ['Apply', ['Function', ['Multiply', 'j', 'n'], 'n'], 2],
      ['Tuple', 'j', 1, 3],
    ]);
    expect(sound(e).toString()).toBe('12');
  });

  test('a named function whose stored signature no longer holds is refused', () => {
    // The signature of `g` was inferred when `g` was assigned, from the type
    // of the literal at that time. An assignment to `y` changes the type of
    // the literal, but not that signature, which types the call.
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(LITERAL as any));
    ce.assign('y', ce.string('abc'));
    const call = ce.box(['g', 3]);
    expect(call.type.toString()).toBe('vector<2>');
    expect(isTypeError(sound(call))).toBe(true);
  });

  test('a named function whose captured value keeps its type is read', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(LITERAL as any));
    ce.assign('y', 5);
    expect(sound(ce.box(['g', 3])).toString()).toBe('[-3,5]');
  });
});

describe('CE-473: THE EPSIL ROUTE', () => {
  test('a later assignment to the captured symbol makes the call an error', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(ce, 'let g = (x) => [-x, y]\ny = "abc"\ng(3)');
    expect(result.diagnostics).toEqual([]);
    expect(isTypeError(result.value!)).toBe(true);
    expect(isTypeError(sound(ce.box(['g', 3])))).toBe(true);
  });

  test('a value assigned before the literal is read by its type', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      'let y = "abc"\nlet g = (x) => [-x, y]\ng(3)'
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value!.toString()).toBe('[-3,"abc"]');
    expect(sound(ce.box(['g', 3])).toString()).toBe('[-3,"abc"]');
  });
});

describe('CE-473: THE COMPILED ROUTE GIVES THE VALUE OF THE INTERPRETER OR REFUSES', () => {
  test('after an assignment, the anonymous call compiles to the same value', () => {
    const ce = new ComputeEngine();
    const g = ce.box(LITERAL as any);
    ce.assign('y', ce.string('abc'));
    const call = ce.box(['Apply', g, 3]);
    const result = compile(call);
    expect(result.success).toBe(true);
    expect(JSON.stringify(result.run!({}))).toBe('[-3,"abc"]');
    expect(sound(call).toString()).toBe('[-3,"abc"]');
  });

  test('a value written on the definition directly is refused', () => {
    const ce = new ComputeEngine();
    const g = ce.box(LITERAL as any);
    const def = ce.lookupDefinition('y') as {
      value: { value: Expression | undefined };
    };
    def.value.value = ce.string('abc');
    expect(() => compile(ce.box(['Apply', g, 3]), { fallback: false })).toThrow(
      /Could not compile the symbol 'y'/
    );
  });

  test('a named function whose stored signature no longer holds is refused', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(LITERAL as any));
    ce.assign('y', ce.string('abc'));
    expect(() => compile(ce.box(['g', 3]), { fallback: false })).toThrow(
      /Could not compile the function 'g'/
    );
  });

  test('a named function whose captured value keeps its type compiles', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(LITERAL as any));
    ce.assign('y', 5);
    const result = compile(ce.box(['g', 3]));
    expect(result.success).toBe(true);
    expect(JSON.stringify(result.run!({}))).toBe('[-3,5]');
  });
});

describe('CE-473 (c): THE CHECK READS THE TYPE OF THE CALL NODE', () => {
  test('the asynchronous evaluation of a named call is checked too', async () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto [-x, y]'));
    expect(ce.box(['g', 1]).type.toString()).toBe('vector<2>');
    ce.assign('y', ce.string('hello'));
    expect(isTypeError(ce.box(['g', 1]).evaluate())).toBe(true);
    expect(isTypeError(await ce.box(['g', 1]).evaluateAsync())).toBe(true);
  });

  test.each(['operator', 'value'])(
    'a mapped call and a partial application of a %s definition are read',
    (route) => {
      // `y` changes from an integer to a rational: the type of `g` relied on
      // `y: integer`, so its calls are checked. A call that maps `g` over a
      // list and a partial application are typed by their nodes, which hold
      // their values.
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let y = 2');
      if (route === 'operator')
        ce.assign('g', ce.parse('(x, z) \\mapsto x + y'));
      else executeEpsil(ce, 'let g = (x, z) => x + y');
      executeEpsil(ce, 'y = 1/2');
      expect(sound(ce.box(['g', 1, 0])).toString()).toBe('3/2');
      expect(sound(ce.box(['g', ['List', 1, 2], 0])).toString()).toBe(
        '[3/2,5/2]'
      );
      const partial = sound(ce.box(['g', 1]));
      expect(partial.operator).toBe('Function');
    }
  );
});

describe('CE-473 (c): THE COMPILED ROUTE WHATEVER THE TYPE OF THE DEFINITION', () => {
  test('a definition declared `function` whose captured symbol changed type is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign('g', ce.parse('x \\mapsto x + y'));
    ce.assign('y', ce.string('s'));
    // The interpreter: `Add` refuses the string operand.
    const call = ce.box(['g', 1]);
    expect(isTypeError(sound(call))).toBe(true);
    // The compiled `x + y` would be a string concatenation, `"1s"`.
    expect(() => compile(call, { fallback: false })).toThrow(
      /Could not compile the function 'g'/
    );
  });
});

describe('CE-473 (c): A CHECKPOINT RESTORES THE RECORDED CAPTURED TYPES', () => {
  test('the types recorded for a definition come back with its value', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'string');
    ce.declare('g', 'function');
    ce.assign('g', ce.box(LITERAL as any));
    expect(ce.box('y').type.toString()).toBe('number');
    const def = (ce.lookupDefinition('g') as { value: object }).value;
    const cp = ce.checkpoint();
    ce.assign('g', ce.box(['Function', ['List', 'x', 'w'], 'x']));
    ce.restore(cp);
    // The restored value reads `y`: a change of the type of `y` is seen.
    ce.assign('y', ce.string('s'));
    expect(capturedTypesWidened(def)).toBe(true);
    expect(() => compile(ce.box(['g', 1]), { fallback: false })).toThrow(
      /Could not compile the function 'g'/
    );
  });
});
