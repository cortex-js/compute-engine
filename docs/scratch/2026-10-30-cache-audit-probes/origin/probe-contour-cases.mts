const A = ['Add', ['Rational', 1, 2], ['Multiply', ['Divide', ['Sqrt', 3], 2], 'ImaginaryUnit']];
const B = ['Add', 1, ['Sqrt', 2]];
const B_SQUARED = ['Add', 3, ['Multiply', 2, ['Sqrt', 2]]];
const CUBE_PLUS_ONE = ['Add', ['Power', 'x', 3], 1];
const SQUARE_MINUS_B2 = ['Subtract', ['Power', 'x', 2], B_SQUARED];
const PI1 = ['Add', 1, 'Pi'];

export const cases: any[] = [
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
];
