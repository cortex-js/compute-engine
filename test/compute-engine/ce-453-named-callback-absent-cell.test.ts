/**
 * ROADMAP CE-453: a named numeric callback of `Map` over a list with an
 * absent cell was typed with the declared result of the callback.
 *
 * `Map(Abs, [1, Missing, 2])` was typed `vector<3>` (the declared result of
 * `Abs` is `number`), while `Map(x ↦ |x|, [1, Missing, 2])` is
 * `list<integer | nan^3>`: the `Abs` type handler types the body, and the
 * absent cell gives `NaN`. The named callback is now typed by the same
 * handler when an element of the source can be absent. Since the user
 * decision of 2026-10-25 (ROADMAP CE-45.2), the handler types the named
 * callback over elements that cannot be absent too.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

const ce = new ComputeEngine();

describe('A NAMED NUMERIC CALLBACK OVER AN ABSENT CELL (CE-453)', () => {
  test.each(['Abs', 'Negate'])(
    'Map(%s, [1, Missing, 2]) is typed as the lambda spelling',
    (op) => {
      const named = ce.box(['Map', op, ['List', 1, 'Missing', 2]]);
      const lambda = ce.box([
        'Map',
        ['Function', [op, 'x'], 'x'],
        ['List', 1, 'Missing', 2],
      ]);
      expect(named.type.toString()).toBe('list<integer | nan^3>');
      expect(named.type.toString()).toBe(lambda.type.toString());
      expect(named.evaluate().type.matches(named.type)).toBe(true);
    }
  );

  test('a named callback over present elements is typed by its handler', () => {
    expect(ce.box(['Map', 'Negate', ['List', 1, 2]]).type.toString()).toBe(
      'vector<integer^2>'
    );
  });
});

describe('A NUMERIC HANDLER OVER AN OPERAND TYPED NAN (CE-453)', () => {
  // `Abs(NaN)` is `NaN`, so the type of `Abs(w)` with `w: nan` must hold
  // `nan`. It was `real<0..> | signed_infinity`.
  test.each([
    'Abs',
    'Negate',
    'Sqrt',
    'Floor',
    'Sign',
    'Fract',
    'Conjugate',
    'Re',
    'Im',
    'Arg',
  ])('%s(w) with w: nan holds NaN', (op) => {
    const engine = new ComputeEngine();
    engine.declare('w', 'nan');
    const t = engine.box([op, 'w']).type;
    expect(isSubtype('nan', t.type)).toBe(true);
  });
});
