/**
 * Finite-table pc sequences adapted to subnormal series and permutation actions.
 * Action images cover the whole ambient table and are proved homomorphic on
 * Cayley edges before orbit traversal. Representatives remain ambient elements;
 * the induced stabilizer sequence uses the original parent coordinates.
 */
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
  work: GroupWork
): { pcgs: FinitePcgs; boundaries: readonly number[] } | undefined {
  if (!Array.isArray(series) || !series.length || series.length > 257)
    throw new GroupInputError('invalid-pc-subnormal-series');
  const group = series[0].ambient,
    session = group.session(work);
  series.forEach((h) => session.receive(h));
  if (series.at(-1)!.order !== 1)
    throw new GroupInputError('pc-series-must-end-at-identity');
  const sequence: number[] = [],
    boundaries = [1];
  for (let i = 0; i < series.length - 1; i++) {
    const q = session.quotient(series[i], series[i + 1]),
      pc = FinitePcgs.compute(q.group, work);
    if (!pc) return undefined;
    sequence.push(...pc.sequence.map((x) => q.representatives[x]));
    boundaries.push(sequence.length + 1);
  }
  return {
    pcgs: FinitePcgs.fromSequence(group, sequence, work),
    boundaries,
  };
}

/** Verify an action on the whole parent group before using its pcgs to traverse an orbit. */
export function finitePcOrbitStabilizer(
  pc: FinitePcgs,
  images: readonly PermutationValue[],
  action: PermutationAction,
  point: number,
  work: GroupWork
) {
  if (!Array.isArray(images) || images.length !== pc.group.order)
    throw new GroupInputError('invalid-pc-action');
  const values = { check: () => work.tick() },
    session = pc.group.session(work);
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
    work.tick(p.supportDegree);
    return p.images.join(',');
  });
  // Checking every right Cayley edge extends from the identity to every word.
  // This proves the supplied map is a homomorphism in O(|G| k d), with k
  // compressed generators and permutation degree d, rather than all |G|² pairs.
  for (let a = 0; a < images.length; a++)
    for (const b of session.whole.generators) {
      work.tick(Math.max(images[a].supportDegree, images[b].supportDegree));
      const product = composePermutations(images[a], images[b], values);
      if (keys[session.mul(a, b)] !== product.images.join(','))
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
      representatives.push(session.mul(representatives[i], g));
    }
  const stabilizer = session.generated(
    pc.subgroup.members.filter(
      (x) => applyPermutation(images[x], point, action, values) === point
    )
  );
  const induced = pc.induced(stabilizer, work);
  if (points.length * stabilizer.order !== pc.subgroup.order)
    throw new Error('Certified pc action violates orbit-stabilizer');
  return {
    points,
    representatives,
    stabilizer: induced,
  };
}
