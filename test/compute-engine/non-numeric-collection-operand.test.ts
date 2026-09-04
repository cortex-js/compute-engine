import { ComputeEngine } from '../../src/compute-engine';
import { broadcastFrames } from '../../src/compute-engine/boxed-expression/error-value';

// A collection whose static element type is provably non-numeric
// (`list<string^2>`, `list<boolean^2>`, `set<string>`) at a threadable numeric
// parameter is an invalid call AT BOXING, the same as the scalar `Ln("a")`.
// Before 2026-09-04 the numeric fast path (`checkNumericArgs`) admitted any
// dimensioned list through its tensor arm, and the definition route only ran
// the element-carrier check for the canonical-handler seam, so `Ln(["a", "b"])`
// and `Abs(["a", "b"])` were valid calls that failed in every cell at
// evaluation while `Sin(["a", "b"])` was refused at boxing.
//
// A collection whose element type is NOT provably non-numeric — a mixed
// `list<integer | string>`, an `unknown` element, an absence arm — keeps the
// fail-open admission: the evaluate-time gate reports a mismatch per cell.
//
// The refusal is the contract of a `broadcastable: true` LIBRARY OPERATOR. A
// user function — a value definition, or a lambda promoted to an operator
// definition by the vectorization default — is broadcast per element by the
// lambda machinery at evaluation, and each failing cell reports its own error
// with a broadcast frame (`broadcast-error-context.test.ts`), so its
// application stays fail-open.

const ce = new ComputeEngine();

const STRINGS = ['List', "'a'", "'b'"];
const BOOLEANS = ['List', 'True', 'False'];

function invalidWithListOperand(head: string, operand: unknown): void {
  const e = ce.box([head, operand] as any);
  expect(e.isValid).toBe(false);
  // The error wraps the WHOLE collection, not a cell.
  const bad = e.ops!.find((op) => !op.isValid)!;
  expect(bad.operator).toBe('Error');
  expect(bad.op1.toString()).toContain('incompatible-type');
  expect(bad.op2.operator).toBe(operand[0]);
}

describe('a provably non-numeric collection at a threadable numeric slot', () => {
  test.each(['Ln', 'Sqrt', 'Exp', 'Negate', 'Square'])(
    '%s over a list of strings is invalid at boxing (numeric fast path)',
    (head) => invalidWithListOperand(head, STRINGS)
  );

  test.each(['Abs', 'Sin', 'Cos', 'Floor', 'Arctan'])(
    '%s over a list of strings is invalid at boxing (definition route)',
    (head) => invalidWithListOperand(head, STRINGS)
  );

  test('a list of booleans is refused too', () => {
    invalidWithListOperand('Ln', BOOLEANS);
    invalidWithListOperand('Abs', BOOLEANS);
  });

  test('a nested list of strings is refused (its element type is a list of strings)', () => {
    invalidWithListOperand('Ln', ['List', ['List', "'a'"]]);
  });

  test('a set of strings is refused', () => {
    invalidWithListOperand('Ln', ['Set', "'a'", "'b'"]);
  });

  test('Add and Multiply refuse a list of strings, in either position', () => {
    for (const head of ['Add', 'Multiply']) {
      const e = ce.box([head, STRINGS, 1] as any);
      expect(e.isValid).toBe(false);
      const f = ce.box([head, 1, STRINGS] as any);
      expect(f.isValid).toBe(false);
    }
  });

  test('Power and Divide refuse a list of strings in either slot', () => {
    for (const head of ['Power', 'Divide']) {
      expect(ce.box([head, STRINGS, 2] as any).isValid).toBe(false);
      expect(ce.box([head, 2, STRINGS] as any).isValid).toBe(false);
    }
  });

  test('the scalar and the collection spellings agree', () => {
    expect(ce.box(['Ln', "'a'"]).isValid).toBe(false);
    expect(ce.box(['Ln', STRINGS] as any).isValid).toBe(false);
  });
});

