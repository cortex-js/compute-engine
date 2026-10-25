import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

/**
 * The type of a call of a user function whose argument may be absent
 * (`P: T | missing`), and the value of the call when the argument is absent.
 *
 * The type is derived from the body of the function (`callResultType`,
 * `boxed-expression/call-result-type.ts`) a second time with the parameter
 * typed as the call binds the absent value:
 * - at a numeric parameter the absent value is read as `NaN`, so the
 *   parameter is typed `nan`;
 * - at a parameter with no type, or a type with a `missing` member, it is
 *   typed `missing`;
 * - at any other parameter (a point, a list, a string, a boolean) the call is
 *   an `incompatible-type` error, and the absent case adds nothing to the type.
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
  argument: string,
  body: string
): { type: string; absentFits: boolean | 'error'; absent: string } {
  const ce = new ComputeEngine();
  if (signature !== undefined)
    ce.declare('f', { signature: `(${signature}) -> unknown` });
  ce.assign('f', ce.parse(body));
  ce.declare('P', `${argument} | missing`);
  const expr = ce.parse('f(P)');
  const type = expr.type;
  ce.assign('P', ce.Missing);
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

describe('the type of a call over an argument that may be absent', () => {
  test.each([
    [`broadcastable<${POINT}>`, POINT, MOVE, 'tuple<number, number>'],
    [POINT, POINT, MOVE, 'tuple<number, number>'],
    ['list<real>', 'list<real>', PAIR, 'tuple<list<real>, integer>'],
    ['string', 'string', PAIR, 'tuple<string, integer>'],
    ['boolean', 'boolean', PAIR, 'tuple<boolean, integer>'],
  ])(
    'an absent argument at a `%s` parameter is refused',
    (signature, argument, body, type) => {
      const r = call(signature, argument, body);
      expect(r.type).toBe(type);
      expect(r.absentFits).toBe('error');
      expect(r.absent).toMatch(/^Error\(ErrorCode\("incompatible-type"/);
    }
  );

  test.each([
    ['real', 'tuple<nan, integer> | tuple<real, integer>'],
    ['integer', 'tuple<integer, integer> | tuple<nan, integer>'],
    ['number', 'tuple<number, integer>'],
  ])(
    'an absent argument at a `%s` parameter is read as NaN',
    (signature, type) => {
      const r = call(signature, signature, PAIR);
      expect(r.type).toBe(type);
      expect(r.absent).toBe('(NaN, 1)');
      expect(r.absentFits).toBe(true);
    }
  );

  test.each([['string | missing'], ['any'], ['unknown'], [undefined]])(
    'an absent argument at a `%s` parameter is bound as it is',
    (signature) => {
      const r = call(signature, 'string', PAIR);
      expect(r.type).toBe('tuple<missing, integer> | tuple<string, integer>');
      expect(r.absent).toBe('("Missing", 1)');
      expect(r.absentFits).toBe(true);
    }
  );

  test('an argument that is always absent is read as NaN at a numeric parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(real) -> unknown' });
    ce.assign('f', ce.parse(PAIR));
    const expr = ce.box(['f', 'Missing']);
    expect(expr.type.toString()).toBe('tuple<nan, integer>');
    expect(expr.evaluate().toString()).toBe('(NaN, 1)');
  });

  test('one literal assigned to two functions declared differently', () => {
    // The derived type depends on the declared parameter types, so the
    // cache of derived types is keyed on them too.
    const ce = new ComputeEngine();
    const literal = ce.parse(PAIR);
    ce.declare('g', { signature: '(real) -> unknown' });
    ce.assign('g', literal);
    ce.declare('h', { signature: '(real | missing) -> unknown' });
    ce.assign('h', literal);
    ce.declare('P', 'real | missing');
    const g = ce.box(['g', 'P']);
    const h = ce.box(['h', 'P']);
    expect(g.type.toString()).toBe(
      'tuple<nan, integer> | tuple<real, integer>'
    );
    expect(h.type.toString()).toBe(
      'tuple<missing, integer> | tuple<real, integer>'
    );
    ce.assign('P', ce.Missing);
    expect(g.evaluate().toString()).toBe('(NaN, 1)');
    expect(h.evaluate().toString()).toBe('("Missing", 1)');
  });

  test('a bare parameter beside an annotated one binds an absent argument', () => {
    // The literal annotates `n` only: its bare parameter `p` admits any
    // argument (`_validationSignature`), although `signature` reads
    // `unknown` there, so an absent `p` is bound as it is.
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('(p, n: \\mathrm{number}) \\mapsto (p, n)'));
    ce.declare('P', 'tuple<integer, integer> | missing');
    const expr = ce.box(['g', 'P', 2]);
    expect(expr.type.toString()).toBe(
      'tuple<missing, integer> | tuple<tuple<integer, integer>, integer>'
    );
    ce.assign('P', ce.Missing);
    expect(expr.evaluate().toString()).toBe('("Missing", 2)');
  });
});
