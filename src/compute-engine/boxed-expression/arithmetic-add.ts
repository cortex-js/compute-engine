import { getImaginaryFactor } from './utils';

import { flatten } from './flatten';
import { addOrder } from './order';
import { Terms } from './terms';
import { Type } from '../../common/type/types';
import { widen } from '../../common/type/utils';
import { isSubtype } from '../../common/type/subtype';
import { BoxedType } from '../../common/type/boxed-type';
import type { BoxedExpression, ComputeEngine } from '../global-types';
import { isBoxedTensor } from './boxed-tensor';

/**
 *
 * The canonical form of `Add`:
 * - canonicalize the arguments
 * - remove `0`
 * - capture complex numbers (`a + ib` or `ai + b`)
 * - sort the terms
 *
 */
export function canonicalAdd(
  ce: ComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Make canonical, flatten, and lift nested expressions (associative)
  ops = flatten(ops, 'Add');

  // Remove literal 0
  ops = ops.filter((x) => x.numericValue === null || !x.is(0));

  if (ops.length === 0) return ce.Zero;
  if (ops.length === 1 && !ops[0].isIndexedCollection) return ops[0];

  // Iterate over the terms and check if any are complex numbers
  // (a real number followed by an imaginary number)
  const xs: BoxedExpression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.isNumberLiteral) {
      const nv = op.numericValue!;

      if (
        typeof nv === 'number' ||
        (isSubtype(nv.type, 'real') && !nv.isExact) ||
        isSubtype(nv.type, 'integer')
      ) {
        // We have a number such as 4, 3.14, etc. but not 2/3, √2, etc.
        // Check the following term to see if it's an imaginary number

        const next = ops[i + 1];
        if (next) {
          const fac = getImaginaryFactor(next)?.numericValue;
          if (fac !== undefined) {
            const im = typeof fac === 'number' ? fac : fac?.re;
            if (im !== 0) {
              const re = typeof nv === 'number' ? nv : nv.re;
              xs.push(ce.number(ce._numericValue({ re, im: im ?? 0 })));
              i++;
              continue;
            }
          }
        }
      }
    }
    xs.push(op);
  }

  if (xs.length === 1) return xs[0];

  // Commutative: sort
  return ce._fn('Add', [...xs].sort(addOrder));
}

export function addType(
  args: ReadonlyArray<BoxedExpression>
): Type | BoxedType {
  if (args.length === 0) return 'finite_integer'; // = 0
  if (args.length === 1) return args[0].type;
  return widen(...args.map((x) => x.type.type));
}

export function add(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  if (!xs.every((x) => x.isValid)) return xs[0].engine._fn('Add', xs);

  // Check if any operands are tensors
  const hasTensors = xs.some((x) => isBoxedTensor(x));
  if (hasTensors) return addTensors(xs[0].engine, xs);

  return new Terms(xs[0].engine, xs).asExpression();
}

export function addN(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  if (!xs.every((x) => x.isValid)) return xs[0].engine._fn('Add', xs);

  // Check if any operands are tensors
  const hasTensors = xs.some((x) => isBoxedTensor(x));
  if (hasTensors) {
    // Evaluate tensors numerically
    xs = xs.map((x) => (isBoxedTensor(x) ? x.evaluate() : x.N()));
    return addTensors(xs[0].engine, xs);
  }

  // Don't N() the number literals (fractions) to avoid losing precision
  xs = xs.map((x) => (x.isNumberLiteral ? x.evaluate() : x.N()));
  return new Terms(xs[0].engine, xs).N();
}

/**
 * Add tensors element-wise, with scalar broadcasting support.
 * - Tensor + Tensor: element-wise addition (shapes must match)
 * - Scalar + Tensor: broadcast scalar to all elements
 */
function addTensors(
  ce: ComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Separate tensors and scalars
  const tensors: BoxedExpression[] = [];
  const scalars: BoxedExpression[] = [];

  for (const op of ops) {
    const evaluated = op.evaluate();
    if (isBoxedTensor(evaluated)) {
      tensors.push(evaluated);
    } else {
      scalars.push(evaluated);
    }
  }

  // If no tensors after evaluation, fall back to regular addition
  if (tensors.length === 0) {
    return new Terms(ce, scalars).asExpression();
  }

  // Get the reference shape from the first tensor
  const referenceShape = tensors[0].shape;

  // Validate all tensors have the same shape
  for (let i = 1; i < tensors.length; i++) {
    const shape = tensors[i].shape;
    if (
      shape.length !== referenceShape.length ||
      !shape.every((dim, j) => dim === referenceShape[j])
    ) {
      return ce.error(
        'incompatible-dimensions',
        `${referenceShape.join('x')} vs ${shape.join('x')}`
      );
    }
  }

  // Compute scalar sum (to add to each element)
  let scalarSum: BoxedExpression = ce.Zero;
  for (const s of scalars) {
    scalarSum = scalarSum.add(s);
  }

  // For vectors (rank 1)
  if (referenceShape.length === 1) {
    const n = referenceShape[0];
    const result: BoxedExpression[] = [];
    for (let i = 0; i < n; i++) {
      let sum = scalarSum;
      for (const tensor of tensors) {
        // tensor.tensor.at() uses 1-based indexing for vectors
        const val = tensor.tensor.at(i + 1) ?? ce.Zero;
        sum = sum.add(ce.box(val));
      }
      result.push(sum.evaluate());
    }
    return ce.box(['List', ...result]);
  }

  // For matrices (rank 2)
  if (referenceShape.length === 2) {
    const [m, n] = referenceShape;
    const rows: BoxedExpression[] = [];
    for (let i = 0; i < m; i++) {
      const row: BoxedExpression[] = [];
      for (let j = 0; j < n; j++) {
        let sum = scalarSum;
        for (const tensor of tensors) {
          // tensor.tensor.at(row, col) uses 1-based indexing
          const val = tensor.tensor.at(i + 1, j + 1) ?? ce.Zero;
          sum = sum.add(ce.box(val));
        }
        row.push(sum.evaluate());
      }
      rows.push(ce.box(['List', ...row]));
    }
    return ce.box(['List', ...rows]);
  }

  // For higher-rank tensors, return unevaluated for now
  return ce._fn('Add', [...ops]);
}
