import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { validElementMemo } from '../../src/compute-engine/boxed-expression/collection-element-memo';

/**
 * CE-645: the element memo of a lazy collection must not keep an element
 * that was computed inside a transient precision or angular-unit window
 * (`_withTransientPrecision()`, `_withTransientAngularUnit()`). Such a
 * window moves no engine version, and before the fix the memo tested it
 * only when it stored the walk. So a walk started outside a window, pulled
 * inside it and finished outside it stored elements with the digits of the
 * window, and later reads served them at the precision of the engine.
 *
 * Each test starts with a collection that no walk has read: a stored walk
 * would serve its elements to the windowed walk, which is the behavior under
 * test.
 */

function strings(it: Iterable<Expression>): string[] {
  return [...it].map((x) => x.toString());
}

const THIRD_AT_ENGINE_PRECISION = '0.333333333333333333333';

describe('CE-645: a walk pulled inside a transient precision window', () => {
  it('is not stored, and later reads compute at the engine precision', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['List', ['Rational', 1, 3]]));
    const j = ce.box([
      'Join',
      ['Map', ['Function', ['N', 'x'], 'x'], 'a'],
      ['List', 9],
    ]);

    const it = j.each();
    const inside: string[] = [];
    ce._withTransientPrecision(5, () => {
      inside.push(it.next().value!.toString());
      inside.push(it.next().value!.toString());
    });
    // The window is closed; the walk ends outside it.
    expect(it.next().done).toBe(true);
    expect(inside).toEqual(['0.33333', '9']);

    expect(validElementMemo(j)).toBeUndefined();
    expect(strings(j.each())).toEqual([THIRD_AT_ENGINE_PRECISION, '9']);
    expect(j.at(1)!.toString()).toBe(THIRD_AT_ENGINE_PRECISION);
  });

  it('a window opened and closed between two pulls does not prevent the store', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['List', ['Rational', 1, 3]]));
    const j = ce.box([
      'Join',
      ['Map', ['Function', ['N', 'x'], 'x'], 'a'],
      ['List', 9],
    ]);
    const it = j.each();
    expect(it.next().value!.toString()).toBe(THIRD_AT_ENGINE_PRECISION);
    // No element is computed inside this window.
    ce._withTransientPrecision(5, () =>
      ce.box(['N', ['Rational', 1, 3]]).evaluate()
    );
    it.next();
    expect(it.next().done).toBe(true);
    expect(validElementMemo(j)).toBeDefined();
    expect(j.at(1)!.toString()).toBe(THIRD_AT_ENGINE_PRECISION);
  });
});

describe('CE-645: a walk pulled inside a transient angular-unit window', () => {
  it('is not stored, and later reads use the unit of the engine', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['List', 30]));
    const j = ce.box([
      'Join',
      ['Map', ['Function', ['N', ['Sin', 'x']], 'x'], 'a'],
      ['List', 9],
    ]);

    const it = j.each();
    let inside = '';
    ce._withTransientAngularUnit('deg', () => {
      inside = it.next().value!.toString();
      it.next();
    });
    expect(it.next().done).toBe(true);
    expect(inside).toBe('0.5');

    expect(validElementMemo(j)).toBeUndefined();
    const outside = strings(j.each());
    expect(outside[0]).toBe('-0.988031624092861789988');
    expect(j.at(1)!.toString()).toBe(outside[0]);
  });
});
