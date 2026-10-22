import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// One default for an absent argument at a library parameter that excludes
// absence (rule R3, user decision P2 of
// `docs/plans/2026-10-21-presence-contracts-and-assertion.md`, 2026-10-21):
// an `incompatible-type` error naming the parameter, as a user function
// answers for the same argument. The exceptions stay explicit: a declared
// `handle`, a resolved `propagate` (numeric and collection operators answer
// the marker of their result), an operator that holds its operands, and a
// parameter read as a form (`expression`, `symbol`) or admitting anything
// (`any`, `unknown`).
//
// The Epsil static check reports a possibly absent argument at such a
// parameter on the same terms as at a function literal's annotated parameter
// (decision P3), with the same discharges: `?!`, `??`, or a guard.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
  ce.declare('om', 'string | missing');
  ce.assign('om', ce.Missing);
  ce.declare('ob', 'boolean | missing');
  ce.assign('ob', ce.Missing);
});

function run(source: string): { value: string; diagnostics: string[] } {
  const r = executeEpsil(new ComputeEngine(), source);
  return {
    value: r.value.toString(),
    diagnostics: r.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join(' ') : String(d.message)
    ),
  };
}

describe('the evaluation default', () => {
  test.each([
    ['ToUpperCase', 'om', 'character | string'],
    ['Trim', 'om', 'character | string'],
    ['Parse', 'om', 'string'],
    ['Boole', 'ob', 'boolean'],
    ['IsSatisfiable', 'ob', 'boolean'],
  ])('%s refuses an absent argument, naming the parameter', (op, arg, param) => {
    const v = ce.box([op, arg]).evaluate();
    expect(v.operator).toBe('Error');
    expect(v.toString()).toBe(
      `Error(ErrorCode("incompatible-type", "${param}", "missing"), "Missing")`
    );
  });

  test('the resolved rule reads the definition', () => {
    const def = (name: string) => ce.lookupDefinition(name)!.operator!;
    expect(def('ToUpperCase').refusesAbsentOperandAt(0)).toBe(true);
    expect(def('Boole').refusesAbsentOperandAt(0)).toBe(true);
    // `any`: the operand may be meant as data, absent or not.
    expect(def('KeyValuePair').refusesAbsentOperandAt(1)).toBe(false);
    // A form: an absent symbol is a form too.
    expect(def('Condition').refusesAbsentOperandAt(0)).toBe(false);
    // A declared behavior wins.
    expect(def('Coalesce').refusesAbsentOperandAt(0)).toBe(false);
    expect(def('Length').refusesAbsentOperandAt(0)).toBe(false);
    // Numbers and collections propagate.
    expect(def('Sin').refusesAbsentOperandAt(0)).toBe(false);
    expect(def('Reverse').refusesAbsentOperandAt(0)).toBe(false);
  });

  test('a parameter admitting anything still takes the absent value', () => {
    expect(ce.box(['KeyValuePair', "'a'", 'om']).evaluate().toString()).toBe(
      '("a", "Missing")'
    );
  });

  test('the declared behaviors are unchanged', () => {
    expect(ce.box(['Length', 'om']).evaluate().toString()).toBe('NaN');
    expect(ce.box(['Equal', 'om', "'a'"]).evaluate().symbol).toBe('Missing');
    expect(ce.box(['Sin', 'Missing']).evaluate().toString()).toBe('NaN');
    expect(ce.box(['Coalesce', 'om', "'d'"]).evaluate().string).toBe('d');
  });

  test('an absent condition keeps its own message', () => {
    expect(ce.box(['If', 'ob', 1, 2]).evaluate().toString()).toContain(
      'The condition is absent'
    );
  });

  test('the refusal is at evaluation, not at boxing', () => {
    // A canonical form must not depend on the value assigned to a symbol:
    // the call boxes without an error while `w` holds the absent value, the
    // evaluation refuses it, and the same boxed expression evaluates to the
    // string once `w` holds one. The symbol is declared: an undeclared
    // symbol assigned `Missing` is inferred `missing`, a type that no
    // admission matches to `character | string` (as `n := 5; ToUpperCase(n)`
    // is refused), so that form is a type error at boxing on every route.
    ce.declare('w', 'string | missing');
    ce.assign('w', ce.Missing);
    const expr = ce.box(['ToUpperCase', 'w']);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "character | string", "missing"), "Missing")'
    );
    ce.assign('w', ce.string('abc'));
    expect(expr.evaluate().toString()).toBe('"ABC"');
  });

  test('the asynchronous route answers the same', async () => {
    const v = await ce.box(['ToUpperCase', 'om']).evaluateAsync();
    expect(v.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "character | string", "missing"), "Missing")'
    );
  });
});

describe('the Epsil static check at a library parameter', () => {
  const XS = 'let xs: list<string> = ["a"]\nlet i: integer = 1\n';

  test('a possibly absent argument is reported', () => {
    const r = run(`${XS}trim(xs[i])`);
    expect(r.diagnostics.join(' ')).toContain(
      'expected `character | string`, got `missing | string` at `xs[i]`'
    );
    // The program still runs: the check is a linter.
    expect(r.value).toBe('"a"');
  });

  test('the three discharges are accepted', () => {
    expect(run(`${XS}trim(xs[i]?!)`).diagnostics).toEqual([]);
    expect(run(`${XS}trim(xs[i] ?? "z")`).diagnostics).toEqual([]);
    expect(
      run(`${XS}let v = xs[i]\nif isMissing(v) { "" } else { trim(v) }`)
        .diagnostics
    ).toEqual([]);
  });

  test('a numeric or collection parameter is not reported', () => {
    expect(
      run('let zs: list<number> = [4]\nlet i: integer = 3\nzs[i] + 1')
    ).toEqual({ value: 'NaN', diagnostics: [] });
    expect(run(`${XS}length(xs[i])`).diagnostics).toEqual([]);
  });

  test('the absent case fails at run time with the parameter named', () => {
    const r = run(`${XS.replace('= 1', '= 3')}trim(xs[i]?!)`);
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toContain('expected-present');
    const u = run('let xs: list<string> = ["a"]\nlet i: integer = 3\ntrim(xs[i])');
    expect(u.value).toContain('incompatible-type');
  });
});