describe('a collection that could hold numbers keeps the fail-open admission', () => {
  test('a mixed list<integer | string> is admitted and fails per cell', () => {
    const e = ce.box(['Ln', ['List', 1, "'b'"]] as any);
    expect(e.isValid).toBe(true);
    const v = e.evaluate();
    expect(v.operator).toBe('List');
    expect(v.op1.isSame(0)).toBe(true);
    expect(v.op2.operator).toBe('Error');
  });

  test('a list of numbers is admitted and evaluates element-wise', () => {
    const e = ce.box(['Ln', ['List', 1, 2]] as any);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().json).toEqual(['List', 0, ['Ln', 2]]);
    expect(ce.box(['Abs', ['List', -1, 2]] as any).evaluate().json).toEqual([
      'List',
      1,
      2,
    ]);
  });

  test('a collection-typed symbol with an unknown element type is admitted', () => {
    const local = new ComputeEngine();
    local.declare('xs', 'list');
    expect(local.box(['Ln', 'xs']).isValid).toBe(true);
    expect(local.box(['Abs', 'xs']).isValid).toBe(true);
  });

  test('a collection-typed symbol with a string element type is refused', () => {
    const local = new ComputeEngine();
    local.declare('ss', 'list<string>');
    expect(local.box(['Ln', 'ss']).isValid).toBe(false);
    expect(local.box(['Abs', 'ss']).isValid).toBe(false);
  });

  test('a list with an absence arm is admitted (the runtime gate owns the cell)', () => {
    const local = new ComputeEngine();
    local.declare('ms', 'list<number | missing>');
    expect(local.box(['Ln', 'ms']).isValid).toBe(true);
    expect(local.box(['Abs', 'ms']).isValid).toBe(true);
    local.declare('allAbsent', 'list<missing>');
    expect(local.box(['Ln', 'allAbsent']).isValid).toBe(true);
    expect(local.box(['Abs', 'allAbsent']).isValid).toBe(true);
  });

  test('an absence arm does not mask a non-numeric carrier', () => {
    // `list<string | missing>`: the non-absent cells are strings, so the
    // collection is refused like `list<string>` on both routes.
    const local = new ComputeEngine();
    local.declare('sm', 'list<string | missing>');
    expect(local.box(['Ln', 'sm']).isValid).toBe(false);
    expect(local.box(['Abs', 'sm']).isValid).toBe(false);
  });

  test('an overloaded broadcastable operator selects the string arm for a list of strings', () => {
    // The collection verdict rides into the overload arm trials: the numeric
    // arm is not viable for a `list<string>`, so the string arm is selected
    // and the call is valid.
    const local = new ComputeEngine();
    local.declare('twoArms', {
      signature: '((number) -> number) & ((string) -> string)',
      broadcastable: true,
      evaluate: ([x]) => x,
    });
    expect(local.box(['twoArms', STRINGS] as any).isValid).toBe(true);
    expect(local.box(['twoArms', ['List', 1, 2]] as any).isValid).toBe(true);
    // The element check is a NUMERIC-slot check: at the `string` arm a list
    // of booleans is admitted fail-open, as any collection is at a
    // non-numeric threadable slot.
    expect(local.box(['twoArms', BOOLEANS] as any).isValid).toBe(true);
  });
});

describe('a user-function application keeps the per-cell broadcast diagnostics', () => {
  test('a scalar-parameter lambda over a list of strings errors per cell', () => {
    const local = new ComputeEngine();
    local.assign(
      'bump',
      local.box(['Function', ['Add', 'n', 1], ['Typed', 'n', { str: 'integer' }]])
    );
    const call = local.box(['bump', STRINGS] as any);
    expect(call.isValid).toBe(true);
    const value = call.evaluate();
    expect(value.operator).toBe('List');
    expect(value.nops).toBe(2);
    expect(value.op1.operator).toBe('Error');
    expect(broadcastFrames(value.op1)).toEqual([
      { operator: 'bump', index: 1, length: 2 },
    ]);
  });

  test('a declared broadcastable<number> function over a list<string> sibling errors per cell', () => {
    const local = new ComputeEngine();
    local.declare('h', '(broadcastable<number>, number) -> unknown');
    local.assign('h', local.box(['Function', ['Tuple', 'x', 'y'], 'x', 'y']));
    const value = local
      .box(['h', ['List', 1, 2], STRINGS] as any)
      .evaluate();
    expect(value.operator).toBe('List');
    expect(value.op1.operator).toBe('Error');
  });
});
