import { ComputeEngine } from '../../src/compute-engine';

/**
 * `Element(param, collection)` inside a function literal's body writes the
 * collection's ELEMENT TYPE onto the not-yet-typed parameter's binding — the
 * membership counterpart of the collection evidence `Length(cs)` writes onto
 * its operand (see the `Length` canonical handler in
 * `library/collections.ts`).
 *
 * Three deliberate limits, all pinned here:
 *
 * - PARAMETERS ONLY. Membership is a PREDICATE — `x in [1,2,3]` on a
 *   string-valued `x` is legitimately `False`, not a type error — so it must
 *   not retype a global symbol. A Solve domain spec
 *   (`Element(x, Range(1, 9))`) merely constrains its unknown.
 * - SET membership (`x ∈ ℤ`, `x ∈ {1,2,3}`) is how an assumption is spelled;
 *   set refinements belong to the assume machinery, which applies them SCOPED
 *   (P1-6 in assumptions.test.ts).
 * - The evidence is BINDING-only: a scalar element type never surfaces on a
 *   function literal's arrow (`inferredCollectionParameterType` filters it),
 *   so the lambda auto-broadcast default is unaffected.
 */

/** The binding type recorded for the (single) parameter of `name`. */
function paramBindingType(ce: ComputeEngine, name: string): string | undefined {
  const def = ce.lookupDefinition(name);
  if (!def || !('operator' in def)) return undefined;
  const lambda = def.operator.lambda;
  const pname = lambda?.parameters[0]?.name;
  if (lambda === undefined || pname === undefined) return undefined;
  const binding = lambda.body.localScope?.bindings.get(pname);
  if (binding === undefined || !('value' in binding)) return undefined;
  return binding.value.type.toString();
}

function declareDigits(ce: ComputeEngine): void {
  ce.box([
    'Assign',
    'digits',
    ['List', { str: '0' }, { str: '1' }, { str: '2' }],
  ]).evaluate();
}

describe('Element membership element-type inference (function parameters)', () => {
  test('box route: the parameter binding records the element type', () => {
    const ce = new ComputeEngine();
    declareDigits(ce);
    ce.box([
      'Assign',
      'isDigit',
      ['Function', ['Element', 'c', 'digits'], 'c'],
    ]).evaluate();

    // The binding carries the evidence…
    expect(paramBindingType(ce, 'isDigit')).toBe('string');

    // …but the arrow keeps an `unknown` slot (scalar evidence is filtered so
    // the broadcast lift stays available).
    expect(ce.box('isDigit').type.toString()).toBe('(unknown) -> boolean');
  });

  test('parse route: a mapsto literal records the element type too', () => {
    const ce = new ComputeEngine();
    declareDigits(ce);
    ce.box(['Assign', 'isDigit', ce.parse('c \\mapsto c \\in \\mathrm{digits}')]).evaluate();
    expect(paramBindingType(ce, 'isDigit')).toBe('string');
  });

  test('the lambda auto-broadcast is unaffected by the binding evidence', () => {
    const ce = new ComputeEngine();
    declareDigits(ce);
    ce.box([
      'Assign',
      'isDigit',
      ['Function', ['Element', 'c', 'digits'], 'c'],
    ]).evaluate();

    // Scalar application…
    expect(ce.box(['isDigit', { str: '1' }]).evaluate().toString()).toBe(
      '"True"'
    );
    // …and elementwise broadcast over a list both still work.
    expect(
      ce
        .box(['isDigit', ['List', { str: '1' }, { str: 'x' }]])
        .evaluate()
        .toString()
    ).toBe('["True","False"]');
  });

  test('a GLOBAL symbol is never retyped by membership (Solve domain spec)', () => {
    const ce = new ComputeEngine();
    // A membership constraint over a value collection at top level is a
    // predicate/constraint, not evidence about the symbol's type.
    ce.box(['Element', 'x', ['Range', 1, 9]]);
    expect(ce.box('x').type.toString()).toBe('unknown');

    // The Solve regression this pins: a domain-constrained solve earlier in a
    // session must not affect a later domain-less solve of the same unknown.
    ce.box([
      'Solve',
      ['Equal', ['Power', 'x', 2], 4],
      'x',
      'Integers',
    ]).evaluate();
    const r = ce.box(['Solve', ['Equal', ['Power', 'x', 2], 2], 'x']).evaluate();
    expect(r.nops).toBe(2);
  });

  test('set membership does NOT infer, even on a parameter (assumption territory)', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'isInt',
      ['Function', ['Element', 'n', 'Integers'], 'n'],
    ]).evaluate();
    expect(paramBindingType(ce, 'isInt')).toBe('unknown');
  });

  test('an annotated parameter is not overwritten', () => {
    const ce = new ComputeEngine();
    declareDigits(ce);
    ce.box([
      'Assign',
      'f',
      [
        'Function',
        ['Element', 'v', 'digits'],
        ['Typed', 'v', { str: 'string | missing' }],
      ],
    ]).evaluate();
    expect(paramBindingType(ce, 'f')).toBe('missing | string');
  });

  test('a same-named global is not hijacked by a bare parameter', () => {
    const ce = new ComputeEngine();
    // A pre-existing inferred-unknown global with the same name as the
    // parameter below.
    ce.box('zz');

    ce.box([
      'Assign',
      'isSmall',
      ['Function', ['Element', 'zz', ['List', 1, 2, 3]], 'zz'],
    ]).evaluate();

    // The parameter is a fresh local: the global is never retyped by the
    // body's evidence…
    expect(ce.box('zz').type.toString()).toBe('unknown');
    // …and the evidence lands on the parameter's own binding (it would be
    // `unknown` if the body had written onto the global instead).
    expect(paramBindingType(ce, 'isSmall')).toBe('integer');
  });
});
