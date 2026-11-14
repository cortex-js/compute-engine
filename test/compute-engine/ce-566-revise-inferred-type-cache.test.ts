import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// CE-566. A symbol whose type was inferred from its assigned value, and whose
// value is an expression that reads other symbols (`C_0 := Sum(…)` over `C`
// and `U`), has the static type of that value (decision D16): it follows a
// change of the TYPE of the symbols the value reads, which their assignments
// set, and reads none of their values.

type ValueDef = {
  declaredType: { toString(): string };
  storedValue: Expression | undefined;
};

function valueDef(ce: ComputeEngine, name: string): ValueDef {
  const def = ce.lookupDefinition(name) as unknown as
    { value: ValueDef } | undefined;
  if (def === undefined || !('value' in def))
    throw new Error(`no value definition for ${name}`);
  return def.value;
}

function chainEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', 3, 1, 3, 2]));
  ce.assign('C', ce.box(['Map', ['Function', ['Add', 'k', 1], 'k'], 'L']));
  ce.assign('U', ce.box(['Unique', 'C']));
  ce.assign(
    'C_0',
    ce.box([
      'Sum',
      ['If', ['Equal', 'C', ['At', 'U', 'i']], 'i', 0],
      ['Limits', 'i', 1, ['Length', 'U']],
    ])
  );
  ce.assign('X', ce.box(['Function', ['At', 'C_0', 'l'], 'l']));
  return ce;
}

describe('CE-566: the type of a formula follows the types of the names it reads', () => {
  test('a change of L to a list of another length and element type', () => {
    const ce = chainEngine();
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^4>');
    expect(ce.box('C_0').evaluate().toString()).toBe('[1,2,1,3]');
    expect(ce.box(['X', 4]).evaluate().toString()).toBe('3');

    ce.assign('L', ce.box(['List', 0.5, 2.5]));
    expect(valueDef(ce, 'C_0').declaredType.toString()).toBe(
      'vector<integer^2>'
    );
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^2>');
    expect(ce.box('C_0').evaluate().toString()).toBe('[1,2]');
    expect(ce.box(['X', 2]).evaluate().toString()).toBe('2');

    ce.assign('L', ce.box(['List', 3, 1, 3, 2]));
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^4>');
    expect(ce.box(['X', 4]).evaluate().toString()).toBe('3');
  });

  test('a change of C to a value that is not a collection, and back', () => {
    const ce = chainEngine();
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^4>');
    ce.assign('C', 5);
    expect(ce.box('C_0').type.toString()).toBe('list<any> | number');
    ce.assign('C', ce.box(['List', 7, 8, 7]));
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^3>');
    expect(ce.box('C_0').evaluate().toString()).toBe('[1,2,1]');
    expect(ce.box(['X', 3]).evaluate().toString()).toBe('1');
  });

  test('the type of the call X(1) and its value follow a change of L', () => {
    const ce = chainEngine();
    const call = ce.box(['X', 1]);
    expect(call.evaluate().toString()).toBe('1');
    ce.assign('L', ce.box(['List', 9, 9]));
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^2>');
    expect(ce.box(['X', 1]).evaluate().toString()).toBe('1');
    expect(ce.box(['X', 2]).evaluate().toString()).toBe('1');
  });

  test('a write of the same type moves no type', () => {
    const ce = chainEngine();
    const def = valueDef(ce, 'C_0');
    expect(def.declaredType.toString()).toBe('vector<integer^4>');
    ce.box(['X', 1]).evaluate();
    const version = (
      ce as unknown as { _configurationLifecycle: { typeVersion: number } }
    )._configurationLifecycle.typeVersion;
    // `L` holds another list of the same type: its type, and so the type of
    // `C_0`, do not change, and no type is computed again.
    ce.assign('L', ce.box(['List', 2, 2, 1, 3]));
    expect(
      (ce as unknown as { _configurationLifecycle: { typeVersion: number } })
        ._configurationLifecycle.typeVersion
    ).toBe(version);
    expect(def.declaredType.toString()).toBe('vector<integer^4>');
    expect(ce.box('C_0').evaluate().toString()).toBe('[1,1,2,3]');
  });
});
