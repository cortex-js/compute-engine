/**
 * The profile `ir`: a parameter of a root function literal that the body
 * reads as a collection declines, and the removed mode `auto` declines on
 * the route of the profile as on the existing targets.
 *
 * A parameter of no declared type is a real. `w ↦ Sum(w)` read `w` as a
 * number: applied to `[3, 1, 2]` it gave the string "03,1,2" where the
 * interpreter gives 6 (`docs/COMPILATION-MODEL.md`, R3: a fold of the
 * elements of a collection whose type does not settle the shape of the
 * elements declines). `mode: 'auto'` compiled as `strict` and was reported
 * as `auto` (`docs/COMPILATION-MODEL.md`, "Compile modes").
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

type Json = unknown;
const ce = new ComputeEngine();
ce.declare('x', 'real');

function decline(json: Json, options: object = {}) {
  try {
    compile(ce.box(json as never), {
      profile: 'ir',
      fallback: false,
      ...options,
    } as never);
  } catch (e) {
    return (e as { diagnostic?: { code: string; message: string } }).diagnostic;
  }
  return undefined;
}

describe('a root function literal whose parameter the body reads as a collection', () => {
  // prettier-ignore
  test.each([
    ['Sum', ['Function', ['Sum', 'w'], 'w']],
    ['Product', ['Function', ['Product', 'w'], 'w']],
    ['Max', ['Function', ['Max', 'w'], 'w']],
    ['Min', ['Function', ['Min', 'w'], 'w']],
    ['Length', ['Function', ['Length', 'w'], 'w']],
    ['Sum of a product', ['Function', ['Sum', ['Multiply', 'w', 'w']], 'w']],
    ['the first of two parameters', ['Function', ['Add', ['Sum', 'w'], 'u'], 'w', 'u']],
  ])('%s declines, naming the parameter', (_, json) => {
    const d = decline(json);
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(/the parameter w of no declared type/);
  });

  test('a parameter declared a list compiles, with the interpreter value', () => {
    const r = compile(
      ce.box(['Function', ['Sum', 'w'], ['Typed', 'w', "'list<real>'"]]),
      { profile: 'ir', fallback: false }
    );
    expect((r.run as (w: number[]) => number)([3, 1, 2])).toBe(6);
  });

  test('a parameter read as a number still compiles', () => {
    const r = compile(ce.box(['Function', ['Multiply', 2, 'w'], 'w']), {
      profile: 'ir',
      fallback: false,
    });
    expect((r.run as (w: number) => number)(4)).toBe(8);
  });

  test('with the fallback, the value of the interpreter or the existing compiler', () => {
    const r = compile(ce.box(['Function', ['Sum', 'w'], 'w']), {
      profile: 'ir',
    });
    expect(r.profile).toBeUndefined();
  });
});

describe("the removed mode 'auto' takes the existing route", () => {
  const result = (to: string, options: object) => {
    try {
      const r = compile(ce.box(['Sqrt', 'x']), {
        to,
        mode: 'auto',
        ...options,
      } as never);
      return { success: r.success, mode: r.mode, profile: r.profile };
    } catch (e) {
      return {
        code: (e as { diagnostic?: { code: string } }).diagnostic?.code,
      };
    }
  };
  test.each(['javascript', 'glsl', 'interval-js'])(
    '%s: the same result with and without the profile',
    (to) => {
      for (const fallback of [true, false]) {
        const r = result(to, { profile: 'ir', fallback });
        expect([to, fallback, r]).toEqual([
          to,
          fallback,
          result(to, { fallback }),
        ]);
        expect(r).not.toMatchObject({ success: true });
      }
    }
  );
});
