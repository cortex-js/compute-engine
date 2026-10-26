import { FinitePcgs } from './polycyclic.js';
import {
  FiniteSubgroup,
  GroupWork,
  GroupInputError,
  GroupLimitError,
} from './finite-group.js';
import {
  PermutationValue,
  PermutationAction,
  applyPermutation,
  composePermutations,
  assertPermutationFits,
} from './permutation/values.js';

/** Refine a supplied descending subnormal series, retaining every requested boundary. */
export function finitePcgsBySeries(
  series: readonly FiniteSubgroup[],
  w: GroupWork
): { pcgs: FinitePcgs; boundaries: readonly number[] } | undefined {
  if (
    !Array.isArray(series) ||
    !series.length ||
    series.length > 257 ||
    !FiniteSubgroup.is(series[0])
  )
    throw new GroupInputError('invalid-pc-subnormal-series');
  const group = series[0].ambient,
    S = group.session(w);
  series.forEach((h) => S.receive(h));
  if (series.at(-1)!.order !== 1)
    throw new GroupInputError('pc-series-must-end-at-identity');
  const sequence: number[] = [],
    boundaries = [1];
  for (let i = 0; i < series.length - 1; i++) {
    const q = S.quotient(series[i], series[i + 1]),
      pc = FinitePcgs.compute(q.group, w);
    if (!pc) return undefined;
    sequence.push(...pc.sequence.map((x) => q.representatives[x]));
    boundaries.push(sequence.length + 1);
  }
  return Object.freeze({
    pcgs: FinitePcgs.fromSequence(group, sequence, w),
    boundaries: Object.freeze(boundaries),
  });
}

/** Verify an action on the whole parent group before using its pcgs to traverse an orbit. */
export function finitePcOrbitStabilizer(
  pc: FinitePcgs,
  images: readonly PermutationValue[],
  action: PermutationAction,
  point: number,
  w: GroupWork
) {
  if (
    !FinitePcgs.is(pc) ||
    !Array.isArray(images) ||
    images.length !== pc.group.order ||
    !PermutationAction.is(action)
  )
    throw new GroupInputError('invalid-pc-action');
  const values = { check: () => w.tick() },
    S = pc.group.session(w);
  let stored = 0;
  for (const image of images) {
    assertPermutationFits(image, action, values);
    stored += image.supportDegree;
    if (stored > 1000000) throw new GroupLimitError('pc-action-storage-limit');
  }
  applyPermutation(images[0], point, action, values);
  if (images[0].supportDegree !== 0)
    throw new GroupInputError('pc-action-identity-is-not-identity');
  const keys = images.map((p) => {
    w.tick(p.supportDegree);
    return p.images.join(',');
  });
  for (let a = 0; a < images.length; a++)
    for (let b = 0; b < images.length; b++) {
      w.tick(Math.max(images[a].supportDegree, images[b].supportDegree));
      const product = composePermutations(images[a], images[b], values);
      if (keys[S.mul(a, b)] !== product.images.join(','))
        throw new GroupInputError('pc-action-is-not-a-homomorphism');
    }
  const points = [point],
    representatives = [0],
    seen = new Set(points);
  for (let i = 0; i < points.length; i++)
    for (const g of pc.sequence) {
      const target = applyPermutation(images[g], points[i], action, values);
      if (seen.has(target)) continue;
      seen.add(target);
      points.push(target);
      representatives.push(S.mul(representatives[i], g));
    }
  const stabilizer = S.generated(
    pc.subgroup.members.filter(
      (x) => applyPermutation(images[x], point, action, values) === point
    )
  );
  const induced = pc.induced(stabilizer, w);
  if (points.length * stabilizer.order !== pc.subgroup.order)
    throw new Error('Certified pc action violates orbit-stabilizer');
  return Object.freeze({
    points: Object.freeze(points),
    representatives: Object.freeze(representatives),
    stabilizer: induced,
  });
}
