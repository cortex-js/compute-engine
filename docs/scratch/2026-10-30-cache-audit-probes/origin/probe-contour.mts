// Origin cases of the contour memos (symbolic/contour.ts):
// - partsMemo, commit b82b50ef3 (2026-10-08): "a pole is classified, compared
//   with the other poles, and tested for a zero numerator and denominator"
//   — contour integrals with poles at exact algebraic points.
// - zeroMemo, commit f43af0ee1 (2026-10-18): "the series and limit code test
//   the same constant many times" — Residue/Series/Limit at algebraic and
//   transcendental sum points (residue-limit-algebraic-pole.test.ts,
//   batch9-series-residue-subtype.test.ts).
// A new engine per run, because both memos are kept per engine.
import { ComputeEngine } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine.ts';
import { measure } from './harness.mts';

const A = ['Add', ['Rational', 1, 2], ['Multiply', ['Divide', ['Sqrt', 3], 2], 'ImaginaryUnit']];
const B = ['Add', 1, ['Sqrt', 2]];
const B_SQUARED = ['Add', 3, ['Multiply', 2, ['Sqrt', 2]]];
const CUBE_PLUS_ONE = ['Add', ['Power', 'x', 3], 1];
const SQUARE_MINUS_B2 = ['Subtract', ['Power', 'x', 2], B_SQUARED];
const PI1 = ['Add', 1, 'Pi'];

const cases: any[] = [
  ['Residue', ['Divide', 1, CUBE_PLUS_ONE], 'x', A],
  ['Residue', ['Divide', 1, SQUARE_MINUS_B2], 'x', B],
  ['Residue', ['Divide', ['Arctan', 'x'], ['Power', SQUARE_MINUS_B2, 2]], 'x', B],
  ['Residue', ['Divide', ['Ln', 'x'], ['Power', SQUARE_MINUS_B2, 2]], 'x', B],
  ['Residue', ['Divide', ['Gamma', 'x'], ['Subtract', ['Power', 'x', 2], ['Power', PI1, 2]]], 'x', PI1],
  ['Series', ['Divide', 1, ['Subtract', ['Power', 'x', 2], ['Power', PI1, 2]]], 'x', PI1, 3],
  ['Series', ['Divide', 1, SQUARE_MINUS_B2], 'x', B, 3],
  ['Limit', ['Function', ['Divide', ['Subtract', 'x', B], SQUARE_MINUS_B2], 'x'], B],
  ['ContourIntegrate', ['Divide', 1, ['Add', ['Power', 'z', 4], 1]], 'z', ['CircleContour', 0, 2]],
  ['ContourIntegrate', ['Divide', 'z', ['Add', ['Power', 'z', 3], 1]], 'z', ['CircleContour', 0, 2]],
  ['ContourIntegrate', ['Divide', ['Exp', 'z'], ['Add', ['Power', 'z', 2], 2, ['Multiply', 2, 'z']]], 'z', ['CircleContour', 0, 3]],
  // Contours that hold some, not all, of the algebraic poles: each pole is
  // classified (inside or outside) with its exact parts.
  ['ContourIntegrate', ['Divide', 1, ['Add', ['Power', 'z', 6], 1]], 'z', ['CircleContour', ['Rational', 1, 2], 1]],
  ['ContourIntegrate', ['Divide', 1, ['Multiply', ['Add', ['Power', 'z', 2], 2], ['Add', ['Power', 'z', 2], 3]]], 'z', ['CircleContour', ['Complex', 0, 1], 1]],
  ['ContourIntegrate', ['Divide', ['Power', 'z', 2], ['Subtract', ['Power', 'z', 4], 2]], 'z', ['CircleContour', 1, 1]],
  ['ContourIntegrate', ['Divide', ['Exp', 'z'], ['Add', ['Power', 'z', 3], 1]], 'z', ['CircleContour', ['Rational', 1, 2], 1]],
  ['ContourIntegrate', ['Divide', ['Sin', 'z'], ['Multiply', ['Subtract', 'z', B], ['Add', ['Power', 'z', 2], 1]]], 'z', ['CircleContour', 0, 3]],
];

// CONTOUR_SET=integrals: only the five contours that hold some, not all,
// of the algebraic poles (the last five cases).
const set = process.env.CONTOUR_SET ?? 'all';
const selected = set === 'integrals' ? cases.slice(-5) : cases;
await measure(
  `contour-residue-series set=${set}`,
  () => new ComputeEngine(),
  (ce) =>
    selected
      .map((c) => {
        const r = ce.box(c).evaluate();
        const n = r.N();
        return `${r.toString()} ≈ ${n.re?.toPrecision?.(12)},${n.im?.toPrecision?.(12)}`;
      })
      .join('\n')
);
