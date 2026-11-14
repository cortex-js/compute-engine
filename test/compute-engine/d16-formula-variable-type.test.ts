import { ComputeEngine, compile } from '../../src/compute-engine';

//
// A variable whose value reads other names (a formula) has the static type
// of that value (decision D16 of `docs/plans/2026-11-11-bound-once-spec.md`):
// it follows a change of the TYPE of those names, which their assignments
// set, and reads none of their values.
//

function typeVersion(ce: ComputeEngine): number {
  return (ce as unknown as { _configurationLifecycle: { typeVersion: number } })
    ._configurationLifecycle.typeVersion;
}

describe('A FORMULA FOLLOWS THE TYPES OF THE NAMES IT READS', () => {
  test('a list that changes length', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.parse('[1,2,3]'));
    ce.assign('C', ce.parse('\\mathrm{Map}(k \\mapsto k+1, L)'));
    expect(ce.box('C').type.toString()).toBe('vector<integer^3>');
    ce.assign('L', ce.parse('[1,2,3,4,5]'));
    for (const [expr, type, value] of [
      ['C', 'vector<integer^5>', '[2,3,4,5,6]'],
      [['At', 'C', 5], 'integer', '6'],
      [['Reverse', 'C'], 'vector<integer^5>', '[6,5,4,3,2]'],
      [['Sin', 'C'], 'vector<5>', '[sin(2),sin(3),sin(4),sin(5),sin(6)]'],
    ] as const) {
      const e = ce.box(expr as any);
      expect(e.type.toString()).toBe(type);
      const v = e.evaluate();
      expect(v.toString()).toBe(value);
      expect(v.type.matches(e.type)).toBe(true);
    }
    // The compiled code gives the value of the interpreter.
    const sum = ce.box(['Add', 'C', ['List', 10, 20, 30]]);
    const r = compile(sum);
    expect(r.success).toBe(true);
    const expected = sum.evaluate().N().re;
    const run = (r.run as unknown as () => number)();
    expect(Number.isNaN(expected) ? Number.isNaN(run) : run === expected).toBe(
      true
    );
  });

  test('a formula over a name that is given a type', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.parse('x + 1'));
    expect(ce.box('y').type.toString()).toBe('number');
    ce.assign('x', ce.parse('[1, 2]'));
    expect(ce.box('y').type.toString()).toBe('vector<integer^2>');
    expect(ce.box('y').evaluate().toString()).toBe('[2,3]');
  });

  test('a cycle of formulas answers the recorded types', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('b + 1'));
    ce.assign('b', ce.parse('a + 1'));
    expect(ce.box('a').type.toString()).toBe('number');
    expect(ce.box('b').type.toString()).toBe('number');
    expect(ce.box(['Add', 'a', 'b']).type.toString()).toBe('number');
  });

  test('a formula that reads itself', () => {
    const ce = new ComputeEngine();
    ce.assign('w', ce.parse('w + 1'));
    expect(ce.box('w').type.toString()).toBe('number');
  });

  test('a new value of the same type moves no type and no type version', () => {
    const ce = new ComputeEngine();
    ce.assign('x', ce.parse('[1,2,3]'));
    ce.assign('C', ce.parse('\\mathrm{Map}(k \\mapsto k+1, x)'));
    ce.assign('n', 4);
    ce.assign('m', ce.parse('n + 1'));
    const nodes = [
      ce.box('C'),
      ce.box(['Sin', 'C']),
      ce.box('m'),
      ce.box(['Sqrt', 'm']),
    ];
    const before = nodes.map((e) => e.type.toString());
    const version = typeVersion(ce);
    ce.assign('x', ce.parse('[7,8,9]'));
    ce.assign('n', 9);
    ce.assign('n', -3);
    expect(typeVersion(ce)).toBe(version);
    expect(nodes.map((e) => e.type.toString())).toEqual(before);
    expect(ce.box('m').evaluate().toString()).toBe('-2');
  });
});

describe('A NEW VALUE OF A FORMULA VARIABLE MOVES ITS TYPE', () => {
  test('formula to literal', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.assign('y', ce.parse('x + 1'));
    const e = ce.box(['Add', 'y', 1]);
    expect(e.type.toString()).toBe('integer');
    ce.assign('y', 2.5);
    expect(ce.box('y').type.toString()).toBe('real');
    expect(e.type.toString()).toBe('real');
  });

  test('formula to a literal of another shape', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.assign('y', ce.parse('x + 1'));
    const e = ce.box(['Sin', 'y']);
    expect(e.type.toString()).toBe('real');
    ce.assign('y', ce.parse('[1, 2]'));
    expect(e.type.toString()).toBe('vector<2>');
  });

  test('formula to formula', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.assign('y', ce.parse('x + 1'));
    const e = ce.box(['Add', 'y', 1]);
    expect(e.type.toString()).toBe('integer');
    ce.assign('y', ce.box(['Sqrt', 'x']));
    expect(e.type.toString()).toBe('number');
  });

  test('literal to formula', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 3);
    ce.declare('x', 'real');
    const e = ce.box(['Add', 'y', 1]);
    expect(e.type.toString()).toBe('integer');
    ce.assign('y', ce.parse('x + 1'));
    expect(e.type.toString()).toBe('real');
  });

  test('the values of `withValues()` and their restore', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.assign('y', ce.parse('x + 1'));
    const e = ce.box(['Add', 'y', 1]);
    expect(e.type.toString()).toBe('integer');
    ce.withValues({ y: ce.parse('[1, 2]') }, () => {
      expect(e.type.toString()).toBe('vector<integer^2>');
    });
    expect(e.type.toString()).toBe('integer');
  });
});

describe('AN ALIAS AND A CALL ARE FORMULAS', () => {
  test('an alias follows the type of the name it reads', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.assign('y', ce.box('x'));
    expect(ce.box('y').type.toString()).toBe('integer');
    ce.assign('x', ce.parse('[1, 2]'));
    expect(ce.box('y').type.toString()).toBe('vector<integer^2>');
    expect(ce.box('y').evaluate().toString()).toBe('[1,2]');
  });

  test('an alias of a name with no type, or of a constant', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.box('z'));
    expect(ce.box('y').type.toString()).toBe('unknown');
    ce.declare('k', { type: 'integer', constant: true, value: 3 });
    ce.assign('w', ce.box('k'));
    expect(ce.box('w').type.toString()).toBe('integer');
  });

  test('a call of a user function follows the type of its result', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x+1'));
    ce.assign('y', ce.box(['f', 1]));
    expect(ce.box('y').type.toString()).toBe('number');
    ce.assign('f', ce.parse('x \\mapsto [x, x]'));
    expect(ce.box('y').type.toString()).toBe('vector<integer^2>');
    expect(ce.box('y').evaluate().toString()).toBe('[1,1]');
  });

  test('cycles of aliases and a recursive literal end', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.box('y'));
    ce.assign('a', ce.box('b'));
    ce.assign('b', ce.box('a'));
    ce.assign('g', ce.parse('x \\mapsto g(x)'));
    expect(ce.box('y').type.toString()).toBe('unknown');
    expect(ce.box('a').type.toString()).toBe('unknown');
    expect(ce.box('b').type.toString()).toBe('unknown');
    expect(ce.box('g').type.toString()).toBe('(x: unknown) -> unknown');
  });
});
