import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

/**
 * The type and the value of a call of a user function whose argument is
 * absent (the symbol `Missing`).
 *
 * The type is derived from the body of the function (`callResultType`,
 * `boxed-expression/call-result-type.ts`) with the parameter typed as the
 * call binds the absent value:
 * - at a numeric parameter, or a point parameter (a tuple of numbers), the
 *   call gives `Missing` without running the body, so the call is typed
 *   `missing`;
 * - at a parameter with no type, or of type `any` or `unknown`, it is typed
 *   `missing`;
 * - at any other parameter (a list, a string, a boolean, a
 *   `broadcastable<…>` point) the call is an `incompatible-type` error.
 *
 * A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing` is
 * a result only"), so an argument declared `T | missing` and a parameter
 * declared `string | missing` are static errors.
 *
 * ROADMAP CE-422: with `f: (broadcastable<tuple<number, number>>) -> unknown`
 * the call over `tuple<number, number> | missing` was typed
 * `tuple<missing, missing> | tuple<number, number>`, a type no value has. The
 * same derivation typed the call at a `string` parameter with a
 * `tuple<missing, …>` arm, and at a `real` parameter it gave
 * `tuple<real, integer>` for the value `(NaN, 1)`.
 */

const POINT = 'tuple<number, number>';
const MOVE = 'a \\mapsto (a.x+1, a.y+1)';
const PAIR = 'a \\mapsto (a, 1)';

function call(
  signature: string | undefined,
  body: string
): { type: string; absentFits: boolean | 'error'; absent: string } {
  const ce = new ComputeEngine();
  if (signature !== undefined)
    ce.declare('f', { signature: `(${signature}) -> unknown` });
  ce.assign('f', ce.parse(body));
  const expr = ce.box(['f', 'Missing']);
  const type = expr.type;
  const value = expr.evaluate();
  return {
    type: type.toString(),
    absent: value.toString(),
    absentFits:
      value.operator === 'Error'
        ? 'error'
        : isSubtype(value.type.type, type.type),
  };
}

describe('the type of a call over an absent argument', () => {
  test.each([
    [`broadcastable<${POINT}>`, MOVE],
    ['list<real>', PAIR],
    ['string', PAIR],
    ['boolean', PAIR],
  ])(
    'an absent argument at a `%s` parameter is refused',
    (signature, body) => {
      const r = call(signature, body);
      expect(r.type).toBe('error');
      expect(r.absentFits).toBe('error');
      expect(r.absent).toMatch(/^Error\(ErrorCode\("incompatible-type"/);
    }
  );

  // A point parameter (a tuple of numbers) is like a numeric one.
  test.each([['real'], ['integer'], ['number'], [POINT]])(
    'an absent argument at a `%s` parameter gives Missing',
    (signature) => {
      const r = call(signature, PAIR);
      expect(r.type).toBe('missing');
      expect(r.absent).toBe('"Missing"');
      expect(r.absentFits).toBe(true);
    }
  );

  test.each([['any'], ['unknown'], [undefined]])(
    'an absent argument at a `%s` parameter is bound as it is',
    (signature) => {
      const r = call(signature, PAIR);
      expect(r.type).toBe('tuple<missing, integer>');
      expect(r.absent).toBe('("Missing", 1)');
      expect(r.absentFits).toBe(true);
    }
  );

  test('an argument or a parameter declared with missing is a static error', () => {
    const ce = new ComputeEngine();
    expect(() => ce.declare('P', 'string | missing')).toThrow();
    expect(() =>
      ce.declare('f', { signature: '(string | missing) -> unknown' })
    ).toThrow();
  });

  test('an argument that is always absent gives Missing at a numeric parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(real) -> unknown' });
    ce.assign('f', ce.parse(PAIR));
    const expr = ce.box(['f', 'Missing']);
    expect(expr.type.toString()).toBe('missing');
    expect(expr.evaluate().toString()).toBe('"Missing"');
  });

  test('one literal assigned to two functions declared differently', () => {
    // The derived type depends on the declared parameter types, so the
    // cache of derived types is keyed on them too.
    const ce = new ComputeEngine();
    const literal = ce.parse(PAIR);
    ce.declare('g', { signature: '(real) -> unknown' });
    ce.assign('g', literal);
    ce.declare('h', { signature: '(any) -> unknown' });
    ce.assign('h', literal);
    const g = ce.box(['g', 'Missing']);
    const h = ce.box(['h', 'Missing']);
    expect(g.type.toString()).toBe('missing');
    expect(h.type.toString()).toBe('tuple<missing, integer>');
    expect(g.evaluate().toString()).toBe('"Missing"');
    expect(h.evaluate().toString()).toBe('("Missing", 1)');
  });

  test('a bare parameter beside an annotated one binds an absent argument', () => {
    // The literal annotates `n` only: its bare parameter `p` admits any
    // argument (`_validationSignature`), although `signature` reads
    // `unknown` there, so an absent `p` is bound as it is.
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('(p, n: \\mathrm{number}) \\mapsto (p, n)'));
    const expr = ce.box(['g', 'Missing', 2]);
    expect(expr.type.toString()).toBe('tuple<missing, integer>');
    expect(expr.evaluate().toString()).toBe('("Missing", 2)');
  });
});
