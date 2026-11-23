// The partitions table: one row per statistic, ported from the enumeratio library.
// The Epsil text is the definition and the source of truth. Only
// `scripts/combinatorics/generate.ts` and the tests read this file; it is
// compiled into `../compiled.ts`, so the Epsil text stays out of the runtime
// bundle.

import type { Source } from './source.js';

export const PARTITION_SOURCES: readonly Source[] = [
  {
    head: 'AddableCells',
    findstat: 'St000318',
    summary:
      'Cells that can be added to the diagram and leave a partition: one more than the distinct parts.',
    epsil:
      'p => 1 if Length(p) < 1 else Count(Filter(Range(1, Max(p)), j => Count(Filter(Range(1, Length(p)), i => p[i] == j)) > 0)) + 1',
  },
  {
    head: 'Aft',
    findstat: 'St001214',
    summary:
      'The size minus the larger of the largest part and the number of parts.',
    epsil: 'p => 0 if Length(p) < 1 else Sum(p) - Max(Max(p), Length(p))',
  },
  {
    head: 'AlladiWeight',
    findstat: 'St000477',
    summary:
      'The last part times the product over consecutive parts of the gap less 1.',
    epsil:
      'p => 0 if Length(p) < 1 else p[Length(p)] if Length(p) == 1 else 0 if Count(Filter(Range(1, Length(p) - 1), i => p[i] - p[i + 1] == 1)) > 0 else p[Length(p)] * Product(Map(i => p[i] - p[i + 1] - 1, Range(1, Length(p) - 1)))',
  },
  {
    head: 'ArmOfFirstCell',
    summary: 'The arm of cell (1,1): the first part minus one.',
    epsil: 'p => 0 if Length(p) < 1 else p[1] - 1',
  },
  {
    head: 'BerkovichGarvanRank',
    findstat: 'St001383',
    summary:
      'The sum of a checkerboard filling of the diagram, +1 on cells whose coordinates sum to an even number and -1 on the others.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => (1 if i % 2 == 1 else -1) * (p[i] % 2), Range(1, Length(p))))',
  },
  {
    head: 'BinaryTreeCountWithNoTwinLeavesOfOneColor',
    findstat: 'St001099',
    summary:
      'The rooted binary trees whose leaves are the colored vertices, internal vertices unlabeled, in which no internal vertex has two leaves of one color as its children.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (bt: list<list<integer>>) => Apply( (pl: list<integer>) => Max(Sum(Map(d => pl[d + 1] * (0 if d == 0 else (1 if 2d - 2 == 0 else Product(Range(1, 2d - 2))) / (2 ^ (d - 1) * (1 if d - 1 == 0 else Product(Range(1, d - 1))))), Range(0, Sum(p), 1))), 0), Apply( (a_init: list<integer>) => Fold((a: list<integer>, b) => Apply((a_next: list<integer>) => a_next, Map(d => Max(Sum(Map(j => Max(a[d - j + 1] * bt[b + 1][j + 1] if j <= d else 0, 0), Range(0, b, 1))), 0) - Max(Sum(Map(j => Max(-(a[d - j + 1] * bt[b + 1][j + 1] if j <= d else 0), 0), Range(0, b, 1))), 0), Range(0, Sum(p), 1))), a_init, p), Map(d => 1 if d == 0 else 0, Range(0, Sum(p), 1)), ), ), Apply( (a_init: list<list<integer>>) => Fold( (a: list<list<integer>>, k) => Apply((a_next: list<list<integer>>) => a_next, Join(a, [Map(j => 0 if j == 0 else Max(Sum(Map(m => Max(Binomial(k - 1, m - 1) * (1 if m == 1 else -1 if m == 2 else 0) * a[k - m + 1][j], 0), Range(1, k))), 0) - Max(Sum(Map(m => Max(-(Binomial(k - 1, m - 1) * (1 if m == 1 else -1 if m == 2 else 0) * a[k - m + 1][j]), 0), Range(1, k))), 0), Range(0, Max(p), 1))])), a_init, Range(1, Max(p)), ), [Map(j => 1 if j == 0 else 0, Range(0, Max(p), 1))], ), )',
  },
  {
    head: 'BorderSkewStandardTableauCount',
    findstat: 'St001387',
    summary:
      'Standard tableaux of the skew shape that adds a cell to every column of the diagram: the size factorial over the factorials of the cells added to each row (the size less the largest part, then the gaps between consecutive parts).',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Sum(p) == 0 else Product(Range(1, Sum(p)))) / ((1 if Sum(p) - Max(p) == 0 else Product(Range(1, Sum(p) - Max(p)))) * Product(Map(i => 1 if p[i] - (0 if i == Length(p) else p[i + 1]) == 0 else Product(Range(1, p[i] - (0 if i == Length(p) else p[i + 1]))), Range(1, Length(p)))))',
  },
  {
    head: 'BraceletCount',
    findstat: 'St001603',
    summary:
      'The colorings of a polygon with these color multiplicities, up to rotation and reflection: the necklaces and the colorings fixed by the reflections, over twice the size.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (o: number) => (Apply((g: number) => Sum(Map(d => Count(Filter(Range(1, d), k => k * d / LCM(k, d) == 1)) * (1 if Sum(p) / d == 0 else Product(Range(1, Sum(p) / d))) / Product(Map(i => 1 if p[i] / d == 0 else Product(Range(1, p[i] / d)), Range(1, Length(p)))) if g % d == 0 else 0, Range(1, g))), Fold((a, b) => a * b / LCM(a, b), p[1], Rest(p))) + (0 if o > 2 else Sum(p) * ((1 if (Sum(p) - o) / 2 == 0 else Product(Range(1, (Sum(p) - o) / 2))) / Product(Map(i => 1 if (p[i] - p[i] % 2) / 2 == 0 else Product(Range(1, (p[i] - p[i] % 2) / 2)), Range(1, Length(p))))))) / (2 * Sum(p)), Count(Filter(Range(1, Length(p)), i => p[i] % 2 == 1)), )',
  },
  {
    head: 'BulgarianSolitaireOrbitSize',
    findstat: 'St001914',
    summary:
      'The partitions that Bulgarian solitaire (remove the first column, insert it as a row) visits from this one, itself included.',
    epsil:
      'parts => 1 if Length(parts) < 1 else Apply( (c: list<integer>) => Apply( (p: integer) => Sum(Fold((a, b) => [ Map(j => (a[1][j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a[1]) else 0), Range(1, Sum(parts))), Map(j => (a[2][j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a[2]) else 0), Range(1, Sum(parts))), [a[3][1] + Min(1, Sum(Map(j => Abs(a[1][j] - a[2][j]), Range(1, Sum(parts)))))], ], [ Map(j => Count(Filter(Range(1, Length(parts)), p => parts[p] == j)), Range(1, Sum(parts))), Fold((a, b) => Map(j => (a[j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a) else 0), Range(1, Sum(parts))), Map(j => Count(Filter(Range(1, Length(parts)), p => parts[p] == j)), Range(1, Sum(parts))), Range(1, p, 1)), [0], ], Range(1, Sum(parts) * (Sum(parts) + 1) + 1, 1))[3]), Min(Filter(Range(1, Sum(parts)), l => Sum(Map(j => Abs(Fold((a, b) => Map(j => (a[j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a) else 0), Range(1, Sum(parts))), c, Range(1, l, 1))[j] - c[j]), Range(1, Sum(parts)))) == 0)), ) + Min(Filter(Range(1, Sum(parts)), l => Sum(Map(j => Abs(Fold((a, b) => Map(j => (a[j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a) else 0), Range(1, Sum(parts))), c, Range(1, l, 1))[j] - c[j]), Range(1, Sum(parts)))) == 0)), Fold( (a, b) => Map(j => (a[j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a) else 0), Range(1, Sum(parts))), Map(j => Count(Filter(Range(1, Length(parts)), p => parts[p] == j)), Range(1, Sum(parts))), Range(1, Sum(parts) * (Sum(parts) + 1), 1), ), )',
  },
  {
    head: 'BulgarianSolitairePreimageCount',
    findstat: 'St001913',
    summary:
      'The partitions of the same size that Bulgarian solitaire (remove the first column, insert it as a row) sends to this one: the distinct part sizes of at least the number of parts less one.',
    epsil:
      'p => 1 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => (i == Length(p) || p[i] > p[i + 1]) && p[i] >= Length(p) - 1))',
  },
  {
    head: 'BulgarianSolitairePreperiod',
    findstat: 'St001912',
    summary:
      'The steps of Bulgarian solitaire before this partition reaches the cycle it ends in.',
    epsil:
      'parts => 0 if Length(parts) < 1 else Apply( (c: list<integer>) => Apply( (p: integer) => Sum(Fold((a, b) => [ Map(j => (a[1][j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a[1]) else 0), Range(1, Sum(parts))), Map(j => (a[2][j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a[2]) else 0), Range(1, Sum(parts))), [a[3][1] + Min(1, Sum(Map(j => Abs(a[1][j] - a[2][j]), Range(1, Sum(parts)))))], ], [ Map(j => Count(Filter(Range(1, Length(parts)), p => parts[p] == j)), Range(1, Sum(parts))), Fold((a, b) => Map(j => (a[j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a) else 0), Range(1, Sum(parts))), Map(j => Count(Filter(Range(1, Length(parts)), p => parts[p] == j)), Range(1, Sum(parts))), Range(1, p, 1)), [0], ], Range(1, Sum(parts) * (Sum(parts) + 1) + 1, 1))[3]), Min(Filter(Range(1, Sum(parts)), l => Sum(Map(j => Abs(Fold((a, b) => Map(j => (a[j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a) else 0), Range(1, Sum(parts))), c, Range(1, l, 1))[j] - c[j]), Range(1, Sum(parts)))) == 0)), ), Fold( (a, b) => Map(j => (a[j + 1] if j < Sum(parts) else 0) + (1 if j == Sum(a) else 0), Range(1, Sum(parts))), Map(j => Count(Filter(Range(1, Length(parts)), p => parts[p] == j)), Range(1, Sum(parts))), Range(1, Sum(parts) * (Sum(parts) + 1), 1), ), )',
  },
  {
    head: 'CartanDeterminant',
    findstat: 'St001571',
    summary:
      'The determinant of the matrix of the minimums of the distinct parts: the least distinct part times the gaps between consecutive distinct parts.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => p[i] - (0 if i == Length(p) else p[i + 1]), Filter(Range(1, Length(p)), i => i == Length(p) || p[i] > p[i + 1])))',
  },
  {
    head: 'CellsOutsideDurfeeSquare',
    findstat: 'St001382',
    summary: 'Cells of the diagram outside its Durfee square.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(p) - Count(Filter(Range(1, Length(p)), i => p[i] >= i)) ^ 2',
  },
  {
    head: 'CellsOutsideFirstHook',
    findstat: 'St001175',
    summary:
      'Cells in neither the first row nor the first column: the size minus the hook length of cell (1,1).',
    epsil: 'p => 0 if Length(p) < 1 else Sum(p) - (Max(p) + Length(p) - 1)',
  },
  {
    head: 'CellsOutsideFirstRow',
    findstat: 'St001176',
    summary:
      'Cells of the diagram below the first row: the size minus the largest part.',
    epsil: 'p => 0 if Length(p) < 1 else Sum(p) - Max(p)',
  },
  {
    head: 'CellsOutsideLargestStaircase',
    findstat: 'St001384',
    summary: 'Cells of the diagram outside the largest staircase it contains.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(p) - Min(Map(i => Length(p) if i == Length(p) + 1 else p[i] + (i - 1), Range(1, Length(p) + 1))) * (Min(Map(i => Length(p) if i == Length(p) + 1 else p[i] + (i - 1), Range(1, Length(p) + 1))) + 1) / 2',
  },
  {
    head: 'CellsWithEqualArmAndLeg',
    findstat: 'St001924',
    summary: 'Cells whose arm and leg are equal.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (c: list<integer>) => Sum(Map(i => Count(Filter(Range(1, p[i]), j => p[i] - j - (c[j] - i) == 0)), Range(1, Length(p)))), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), )',
  },
  {
    head: 'CellsWithZeroLegAndOddArm',
    findstat: 'St000149',
    summary: 'Cells with leg 0 and an odd arm.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (c: list<integer>) => Sum(Map(i => Count(Filter(Range(1, p[i]), j => c[j] - i == 0 && (p[i] - j) % 2 == 1)), Range(1, Length(p)))), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), )',
  },
  {
    head: 'CentralizerSize',
    findstat: 'St000184',
    summary:
      'The size of the centralizer of a permutation with these cycle lengths: the product of the parts times the product of the factorials of the multiplicities.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(p) * Product(Map(i => Count(Filter(Range(1, i), j => p[j] == p[i])), Range(1, Length(p))))',
  },
  {
    head: 'CharacterPolynomialConstantTerm',
    findstat: 'St000929',
    summary:
      'The constant term of the character polynomial: 1 for the partition of all ones (the empty one included), 0 otherwise.',
    epsil: 'p => 1 if Length(p) < 1 else 1 if Max(p) == 1 else 0',
  },
  {
    head: 'ChompGrundyValue',
    findstat: 'St000681',
    summary:
      'The Grundy value of Chomp on the diagram: a move cuts a cell and all cells below and right of it, any cell but the first, and the player left with the first cell alone loses.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[Product(rd)], Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply( (a_next: list<integer>) => a_next, Join(a, [Min(Map(k => k if Max(Sum(Map(i => Sum(Map(c => (0 if i == 1 && c == 0 else 1 if a[Max(Sum(Map(j => (Min(dg[w + 1][j], c) if j >= i else dg[w + 1][j]) * pl[j], Range(1, Length(rd)))), 0) + 1] == k else 0) if c < dg[w + 1][i] else 0, Range(0, Sum(p), 1))), Range(1, Length(rd)))), 0) == 0 else Sum(p) + 1, Range(0, Sum(p), 1))) if (1 if Max(Sum(Map(i => (1 if dg[w + 1][i] < dg[w + 1][i + 1] else 0) if i < Length(rd) else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0]), ), a_init, Range(1, Product(rd) - 1)), [0]), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(i => p[i] + 1, Range(1, Length(p))))',
  },
  {
    head: 'CoarseningCount',
    findstat: 'St000346',
    summary:
      'The partitions that coarsen this one, whose parts subdivide to give its. Itself included.',
    epsil:
      'p => 1 if Length(p) < 1 else 1 if Sum(p) < 2 else Apply( (mj: list<integer>) => Apply( (ma: list<integer>) => Fold((a, b) => Apply((fl: list<integer>) => Apply((ways: list<integer>) => Apply( (ap: list<integer>) => Apply( (cm: list<integer>) => Apply((sg: list<integer>) => Apply( (kp: list<integer>) => [Map(g => Apply( (r: integer) => Apply( (c: integer) => cm[(kp[r] - 1) * Sum(p) + c], 1 + (g - 1) % Sum(p), ), 1 + (g - 1 - (g - 1) % Sum(p)) / Sum(p), ), Range(1, Length(kp) * Sum(p))), [1], [a[3][1] + Length(kp)]], Filter(Range(1, Length(ap)), s => Count(Filter(Range(1, Length(ap)), u => u < s && (Sum(Map(k => Abs(cm[(s - 1) * Sum(p) + k] - cm[(u - 1) * Sum(p) + k]), Range(1, Sum(p)))) == 0 if sg[s] == sg[u] else 1 == 0))) == 0), ), Map(s => Sum(Map(k => cm[(s - 1) * Sum(p) + k] * (k * k + 1), Range(1, Sum(p)))), Range(1, Length(ap)))), Map(g => Apply((s: integer) => Apply( (c: integer) => Apply((e: integer) => Apply( (q: integer) => fl[(e - 1) * Sum(p) + c] - (1 if c == mj[q] else 0) - (1 if c == ma[q] else 0) + (1 if c == mj[q] + ma[q] else 0), 1 + (ap[s] - 1) % Length(mj), ), 1 + (ap[s] - 1 - (ap[s] - 1) % Length(mj)) / Length(mj)), 1 + (g - 1) % Sum(p), ), 1 + (g - 1 - (g - 1) % Sum(p)) / Sum(p)), Range(1, Length(ap) * Sum(p))), ), Filter(Range(1, (Length(fl) - Length(fl) % Sum(p)) / Sum(p) * Length(mj)), t => Apply( (e: integer) => Apply( (q: integer) => fl[(e - 1) * Sum(p) + mj[q]] >= 1 + (1 if mj[q] == ma[q] else 0) && fl[(e - 1) * Sum(p) + ma[q]] >= 1 + (1 if mj[q] == ma[q] else 0), 1 + (t - 1) % Length(mj), ), 1 + (t - 1 - (t - 1) % Length(mj)) / Length(mj), )), ), a[2]), a[1]), [Map(k => Count(Filter(Range(1, Length(p)), i => p[i] == k)), Range(1, Sum(p))), [1], [1]], Range(1, Length(p) - 1, 1)), Flatten(Map(pa => Map(pb => pb, Range(pa, Sum(p) - pa)), Range(1, (Sum(p) - Sum(p) % 2) / 2)), 1), ), Flatten(Map(pa => Map(pb => pa, Range(pa, Sum(p) - pa)), Range(1, (Sum(p) - Sum(p) % 2) / 2)), 1), )[3][1]',
  },
  {
    head: 'CohookLengthProduct',
    findstat: 'St001378',
    summary: 'The product of the cohook lengths i + j - 1 of the cells.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => Product(Map(j => i + j - 1, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'ColoredCycleMultisetCount',
    findstat: 'St001612',
    summary:
      'The multisets of cycles on points colored with these multiplicities, points of one color being interchangeable.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (rd: list<integer>) => Apply((pl: list<integer>) => Apply( (dg: list<list<integer>>) => Apply((cu: list<integer>) => Apply( (t: list<integer>) => t[Product(rd)], Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply( (a_next: list<integer>) => a_next, Join(a, [Max(Sum(Map(u => cu[u + 1] * a[w - u + 1] if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(1, w))), 0) / Sum(dg[w + 1])]), ), a_init, Range(1, Product(rd) - 1)), [1]), ), Map(u => 0 if u == 0 else Max(Sum(Map(k => k * ((1 if Sum(dg[u + 1]) / k == 0 else Product(Range(1, Sum(dg[u + 1]) / k))) / Product(Map(i => 1 if dg[u + 1][i] / k == 0 else Product(Range(1, dg[u + 1][i] / k)), Range(1, Length(rd))))) if (1 if Max(Sum(Map(i => dg[u + 1][i] % k, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, Sum(p)))), 0), Range(0, Product(rd) - 1, 1))), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1)), ), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd)))), Map(i => p[i] + 1, Range(1, Length(p))), )',
  },
  {
    head: 'ColoredEndofunctionCount',
    findstat: 'St001610',
    summary:
      'The endofunctions, up to relabeling, on points colored with these multiplicities, points of one color being interchangeable.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (rt: list<integer>) => Apply( (sq: list<integer>) => Apply( (lm: list<integer>) => Apply((cu: list<integer>) => Apply( (t: list<integer>) => t[Product(rd)], Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply((a_next: list<integer>) => a_next, Join(a, [Max(Sum(Map(u => cu[u + 1] * a[w - u + 1] if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(1, w))), 0) / Sum(dg[w + 1])])), a_init, Range(1, Product(rd) - 1)), [1]), ), Map(u => 0 if u == 0 else Max(Sum(Map(k => k * lm[u / k + 1] if (1 if Max(Sum(Map(i => dg[u + 1][i] % k, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, Sum(p)))), 0), Range(0, Product(rd) - 1, 1))), Map(w => 0 if w == 0 else Max(Sum(Map(u => Sum(dg[u + 1]) * rt[3u + 1] * sq[w - u + 1] if (1 if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, w))), 0), Range(0, Product(rd) - 1, 1)), ), Apply((a_init: list<integer>) => Fold( (a: list<integer>, w) => Apply((a_next: list<integer>) => a_next, Join(a, [Max(Sum(Map(u => rt[3u + 1] * a[w - u + 1] if (1 if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, w))), 0)])), a_init, Range(1, Product(rd) - 1), ), [1]), ), Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply( (a_next: list<integer>) => a_next, Apply((rw: integer) => Apply( (cw: integer) => Join(a, [rw, cw, Max(Sum(Map(u => (cw if u == w else a[3u + 2]) * a[3 * (w - u) + 3] if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(1, w))), 0) / Sum(dg[w + 1])]), Max(Sum(Map(k => Sum(dg[w + 1]) / k * (rw if k == 1 else a[3 * (w / k) + 1]) if (1 if Max(Sum(Map(i => dg[w + 1][i] % k, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, Sum(p)))), 0), ), Max(Sum(Map(i => a[3 * (w - pl[i]) + 3] if dg[w + 1][i] >= 1 else 0, Range(1, Length(rd)))), 0)), ), a_init, Range(1, Product(rd) - 1)), [0, 0, 1]), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(i => p[i] + 1, Range(1, Length(p))))',
  },
  {
    head: 'ColoredRootedTreeCount',
    findstat: 'St001608',
    summary:
      'The rooted trees, unordered and unlabeled, on vertices colored with these multiplicities, vertices of one color being interchangeable.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[3 * Product(rd) - 2], Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply( (a_next: list<integer>) => a_next, Apply((rw: integer) => Apply( (cw: integer) => Join(a, [rw, cw, Max(Sum(Map(u => (cw if u == w else a[3u + 2]) * a[3 * (w - u) + 3] if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(1, w))), 0) / Sum(dg[w + 1])]), Max(Sum(Map(k => Sum(dg[w + 1]) / k * (rw if k == 1 else a[3 * (w / k) + 1]) if (1 if Max(Sum(Map(i => dg[w + 1][i] % k, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, Sum(p)))), 0), ), Max(Sum(Map(i => a[3 * (w - pl[i]) + 3] if dg[w + 1][i] >= 1 else 0, Range(1, Length(rd)))), 0)), ), a_init, Range(1, Product(rd) - 1)), [0, 0, 1]), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(i => p[i] + 1, Range(1, Length(p))))',
  },
  {
    head: 'ColoredTreeCount',
    findstat: 'St001609',
    summary:
      'The trees, unrooted and unlabeled, on vertices colored with these multiplicities, vertices of one color being interchangeable.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[3 * (Product(rd) - 1) + 1] - (Max(Sum(Map(a => t[3a + 1] * t[3 * (Product(rd) - 1 - a) + 1], Range(1, Product(rd) - 1))), 0) - (t[3 * ((Product(rd) - 1) / 2) + 1] if (1 if Max(Sum(Map(i => dg[Product(rd) - 1 + 1][i] % 2, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0)) / 2, Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply( (a_next: list<integer>) => a_next, Apply((rw: integer) => Apply( (cw: integer) => Join(a, [rw, cw, Max(Sum(Map(u => (cw if u == w else a[3u + 2]) * a[3 * (w - u) + 3] if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(1, w))), 0) / Sum(dg[w + 1])]), Max(Sum(Map(k => Sum(dg[w + 1]) / k * (rw if k == 1 else a[3 * (w / k) + 1]) if (1 if Max(Sum(Map(i => dg[w + 1][i] % k, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, Sum(p)))), 0), ), Max(Sum(Map(i => a[3 * (w - pl[i]) + 3] if dg[w + 1][i] >= 1 else 0, Range(1, Length(rd)))), 0)), ), a_init, Range(1, Product(rd) - 1)), [0, 0, 1]), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(i => p[i] + 1, Range(1, Length(p))))',
  },
  {
    head: 'CompleteHomogeneousSymmetricFunctionAtOne',
    findstat: 'St001562',
    summary:
      'The complete homogeneous symmetric function indexed by the partition, in as many variables as it has parts, all set to 1: the product of the multiset coefficients of the number of parts and each part.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => 0 if p[i] > Length(p) - 1 + p[i] else (1 if Length(p) - 1 + p[i] == 0 else Product(Range(1, Length(p) - 1 + p[i]))) / ((1 if p[i] == 0 else Product(Range(1, p[i]))) * (1 if Length(p) - 1 + p[i] - p[i] == 0 else Product(Range(1, Length(p) - 1 + p[i] - p[i])))), Range(1, Length(p))))',
  },
  {
    head: 'ConjugateDistinctParts',
    findstat: 'St000159',
    summary: 'Distinct part sizes of the conjugate.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), j => Count(Filter(Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), i => i == j)) > 0))',
  },
  {
    head: 'ConjugateOddParts',
    findstat: 'St000992',
    summary:
      'Odd parts of the conjugate — equivalently, the distinct part sizes of λ.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), i => i % 2 == 1))',
  },
  {
    head: 'ContainingRectangleShortSide',
    findstat: 'St000533',
    summary:
      'The shorter side of the smallest rectangle that contains the diagram: the smaller of the largest part and the number of parts.',
    epsil: 'p => 0 if Length(p) < 1 else Min(Max(p), Length(p))',
  },
  {
    head: 'ContainingSquareSide',
    findstat: 'St000784',
    summary:
      'The side of the smallest square that contains the diagram: the larger of the largest part and the number of parts.',
    epsil: 'p => 0 if Length(p) < 1 else Max(Max(p), Length(p))',
  },
  {
    head: 'ContentSum',
    findstat: 'St000509',
    summary: 'The sum of the contents j - i of the cells.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => p[i] * (p[i] + 1) / 2 - i * p[i], Range(1, Length(p))))',
  },
  {
    head: 'CornerMajorIndex',
    findstat: 'St000770',
    summary:
      'The sum, over the corners, of the step number along the boundary path from the bottom left: (number of parts - i) + the i-th part.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Length(p) - i + p[i] if i == Length(p) || p[i] > p[i + 1] else 0, Range(1, Length(p))))',
  },
  {
    head: 'Corners',
    findstat: 'St000159',
    summary:
      'Corner cells — parts strictly larger than the next part (the last part always counts).',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => i == Length(p) || p[i] > p[i + 1]))',
  },
  {
    head: 'CouplesAreForeverGrundyValue',
    findstat: 'St000752',
    summary:
      'The Grundy value of the game that splits a part above 2 into two parts: the nim-sum of the values of the parts, each the least value missing from the nim-sums over its splits.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (g: list<integer>) => Fold((a, b) => a + b - 2 * Sum(Map(k => 2 ^ k * ((a - a % 2 ^ k) / 2 ^ k % 2) * ((b - b % 2 ^ k) / 2 ^ k % 2), Range(0, Sum(p)))), 0, Map(i => g[p[i]], Range(1, Length(p)))), Fold((a, b) => Map(i => (0 if b < 3 else Apply( (s: list<integer>) => Min(Map(k => k if Sum(Map(m => 1 if m == k else 0, s)) == 0 else b, Range(0, b - 1))), Map(j => a[j] + a[b - j] - 2 * Sum(Map(k => 2 ^ k * ((a[j] - a[j] % 2 ^ k) / 2 ^ k % 2) * ((a[b - j] - a[b - j] % 2 ^ k) / 2 ^ k % 2), Range(0, Sum(p)))), Range(1, b - 1)), )) if i == b else a[i], Range(1, Sum(p))), Map(i => 0, Range(1, Sum(p))), Range(1, Sum(p))), )',
  },
  {
    head: 'Crank',
    findstat: 'St000474',
    summary:
      'The Andrews-Garvan crank: the largest part when λ has no 1s, else (parts larger than the number of 1s) minus (the number of 1s).',
    epsil:
      'p => 0 if Length(p) < 1 else Max(p) if Count(Filter(Range(1, Length(p)), i => p[i] == 1)) == 0 else Count(Filter(Range(1, Length(p)), i => p[i] > Count(Filter(Range(1, Length(p)), i => p[i] == 1)))) - Count(Filter(Range(1, Length(p)), i => p[i] == 1))',
  },
  {
    head: 'CubeRootCount',
    findstat: 'St001364',
    summary:
      'The permutations whose cube is a fixed permutation of this cycle type: the product over part sizes d, with a parts of size d, of the number of ways to take the cube root of each part of size d alone or of three together as a cycle of length 3d.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => Sum(Map(s => (1 if Count(Filter(Range(1, Length(p)), j => p[j] == p[i])) == 0 else Product(Range(1, Count(Filter(Range(1, Length(p)), j => p[j] == p[i]))))) / ((1 if Count(Filter(Range(1, Length(p)), j => p[j] == p[i])) - 3s == 0 else Product(Range(1, Count(Filter(Range(1, Length(p)), j => p[j] == p[i])) - 3s))) * 6 ^ s * (1 if s == 0 else Product(Range(1, s)))) * (2 * p[i] * p[i]) ^ s if p[i] % 3 > 0 || Count(Filter(Range(1, Length(p)), j => p[j] == p[i])) == 3s else 0, Range(0, (Count(Filter(Range(1, Length(p)), j => p[j] == p[i])) - Count(Filter(Range(1, Length(p)), j => p[j] == p[i])) % 3) / 3, 1))) if i == Length(p) || p[i] > p[i + 1] else 1, Range(1, Length(p))))',
  },
  {
    head: 'CubedStandardTableauCount',
    findstat: 'St000901',
    summary: 'The cube of the number of standard tableaux.',
    epsil:
      'p => 1 if Length(p) < 1 else ((1 if Sum(p) == 0 else Product(Range(1, Sum(p)))) / Product(Map(i => Product(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))) ^ 3',
  },
  {
    head: 'CyclicSievingPolynomialDegree',
    findstat: 'St001918',
    summary:
      '(1 - 1/largest part) times the least common multiple of the parts: the degree of the cyclic sieving polynomial of a permutation with these cycle lengths.',
    epsil:
      'p => 0 if Length(p) < 1 else (Max(p) - 1) * Fold((a, b) => LCM(a, b), p[1], Rest(p)) / Max(p)',
  },
  {
    head: 'DesarrangementTableauCount',
    findstat: 'St000506',
    summary:
      'The standard Young tableaux whose first ascent is even, which are the transposes of the tableaux of the conjugate shape with even first descent.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((u: list<integer>) => Apply( (t: list<integer>) => Sum(Map(i => (1 if i % 2 == 1 else -1) * Product(Map(r => Product(Map(s => t[r] - t[s] if r < s && r != i && s != i else 1, Range(1, Length(t)))), Range(1, Length(t)))) * (1 if t[i] == 0 else Product(Range(1, t[i]))) * (Sum(Map(d => (1 if (d + 0) % 2 == 0 else -1) * ((1 if Sum(p) - d == 0 else Product(Range(1, Sum(p) - d))) / (1 if t[i] - (Length(t) - 1) - d == 0 else Product(Range(1, t[i] - (Length(t) - 1) - d)))), Range(0, t[i] - (Length(t) - 1)))) if t[i] - (Length(t) - 1) >= 0 else 0), Range(1, Length(t)))) / Product(Map(j => 1 if j == 0 else Product(Range(1, j)), t)), Map(i => u[i] + (Length(u) - i), Range(1, Length(u))), ), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))))',
  },
  {
    head: 'DiagonalArmSum',
    findstat: 'St000319',
    summary: 'The sum of the arms of the cells on the main diagonal.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => p[i] - i if p[i] >= i else 0, Range(1, Length(p))))',
  },
  {
    head: 'DiagonalHookLengthProduct',
    findstat: 'St000870',
    summary:
      'The product of the hook lengths of the cells on the main diagonal.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (c: list<integer>) => Product(Map(i => p[i] - i + (c[i] - (i - 1)), Filter(Range(1, Length(p)), i => p[i] >= i))), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), )',
  },
  {
    head: 'DiagonalInversionDefect',
    findstat: 'St000377',
    summary: 'Cells whose arm minus leg is neither 0 nor 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (c: list<integer>) => Sum(Map(i => Count(Filter(Range(1, p[i]), j => p[i] - j - (c[j] - i) < 0 || p[i] - j - (c[j] - i) > 1)), Range(1, Length(p)))), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), )',
  },
  {
    head: 'DiagonalInversions',
    findstat: 'St000378',
    summary: 'Cells whose arm minus leg is 0 or 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (c: list<integer>) => Sum(Map(i => Count(Filter(Range(1, p[i]), j => p[i] - j - (c[j] - i) == 0 || p[i] - j - (c[j] - i) == 1)), Range(1, Length(p)))), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), )',
  },
  {
    head: 'DiagramPosetLinearExtensionCount',
    findstat: 'St000063',
    summary:
      "The linear extensions of the poset on the diagram (Speyer's construction for the homogeneous Garnir relations), counted by the splitting of the diagram at its lowest cell on the longest antidiagonal into the rows below and the columns beyond.",
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (t: list<integer>) => t[(Length(p) + 1) * (Max(p) + 1)], Apply((a_init: list<integer>) => Fold((a: list<integer>, q) => Apply( (a_next: list<integer>) => a_next, Apply( (ia: integer) => Apply( (ib: integer) => Join(a, [1 if ia > Length(p) else 1 if p[ia] <= ib else Apply( (rs: integer) => Binomial(rs + p[rs] - (ia + ib) + 1, rs - ia + 1) * a[(Length(p) + 1) * (Max(p) + 1) - ((rs + 1 - 1) * (Max(p) + 1) + ib)] * a[(Length(p) + 1) * (Max(p) + 1) - ((ia - 1) * (Max(p) + 1) + p[rs])], Max(Map(i => ((i + p[i]) * (Length(p) + 1) + i if p[i] > ib else 0) if i >= ia else 0, Range(1, Length(p)))) % (Length(p) + 1), )]), ((Length(p) + 1) * (Max(p) + 1) - 1 - q) % (Max(p) + 1), ), ((Length(p) + 1) * (Max(p) + 1) - 1 - q - ((Length(p) + 1) * (Max(p) + 1) - 1 - q) % (Max(p) + 1)) / (Max(p) + 1) + 1, ), ), a_init, Range(1, (Length(p) + 1) * (Max(p) + 1) - 1)), [1]), )',
  },
  {
    head: 'DistinctEvenParts',
    findstat: 'St001092',
    summary: 'Distinct even part sizes.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Max(p)), k => Count(Filter(Range(1, Length(p)), i => p[i] == k)) > 0 && k % 2 == 0))',
  },
  {
    head: 'DistinctEvenSubsetSums',
    findstat: 'St000547',
    summary: 'Distinct nonzero even sums of sub-multisets of the parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((s: list<integer>) => Count(Filter(s, i => i % 2 == 0)) - 1, Fold((a, b) => Unique(Join(a, Map(i => i + b, a))), [0], p))',
  },
  {
    head: 'DistinctMultiplicities',
    findstat: 'St000897',
    summary: 'How many different multiplicities the part sizes have.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), v => Count(Filter(Range(1, Max(p)), k => Count(Filter(Range(1, Length(p)), i => p[i] == k)) == v)) > 0))',
  },
  {
    head: 'DistinctOddPartsBelowLargestEvenPart',
    findstat: 'St001588',
    summary: 'Distinct odd part sizes smaller than the largest even part.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (e: number) => Count(Filter(Range(1, Max(p)), k => Count(Filter(Range(1, Length(p)), i => p[i] == k)) > 0 && k % 2 == 1 && k < e)), Max(Map(i => p[i] if p[i] % 2 == 0 else 0, Range(1, Length(p)))), )',
  },
  {
    head: 'DistinctOddSubsetSums',
    findstat: 'St000549',
    summary: 'Distinct odd sums of sub-multisets of the parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((s: list<integer>) => Count(Filter(s, i => i % 2 == 1)), Fold((a, b) => Unique(Join(a, Map(i => i + b, a))), [0], p))',
  },
  {
    head: 'DistinctParts',
    findstat: 'St000159',
    summary: 'How many distinct part sizes occur.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Max(p)), j => Count(Filter(Range(1, Length(p)), i => p[i] == j)) > 0))',
  },
  {
    head: 'DistinctPartsEqualToMultiplicity',
    findstat: 'St001940',
    summary: 'Distinct part sizes equal to their multiplicity.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Max(p)), k => Count(Filter(Range(1, Length(p)), i => p[i] == k)) == k))',
  },
  {
    head: 'DistinctRepeatedParts',
    findstat: 'St000257',
    summary: 'Distinct part sizes that occur at least twice.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Max(p)), k => Count(Filter(Range(1, Length(p)), i => p[i] == k)) >= 2))',
  },
  {
    head: 'DistinctSubsetSums',
    findstat: 'St000548',
    summary: 'Distinct sums of non-empty sub-multisets of the parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((s: collection) => Length(s) - 1, Fold((a, b) => Unique(Join(a, Map(i => i + b, a))), [0], p))',
  },
  {
    head: 'DominatedPartitionCount',
    findstat: 'St000321',
    summary:
      'The partitions of the same size that this one dominates (partial sums of the parts at least those of the other), itself included.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (w: list<integer>) => Sum(w), Fold((a, b) => Map(r => Map(c => Sum(Map(d => a[r - c + 1][d], Range(c, Sum(p) + 1, 1))) if c <= r && r - 1 <= Sum(Map(q => p[q] if q <= Length(p) else 0, Range(1, b, 1))) else 0, Range(1, Sum(p) + 1)), Range(1, Sum(p) + 1)), Map(r => Map(c => 1 if r == 1 && c == Sum(p) + 1 else 0, Range(1, Sum(p) + 1)), Range(1, Sum(p) + 1)), Range(1, Sum(p)))[Sum(p) + 1], )',
  },
  {
    head: 'DominoTilingCount',
    findstat: 'St001380',
    summary:
      'The tilings of the diagram by single cells and dominoes, the dominoes of two adjacent cells, whether in a row or a column.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((u: list<integer>) => Apply( (t: list<integer>) => t[1], Apply( (a_init: list<integer>) => Fold((a: list<integer>, r) => Apply( (a_next: list<integer>) => a_next, Apply((c_init: list<integer>) => Fold((c: list<integer>, j) => Apply((c_next: list<integer>) => c_next, Map(m => (c[2m + 2] if 2m + 1 <= 2 ^ u[1] - 1 else 0) + (c[2m + 1] if 2m <= 2 ^ u[1] - 1 else 0) + (((c[2m - 1] if 2 * (m - 1) <= 2 ^ u[1] - 1 else 0) if m % 2 == 1 else 0) if j < u[r] else 0) + ((((c[2 * (m - 2 ^ (u[r] - 1)) + 1] if 2 * (m - 2 ^ (u[r] - 1)) <= 2 ^ u[1] - 1 else 0) if (m - m % 2 ^ (u[r] - 1)) / 2 ^ (u[r] - 1) % 2 == 1 else 0) if j <= u[r + 1] else 0) if r < Length(u) else 0), Range(0, 2 ^ u[1] - 1, 1))), c_init, Range(1, u[r])), a), ), a_init, Range(1, Length(u))), Map(m => 1 if m == 0 else 0, Range(0, 2 ^ u[1] - 1, 1)), ), ), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))) if Max(p) > Length(p) else p)',
  },
  {
    head: 'DurfeeSquare',
    findstat: 'St000183',
    summary:
      'The side of the Durfee square: the largest d with at least d parts of size at least d.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] >= i))',
  },
  {
    head: 'DysonRank',
    findstat: 'St000145',
    summary: 'Largest part minus number of parts.',
    epsil: 'p => 0 if Length(p) < 1 else Max(p) - Length(p)',
  },
  {
    head: 'EdgeOrbitCount',
    findstat: 'St001982',
    summary:
      "Orbits of the complete graph's edges under a permutation with these cycle lengths: the sum of half the parts rounded down, plus the sum of gcd(part, part) over pairs.",
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => (p[i] - p[i] % 2) / 2, Range(1, Length(p)))) + Sum(Map(i => Sum(Map(j => p[i] * p[j] / LCM(p[i], p[j]) if j < i else 0, Range(1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'ElementarySymmetricFunctionAtOne',
    findstat: 'St001561',
    summary:
      'The elementary symmetric function indexed by the partition, in as many variables as it has parts, all set to 1: the product of the binomial coefficients of the number of parts and each part.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => 0 if p[i] > Length(p) else (1 if Length(p) == 0 else Product(Range(1, Length(p)))) / ((1 if p[i] == 0 else Product(Range(1, p[i]))) * (1 if Length(p) - p[i] == 0 else Product(Range(1, Length(p) - p[i])))), Range(1, Length(p))))',
  },
  {
    head: 'EvenOddCrank',
    findstat: 'St000997',
    summary: 'The largest even part minus the number of odd parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => p[i] if p[i] % 2 == 0 else 0, Range(1, Length(p)))) - Count(Filter(Range(1, Length(p)), i => p[i] % 2 == 1))',
  },
  {
    head: 'EvenParts',
    findstat: 'St000142',
    summary: 'Parts that are even.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] % 2 == 0))',
  },
  {
    head: 'ExponensConsonantiae',
    findstat: 'St001128',
    summary:
      'The least common multiple of the parts over their greatest common divisor.',
    epsil:
      'p => 0 if Length(p) < 1 else Fold((a, b) => LCM(a, b), p[1], Rest(p)) / Fold((a, b) => a * b / LCM(a, b), p[1], Rest(p))',
  },
  {
    head: 'FirstRowHookLengthSum',
    findstat: 'St000867',
    summary:
      'The sum of the hook lengths in the first row: the size plus the binomial of the largest part and 2.',
    epsil: 'p => 0 if Length(p) < 1 else Sum(p) + Max(p) * (Max(p) - 1) / 2',
  },
  {
    head: 'FlooredHalfMultiplicitySum',
    findstat: 'St000150',
    summary: 'The sum, over part sizes, of half the multiplicity rounded down.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(k => (Count(Filter(Range(1, Length(p)), i => p[i] == k)) - Count(Filter(Range(1, Length(p)), i => p[i] == k)) % 2) / 2, Range(1, Max(p))))',
  },
  {
    head: 'GiniIndex',
    findstat: 'St001541',
    summary:
      'The size plus 1 choose 2, less the sum over the columns of the column length plus 1 choose 2.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(p) * (Sum(p) + 1) / 2 - Sum(Map(i => i * (i + 1) / 2, Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))))',
  },
  {
    head: 'GreatestCommonDivisorOfParts',
    findstat: 'St000667',
    summary: 'The greatest common divisor of the parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Fold((a, b) => a * b / LCM(a, b), p[1], Rest(p))',
  },
  {
    head: 'HalfLargestEvenPart',
    findstat: 'St001587',
    summary: 'Half the largest even part; 0 if there is none.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => p[i] if p[i] % 2 == 0 else 0, Range(1, Length(p)))) / 2',
  },
  {
    head: 'HalfPerimeter',
    summary:
      'Half the perimeter of the bounding rectangle of the Young diagram: largest part plus number of parts.',
    epsil: 'p => 0 if Length(p) < 1 else p[1] + Length(p)',
  },
  {
    head: 'HalfSumOfEvenParts',
    findstat: 'St001252',
    summary: 'Half the sum of the even parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => p[i] if p[i] % 2 == 0 else 0, Range(1, Length(p)))) / 2',
  },
  {
    head: 'HookLengthOfFirstCell',
    findstat: 'St000459',
    summary:
      'The hook length of cell (1,1): the largest part plus the number of parts, less one.',
    epsil: 'p => 0 if Length(p) < 1 else Max(p) + Length(p) - 1',
  },
  {
    head: 'HookLengthOfLastDiagonalCell',
    findstat: 'St000460',
    summary:
      'The hook length of the last cell on the main diagonal: that of cell (d,d) for Durfee side d.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((c: list<integer>) => Apply( (d: number) => p[d] - d + (c[d] - (d - 1)), Count(Filter(Range(1, Length(p)), i => p[i] >= i)), ), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))))',
  },
  {
    head: 'HookLengthSquareSum',
    findstat: 'St001943',
    summary: 'The sum of the squares of all hook lengths.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (c: list<integer>) => Sum(Map(i => Sum(Map(j => (p[i] - j + (c[j] - i) + 1) ^ 2, Range(1, p[i]))), Range(1, Length(p)))), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), )',
  },
  {
    head: 'HookProduct',
    findstat: 'St000179',
    summary:
      'The product of all hook lengths — the denominator in the hook-length formula.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => Product(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'HurwitzNumber',
    findstat: 'St001763',
    summary:
      "Hurwitz's number for the partition: (n + c - 2)! n^(c-3) times the product of p^p / (p-1)! over its c parts p, n being its size.",
    epsil:
      'p => 0 if Length(p) < 1 else (1 if Sum(p) + (Length(p) - 2) == 0 else Product(Range(1, Sum(p) + (Length(p) - 2)))) * Sum(p) ^ Max(Length(p) - 3, 0) * Product(Map(i => p[i] ^ p[i], Range(1, Length(p)))) / (Sum(p) ^ Max(3 - Length(p), 0) * Product(Map(i => 1 if p[i] - 1 == 0 else Product(Range(1, p[i] - 1)), Range(1, Length(p)))))',
  },
  {
    head: 'IncreasingTreeCountWithNoLeafOfItsParentsColor',
    findstat: 'St001101',
    summary:
      'The increasing trees on the vertices 1 .. n, colored in blocks with these multiplicities, in which no leaf has the color of its parent.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (bt: list<list<integer>>) => Apply( (pl: list<integer>) => Max(Sum(Map(d => pl[d + 1] * (0 if d == 0 else 1 if d - 1 == 0 else Product(Range(1, d - 1))), Range(0, Sum(p), 1))), 0), Apply( (a_init: list<integer>) => Fold((a: list<integer>, b) => Apply((a_next: list<integer>) => a_next, Map(d => Max(Sum(Map(j => Max(a[d - j + 1] * bt[b + 1][j + 1] if j <= d else 0, 0), Range(0, b, 1))), 0) - Max(Sum(Map(j => Max(-(a[d - j + 1] * bt[b + 1][j + 1] if j <= d else 0), 0), Range(0, b, 1))), 0), Range(0, Sum(p), 1))), a_init, p), Map(d => 1 if d == 0 else 0, Range(0, Sum(p), 1)), ), ), Apply( (a_init: list<list<integer>>) => Fold( (a: list<list<integer>>, k) => Apply((a_next: list<list<integer>>) => a_next, Join(a, [Map(j => 0 if j == 0 else Max(Sum(Map(m => Max(Binomial(k - 1, m - 1) * (1 if m % 2 == 1 else -1) * a[k - m + 1][j], 0), Range(1, k))), 0) - Max(Sum(Map(m => Max(-(Binomial(k - 1, m - 1) * (1 if m % 2 == 1 else -1) * a[k - m + 1][j]), 0), Range(1, k))), 0), Range(0, Max(p), 1))])), a_init, Range(1, Max(p)), ), [Map(j => 1 if j == 0 else 0, Range(0, Max(p), 1))], ), )',
  },
  {
    head: 'InterlacingPartitionCount',
    findstat: 'St001814',
    summary:
      'The number of partitions that interlace this one: the product over the parts of the gap to the next part (0 after the last) plus 1.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => p[i] - (0 if i == Length(p) else p[i + 1]) + 1, Range(1, Length(p))))',
  },
  {
    head: 'InvariantGraphCount',
    findstat: 'St000514',
    summary:
      'The simple graphs on the points that a permutation of this cycle type maps to themselves: 2 to the number of edge orbits.',
    epsil:
      'p => 1 if Length(p) < 1 else 2 ^ (Sum(Map(i => (p[i] - p[i] % 2) / 2, Range(1, Length(p)))) + Sum(Map(i => Sum(Map(j => p[i] * p[j] / LCM(p[i], p[j]) if j < i else 0, Range(1, Length(p)))), Range(1, Length(p)))))',
  },
  {
    head: 'InvariantOrientedCycleCount',
    findstat: 'St000510',
    summary:
      'The cyclic permutations that a permutation of this cycle type fixes under conjugation: none unless the parts are all equal to some d, in which case totient(d) d^(m-1) (m-1)! for m parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Max(p)), k => k * Max(p) / LCM(k, Max(p)) == 1)) * Max(p) ^ (Length(p) - 1) * (1 if Length(p) - 1 == 0 else Product(Range(1, Length(p) - 1))) if Max(p) == p[Length(p)] else 0',
  },
  {
    head: 'InvariantSetPartitionCount',
    findstat: 'St000515',
    summary:
      'The set partitions of the points that a permutation of this cycle type maps to themselves.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (ds: list<integer>) => Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[Product(rd)], Apply((a_init: list<integer>) => Fold((a: list<integer>, c) => Apply( (a_next: list<integer>) => a_next, Apply((f: integer) => Join(a, [Max(Sum(Map(u => (Product(Map(i => (0 if dg[u + 1][i] - 1 > dg[c + 1][i] - 1 else (1 if dg[c + 1][i] - 1 == 0 else Product(Range(1, dg[c + 1][i] - 1))) / ((1 if dg[u + 1][i] - 1 == 0 else Product(Range(1, dg[u + 1][i] - 1))) * (1 if dg[c + 1][i] - 1 - (dg[u + 1][i] - 1) == 0 else Product(Range(1, dg[c + 1][i] - 1 - (dg[u + 1][i] - 1)))))) if i == f else 0 if dg[u + 1][i] > dg[c + 1][i] else (1 if dg[c + 1][i] == 0 else Product(Range(1, dg[c + 1][i]))) / ((1 if dg[u + 1][i] == 0 else Product(Range(1, dg[u + 1][i]))) * (1 if dg[c + 1][i] - dg[u + 1][i] == 0 else Product(Range(1, dg[c + 1][i] - dg[u + 1][i])))), Range(1, Length(rd)))) * Max(Sum(Map(k => k ^ (Sum(dg[u + 1]) - 1) if Max(Sum(Map(i => ds[i] % k if dg[u + 1][i] > 0 else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(1, Sum(p)))), 0) * a[c - u + 1] if dg[u + 1][f] >= 1 else 0) if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[c + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(1, c))), 0)]), Min(Map(i => i if dg[c + 1][i] > 0 else Length(rd) + 1, Range(1, Length(rd))))), ), a_init, Range(1, Product(rd) - 1)), [1]), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(d => Sum(Map(j => 1 if p[j] == d else 0, Range(1, Length(p)))) + 1, ds)), Map(i => p[i], Filter(Range(1, Length(p)), i => i == Length(p) || p[i] > p[i + 1])), )',
  },
  {
    head: 'InvariantSubsetCount',
    findstat: 'St000511',
    summary:
      'Subsets of the points left invariant by a permutation with these cycle lengths: each cycle is in or out, 2 to the number of cycles.',
    epsil: 'p => 1 if Length(p) < 1 else 2 ^ Length(p)',
  },
  {
    head: 'InvariantThreeElementSubsetCount',
    findstat: 'St000512',
    summary:
      'Invariant 3-element subsets: three fixed points, a fixed point and a 2-cycle, or a 3-cycle.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == 1)) * (Count(Filter(Range(1, Length(p)), i => p[i] == 1)) - 1) * (Count(Filter(Range(1, Length(p)), i => p[i] == 1)) - 2) / 6 + Count(Filter(Range(1, Length(p)), i => p[i] == 1)) * Count(Filter(Range(1, Length(p)), i => p[i] == 2)) + Count(Filter(Range(1, Length(p)), i => p[i] == 3))',
  },
  {
    head: 'InvariantTwoElementSubsetCount',
    findstat: 'St000513',
    summary:
      'Invariant 2-element subsets: a pair of fixed points or a 2-cycle.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == 1)) * (Count(Filter(Range(1, Length(p)), i => p[i] == 1)) - 1) / 2 + Count(Filter(Range(1, Length(p)), i => p[i] == 2))',
  },
  {
    head: 'InverseByConjugationCount',
    findstat: 'St001710',
    summary:
      'The permutations that a fixed permutation of this cycle type conjugates to their inverse: the square roots of its square, a product over the cycle lengths d of the roots of the cycles of length d.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (m: list<integer>) => Product(Map(d => Sum(Map(s => (1 if m[d] == 0 else Product(Range(1, m[d]))) / ((1 if m[d] - 2s == 0 else Product(Range(1, m[d] - 2s))) * (1 if s == 0 else Product(Range(1, s))) * 2 ^ s) * d ^ s if d % 2 == 1 || m[d] == 2s else 0, Range(0, (m[d] - m[d] % 2) / 2, 1))), Range(1, Max(p)))), Map(d => (Count(Filter(Range(1, Length(p)), i => p[i] == d)) if d % 2 == 1 else 0) + 2 * Count(Filter(Range(1, Length(p)), i => p[i] == 2d)), Range(1, Max(p))), )',
  },
  {
    head: 'IsSelfConjugate',
    findstat: 'St001122',
    summary: '1 when λ equals its conjugate, 0 otherwise.',
    epsil:
      'p => 1 if Length(p) < 1 else 1 if Length(Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))) == Length(p) && Count(Filter(Range(1, Length(p)), i => p[i] == Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[i])) == Length(p) else 0',
  },
  {
    head: 'KrewerasNumber',
    findstat: 'St000517',
    summary:
      'The number of noncrossing set partitions whose block sizes are the parts: the size factorial over the factorial of size + 1 - length and the factorials of the multiplicities.',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Sum(p) == 0 else Product(Range(1, Sum(p)))) / ((1 if Sum(p) + 1 - Length(p) == 0 else Product(Range(1, Sum(p) + 1 - Length(p)))) * Product(Map(i => Count(Filter(Range(1, i), j => p[j] == p[i])), Range(1, Length(p)))))',
  },
  {
    head: 'LagrangeInversionCoefficient',
    findstat: 'St001967',
    summary:
      'The coefficient of the monomial in the compositional-inverse series: n (n + 1) ... (n + length - 2) over the factorials of the multiplicities.',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Length(p) == 1 else Product(Map(k => Sum(p) + k, Range(0, Length(p) - 2)))) / Product(Map(i => Count(Filter(Range(1, i), j => p[j] == p[i])), Range(1, Length(p))))',
  },
  {
    head: 'LargestEvenPart',
    findstat: 'St000995',
    summary: 'The largest even part; 0 if there is none.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => p[i] if p[i] % 2 == 0 else 0, Range(1, Length(p))))',
  },
  {
    head: 'LargestMissingPart',
    findstat: 'St001392',
    summary:
      'The largest integer below the largest part that is not a part; 0 if every smaller integer is.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(k => k if Count(Filter(Range(1, Length(p)), i => p[i] == k)) == 0 else 0, Range(1, Max(p))))',
  },
  {
    head: 'LargestMultiplicity',
    findstat: 'St001933',
    summary: 'The largest multiplicity of a part.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(k => Count(Filter(Range(1, Length(p)), i => p[i] == k)), Range(1, Max(p))))',
  },
  {
    head: 'LargestPart',
    findstat: 'St000147',
    summary: 'The largest part of an integer partition (0 for the empty one).',
    epsil: 'p => 0 if Length(p) == 0 else Max(p)',
  },
  {
    head: 'LargestRepeatedPart',
    findstat: 'St000143',
    summary:
      'The largest part that occurs at least twice; 0 if the parts are distinct.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(k => k if Count(Filter(Range(1, Length(p)), i => p[i] == k)) >= 2 else 0, Range(1, Max(p))))',
  },
  {
    head: 'LargestShiftedPart',
    findstat: 'St000384',
    summary: 'The largest part after adding i - 1 to the i-th part.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => p[i] + (i - 1), Range(1, Length(p))))',
  },
  {
    head: 'LargestStaircaseSide',
    findstat: 'St000783',
    summary:
      'The side of the largest staircase (k, k-1, ..., 1) inside the diagram.',
    epsil:
      'p => 0 if Length(p) < 1 else Min(Map(i => Length(p) if i == Length(p) + 1 else p[i] + (i - 1), Range(1, Length(p) + 1)))',
  },
  {
    head: 'LeafLabeledTreeCountWithNoTwinLeavesOfOneColor',
    findstat: 'St001100',
    summary:
      'The rooted trees whose leaves are the colored vertices, internal vertices unlabeled and with at least two children, in which no internal vertex has only leaves of one color as its children.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (gt: list<integer>) => Apply( (bt: list<list<integer>>) => Apply( (pl: list<integer>) => Max(Sum(Map(d => pl[d + 1] * gt[d + 1], Range(0, Sum(p), 1))), 0), Apply( (a_init: list<integer>) => Fold((a: list<integer>, b) => Apply((a_next: list<integer>) => a_next, Map(d => Max(Sum(Map(j => Max(a[d - j + 1] * bt[b + 1][j + 1] if j <= d else 0, 0), Range(0, b, 1))), 0) - Max(Sum(Map(j => Max(-(a[d - j + 1] * bt[b + 1][j + 1] if j <= d else 0), 0), Range(0, b, 1))), 0), Range(0, Sum(p), 1))), a_init, p), Map(d => 1 if d == 0 else 0, Range(0, Sum(p), 1)), ), ), Apply((a_init: list<list<integer>>) => Fold( (a: list<list<integer>>, k) => Apply((a_next: list<list<integer>>) => a_next, Join(a, [Map(j => 0 if j == 0 else Max(Sum(Map(m => Max(Binomial(k - 1, m - 1) * (1 if m == 1 else -1) * a[k - m + 1][j], 0), Range(1, k))), 0) - Max(Sum(Map(m => Max(-(Binomial(k - 1, m - 1) * (1 if m == 1 else -1) * a[k - m + 1][j]), 0), Range(1, k))), 0), Range(0, Max(p), 1))])), a_init, Range(1, Max(p)), ), [Map(j => 1 if j == 0 else 0, Range(0, Max(p), 1))]), ), Apply((a_init: list<integer>) => Fold((a: list<integer>, n) => Apply( (a_next: list<integer>) => a_next, Join(a, [-1 * n * a[n + 1] + 2 * Max(Sum(Map(k => Binomial(n, k) * a[k + 1] * a[n - k + 2], Range(1, n))), 0)]), ), a_init, Range(1, Sum(p))), [0, 1]), )',
  },
  {
    head: 'LeastCommonMultipleOfParts',
    findstat: 'St000668',
    summary: 'The least common multiple of the parts.',
    epsil:
      'p => 1 if Length(p) < 1 else Fold((a, b) => LCM(a, b), p[1], Rest(p))',
  },
  {
    head: 'LegOfFirstCell',
    summary: 'The leg of cell (1,1): the number of parts minus one.',
    epsil: 'p => 0 if Length(p) < 1 else Length(p) - 1',
  },
  {
    head: 'LehmerCodeMultiplicityPermutationCount',
    findstat: 'St000275',
    summary:
      'The permutations of the size whose Lehmer code takes its values with these multiplicities, the nonzero multiplicities of its values being the parts.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (ds: list<integer>) => Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[Product(rd)], Apply( (a_init: list<integer>) => Fold((a: list<integer>, u) => Apply((a_next: list<integer>) => a_next, Map(w => Sum([a[w + 1], Max(Sum(Map(i => (0 if ds[i] > u + ds[i] - Max(Sum(Map(j => dg[w + 1][j] * ds[j], Range(1, Length(rd)))), 0) else (1 if u + ds[i] - Max(Sum(Map(j => dg[w + 1][j] * ds[j], Range(1, Length(rd)))), 0) == 0 else Product(Range(1, u + ds[i] - Max(Sum(Map(j => dg[w + 1][j] * ds[j], Range(1, Length(rd)))), 0)))) / ((1 if ds[i] == 0 else Product(Range(1, ds[i]))) * (1 if u + ds[i] - Max(Sum(Map(j => dg[w + 1][j] * ds[j], Range(1, Length(rd)))), 0) - ds[i] == 0 else Product(Range(1, u + ds[i] - Max(Sum(Map(j => dg[w + 1][j] * ds[j], Range(1, Length(rd)))), 0) - ds[i]))))) * a[w - pl[i] + 1] if dg[w + 1][i] >= 1 else 0, Range(1, Length(rd)))), 0)]), Range(0, Product(rd) - 1, 1))), a_init, Range(1, Sum(p))), Map(i => 1 if i == 1 else 0, Range(1, Product(rd))), ), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(d => Sum(Map(j => 1 if p[j] == d else 0, Range(1, Length(p)))) + 1, ds)), Map(i => p[i], Filter(Range(1, Length(p)), i => i == Length(p) || p[i] > p[i + 1])), )',
  },
  {
    head: 'LengthCrank',
    findstat: 'St000146',
    summary:
      'The number of parts when λ has no 1s, else (parts larger than the number of 1s) minus (the number of 1s).',
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) if Count(Filter(Range(1, Length(p)), i => p[i] == 1)) == 0 else Count(Filter(Range(1, Length(p)), i => p[i] > Count(Filter(Range(1, Length(p)), i => p[i] == 1)))) - Count(Filter(Range(1, Length(p)), i => p[i] == 1))',
  },
  {
    head: 'LogarithmicDerivativeCoefficient',
    findstat: 'St001968',
    summary:
      'The coefficient of the monomial in the logarithmic derivative of 1 - c_1 x - c_2 x^2/2! - ..., times a factorial: the set partitions with these block sizes, times (length - 1)! for arranging the blocks in a cycle.',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Sum(p) == 0 else Product(Range(1, Sum(p)))) / Product(Map(i => 1 if p[i] == 0 else Product(Range(1, p[i])), Range(1, Length(p)))) * ((1 if Length(p) == 0 else Product(Range(1, Length(p)))) / Product(Map(i => Count(Filter(Range(1, i), j => p[j] == p[i])), Range(1, Length(p))))) / Length(p)',
  },
  {
    head: 'LowerCoverCountInDominanceOrder',
    findstat: 'St000480',
    summary:
      'The partitions of the same size that this one covers in dominance order: the upper covers of its conjugate.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (u: list<integer>) => Sum(Map(i => Count(Filter(Range(1, Length(u)), j => j > i && (i == 1 || u[i - 1] > u[i]) && (j == Length(u) || u[j] > u[j + 1]) && (j == i + 1 || u[i] == u[j]))), Range(1, Length(u)))), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), )',
  },
  {
    head: 'MaximalRectangleHalfPerimeter',
    findstat: 'St000380',
    summary:
      'Half the perimeter of the rectangle inside the diagram that has the greatest perimeter.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => p[i] + i, Range(1, Length(p))))',
  },
  {
    head: 'MaximalRookPlacementCount',
    findstat: 'St001659',
    summary:
      'The ways to place as many non-attacking rooks as possible on the Ferrers board of the diagram.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (r: list<integer>) => r[Max(Map(i => i if r[i] > 0 else 0, Range(1, Length(p) + 1)))], Fold((a, b) => Map(i => a[1] if i == 1 else a[i] + (b - (i - 2)) * a[i - 1], Range(1, Length(p) + 1)), Map(i => 1 if i == 1 else 0, Range(1, Length(p) + 1)), Map(i => p[Length(p) - i + 1], Range(1, Length(p)))), )',
  },
  {
    head: 'MinimalSubpartitionSizeDifference',
    findstat: 'St000835',
    summary:
      'The smallest difference in size between the two halves of a split of the parts into two sub-multisets.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((s: list<integer>) => Min(Map(i => i * 2 - Sum(p), Filter(s, i => i * 2 >= Sum(p)))), Fold((a, b) => Unique(Join(a, Map(i => i + b, a))), [0], p))',
  },
  {
    head: 'MonotoneHurwitzNumber',
    findstat: 'St001934',
    summary:
      'The monotone factorizations of genus zero of a permutation of this cycle type into transpositions: the product of the Catalan numbers C(p - 1) over the parts p.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (c: list<integer>) => Product(Map(i => c[p[i]], Range(1, Length(p)))), Fold((a, b) => Join(a, [Sum(Map(i => a[i] * a[Length(a) - (i - 1)], Range(1, Length(a))))]), [1], Range(1, Max(p))), )',
  },
  {
    head: 'MultinomialOfParts',
    findstat: 'St000048',
    summary:
      'The multinomial coefficient of the size over the parts: the size factorial over the product of the factorials of the parts.',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Sum(p) == 0 else Product(Range(1, Sum(p)))) / Product(Map(i => 1 if p[i] == 0 else Product(Range(1, p[i])), Range(1, Length(p))))',
  },
  {
    head: 'MultipartitionCount',
    findstat: 'St000933',
    summary:
      'Tuples of partitions whose sizes are the parts: the product of the partition numbers of the parts.',
    epsil:
      'parts => 1 if Length(parts) < 1 else Apply( (p: list<integer>) => Product(Map(i => p[parts[i] + 1], Range(1, Length(parts)))), Fold((a, b) => Map(i => Sum(Map(t => a[i - t * b], Range(0, (i - 1 - (i - 1) % b) / b))), Range(1, Max(parts) + 1)), Map(i => 1 if i == 1 else 0, Range(1, Max(parts) + 1)), Range(1, Max(parts))), )',
  },
  {
    head: 'MultiplicityFactorialProduct',
    findstat: 'St000706',
    summary:
      'The product of the factorials of the multiplicities of the parts.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => Count(Filter(Range(1, i), j => p[j] == p[i])), Range(1, Length(p))))',
  },
  {
    head: 'MultiplicityOfLargestPart',
    findstat: 'St000993',
    summary: 'How many parts equal the largest.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Max(p)))',
  },
  {
    head: 'MultiplicityOfSmallestPart',
    findstat: 'St000160',
    summary: 'How many parts equal the smallest.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == p[Length(p)]))',
  },
  {
    head: 'MultisetPartitionCount',
    findstat: 'St001611',
    summary:
      'The multiset partitions of the multiset with these multiplicities: its vector of multiplicities written as an unordered sum of nonzero vectors.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (rd: list<integer>) => Apply((pl: list<integer>) => Apply( (dg: list<list<integer>>) => Apply((cu: list<integer>) => Apply( (t: list<integer>) => t[Product(rd)], Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply( (a_next: list<integer>) => a_next, Join(a, [Max(Sum(Map(u => cu[u + 1] * a[w - u + 1] if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(1, w))), 0) / Sum(dg[w + 1])]), ), a_init, Range(1, Product(rd) - 1)), [1]), ), Map(u => 0 if u == 0 else Max(Sum(Map(k => Sum(dg[u + 1]) / k if (1 if Max(Sum(Map(i => dg[u + 1][i] % k, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, Sum(p)))), 0), Range(0, Product(rd) - 1, 1))), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1)), ), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd)))), Map(i => p[i] + 1, Range(1, Length(p))), )',
  },
  {
    head: 'NecklaceCount',
    findstat: 'St001605',
    summary:
      "The colorings of a cycle with these color multiplicities, up to rotation: the size's divisors d of the greatest common divisor of the parts, each contributing totient(d) multinomials, over the size.",
    epsil:
      'p => 0 if Length(p) < 1 else Apply((g: number) => Sum(Map(d => Count(Filter(Range(1, d), k => k * d / LCM(k, d) == 1)) * (1 if Sum(p) / d == 0 else Product(Range(1, Sum(p) / d))) / Product(Map(i => 1 if p[i] / d == 0 else Product(Range(1, p[i] / d)), Range(1, Length(p)))) if g % d == 0 else 0, Range(1, g))), Fold((a, b) => a * b / LCM(a, b), p[1], Rest(p))) / Sum(p)',
  },
  {
    head: 'NonDominatingSubmultisetCount',
    findstat: 'St001714',
    summary:
      'The distinct sub-multisets of the parts that, read as partitions, do not dominate their own conjugate.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (m: list<integer>) => Apply((r: list<integer>) => Apply( (s: list<integer>) => Max(Sum(Map(t => Min(1, Max(Sum(Map(k => 1 if Max(Sum(Map(i => (1 if r[i] <= (t - 1 - (t - 1) % s[i]) / s[i] % (m[i] + 1) else 0) * p[i] * (1 if Max(Sum(Map(j => 1 if r[j] <= (t - 1 - (t - 1) % s[j]) / s[j] % (m[j] + 1) else 0, Range(1, i))), 0) <= k else 0), Range(1, Length(p)))), 0) < Max(Sum(Map(i => (1 if r[i] <= (t - 1 - (t - 1) % s[i]) / s[i] % (m[i] + 1) else 0) * Min(p[i], k), Range(1, Length(p)))), 0) else 0, Range(1, Sum(p)))), 0)), Range(1, Product(Map(j => m[j] + 1 if r[j] == m[j] else 1, Range(1, Length(p))))))), 0), Map(i => Product(Map(j => m[j] + 1 if p[j] > p[i] && r[j] == m[j] else 1, Range(1, Length(p)))), Range(1, Length(p))), ), Map(i => Count(Filter(Range(1, i), j => p[j] == p[i])), Range(1, Length(p)))), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] == p[i])), Range(1, Length(p))), )',
  },
  {
    head: 'NonnegativeIntegerMatrixCountWithDecreasingColumnSums',
    findstat: 'St000812',
    summary:
      'The matrices of nonnegative integers whose row sums are the parts and whose column sums weakly decrease, with no empty column.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[Product(rd)], Apply( (a_init: list<integer>) => Fold((a: list<integer>, s) => Apply( (a_next: list<integer>) => a_next, Apply((c_init: list<integer>) => Fold( (c: list<integer>, w) => Apply((c_next: list<integer>) => c_next, Join(c, [a[w + 1] + Max(Sum(Map(u => ((c[w - u + 1] if (1 if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0) if 1 == 1 else 0) if Sum(dg[u + 1]) == s else 0, Range(1, w))), 0)])), c_init, Range(1, Product(rd) - 1), ), [a[1]]), ), a_init, Range(1, Sum(p))), Map(i => 1 if i == 1 else 0, Range(1, Product(rd))), ), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(i => p[i] + 1, Range(1, Length(p))))',
  },
  {
    head: 'OddParts',
    findstat: 'St000148',
    summary: 'Parts that are odd.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] % 2 == 1))',
  },
  {
    head: 'OddPartsBelowLargestEvenPart',
    findstat: 'St001586',
    summary: 'Odd parts smaller than the largest even part.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (e: number) => Count(Filter(Range(1, Length(p)), i => p[i] < e && p[i] % 2 == 1)), Max(Map(i => p[i] if p[i] % 2 == 0 else 0, Range(1, Length(p)))), )',
  },
  {
    head: 'OrderedRefinementCount',
    findstat: 'St000935',
    summary:
      'The partitions whose parts cut, in order, into consecutive blocks summing to the parts of this one.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((pre: list<integer>) => Apply( (w: list<integer>) => Sum(w), Fold((a, b) => Map(r => Map(c => Sum(Map(m => a[b - c + 1][m], Range(c, Sum(p)))) if c <= b && Sum(Map(s => 1 if s > b - c && s < b else 0, pre)) == 0 else 0, Range(1, Sum(p))) if r == b + 1 else a[r], Range(1, Sum(p) + 1)), Map(r => Map(c => 1 if r == 1 && c == Sum(p) else 0, Range(1, Sum(p))), Range(1, Sum(p) + 1)), Range(1, Sum(p)))[Sum(p) + 1], ), Map(i => Sum(Map(q => p[q], Range(1, i))), Range(1, Length(p))))',
  },
  {
    head: 'OrderedSetPartitionCountWithDecreasingBlockSums',
    findstat: 'St000810',
    summary:
      'The ways to put the parts, told apart by position, into an ordered list of blocks whose sums weakly decrease.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[Product(rd)], Apply( (a_init: list<integer>) => Fold((a: list<integer>, s) => Apply( (a_next: list<integer>) => a_next, Apply((c_init: list<integer>) => Fold( (c: list<integer>, w) => Apply((c_next: list<integer>) => c_next, Join(c, [a[w + 1] + Max(Sum(Map(u => ((c[w - u + 1] if (1 if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0) if 1 == 1 else 0) if Max(Sum(Map(i => p[i] * dg[u + 1][i], Range(1, Length(p)))), 0) == s else 0, Range(1, w))), 0)])), c_init, Range(1, Product(rd) - 1), ), [a[1]]), ), a_init, Range(1, Sum(p))), Map(i => 1 if i == 1 else 0, Range(1, Product(rd))), ), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(i => 2, Range(1, Length(p))))',
  },
  {
    head: 'PairsOfDistinctParts',
    findstat: 'St000175',
    summary:
      'Pairs of parts that differ in size: the degree of the polynomial counting semistandard tableaux of the stretched shape.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), j => j < i && p[j] > p[i])), Range(1, Length(p))))',
  },
  {
    head: 'PairwiseGreatestCommonDivisorSum',
    findstat: 'St001961',
    summary: 'The sum of the greatest common divisors of all pairs of parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Sum(Map(j => p[i] * p[j] / LCM(p[i], p[j]) if j < i else 0, Range(1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'PairwiseProductSum',
    findstat: 'St000567',
    summary: 'The sum of the products of all pairs of parts.',
    epsil:
      'p => 0 if Length(p) < 1 else (Sum(p) ^ 2 - Sum(Map(i => p[i] ^ 2, Range(1, Length(p))))) / 2',
  },
  {
    head: 'PartCount',
    findstat: 'St000010',
    summary: 'The number of parts.',
    epsil: 'p => Length(p)',
  },
  {
    head: 'PartFactorialProduct',
    findstat: 'St000707',
    summary: 'The product of the factorials of the parts.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => Product(Range(1, p[i])), Range(1, Length(p))))',
  },
  {
    head: 'PartProduct',
    findstat: 'St000708',
    summary: 'The product of the parts.',
    epsil: 'p => 1 if Length(p) < 1 else Product(p)',
  },
  {
    head: 'PartRange',
    findstat: 'St000225',
    summary: 'The largest part minus the smallest.',
    epsil: 'p => 0 if Length(p) < 1 else Max(p) - Min(p)',
  },
  {
    head: 'PartRearrangementCount',
    findstat: 'St000278',
    summary:
      'Distinct rearrangements of the parts, the compositions that sort to this partition: the number of parts factorial over the factorials of the multiplicities.',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Length(p) == 0 else Product(Range(1, Length(p)))) / Product(Map(i => Count(Filter(Range(1, i), j => p[j] == p[i])), Range(1, Length(p))))',
  },
  {
    head: 'PartSquareProduct',
    findstat: 'St001129',
    summary: 'The product of the squares of the parts.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => p[i] ^ 2, Range(1, Length(p))))',
  },
  {
    head: 'PartSquareSum',
    findstat: 'St001127',
    summary: 'The sum of the squares of the parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => p[i] ^ 2, Range(1, Length(p))))',
  },
  {
    head: 'PartitionSize',
    findstat: 'St000228',
    summary: 'The sum of the parts.',
    epsil: 'p => 0 if Length(p) < 1 else Sum(p)',
  },
  {
    head: 'PartsAtLeastTwo',
    findstat: 'St001280',
    summary: 'Parts of size at least 2.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] >= 2))',
  },
  {
    head: 'PartsEqualOne',
    findstat: 'St000475',
    summary: 'Parts equal to 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == 1))',
  },
  {
    head: 'PartsEqualToMultiplicity',
    findstat: 'St001939',
    summary: 'Parts equal to their own multiplicity.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => Count(Filter(Range(1, Length(p)), m => p[m] == p[i])) == p[i]))',
  },
  {
    head: 'PartsEqualToNextPart',
    findstat: 'St001091',
    summary:
      'Parts whose next smaller part has the same size: the number of parts less the distinct parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) - Count(Filter(Range(1, Max(p)), k => Count(Filter(Range(1, Length(p)), i => p[i] == k)) > 0))',
  },
  {
    head: 'PartsEqualTwo',
    findstat: 'St001657',
    summary: 'Parts equal to 2.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == 2))',
  },
  {
    head: 'PartsExceedingOnes',
    findstat: 'St000473',
    summary: 'Parts larger than the number of parts equal to 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] > Count(Filter(Range(1, Length(p)), i => p[i] == 1))))',
  },
  {
    head: 'PartsNotCongruentToOneModuloThree',
    findstat: 'St001251',
    summary: 'Parts that are not congruent to 1 modulo 3.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] % 3 == 0 || p[i] % 3 == 2))',
  },
  {
    head: 'PartsNotCongruentToTwoModuloThree',
    findstat: 'St001247',
    summary: 'Parts that are not congruent to 2 modulo 3.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] % 3 < 2))',
  },
  {
    head: 'PartsNotCongruentToZeroModuloThree',
    findstat: 'St001250',
    summary: 'Parts that are not divisible by 3.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] % 3 > 0))',
  },
  {
    head: 'PlancherelCount',
    findstat: 'St000284',
    summary:
      'The square of the number of standard tableaux: the permutations whose Robinson-Schensted shape is this partition.',
    epsil:
      'p => 1 if Length(p) < 1 else ((1 if Sum(p) == 0 else Product(Range(1, Sum(p)))) / Product(Map(i => Product(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))) ^ 2',
  },
  {
    head: 'PowerSumSymmetricFunctionAtOne',
    findstat: 'St001563',
    summary:
      'The power-sum symmetric function indexed by the partition, in as many variables as it has parts, all set to 1: the number of parts to its own power.',
    epsil: 'p => 1 if Length(p) < 1 else Length(p) ^ Length(p)',
  },
  {
    head: 'ProperColoringSchemeCount',
    findstat: 'St000781',
    summary:
      'The partitions of the number of cells that are the class sizes of a proper coloring of the cells with the fewest colors, no two cells in a row or a column alike.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (m: list<integer>) => Apply((u: list<integer>) => Apply( (w: list<integer>) => Max(Sum(w), 0), Fold((a, b) => Map(r => Map(c => Sum(Map(d => a[r - c + 1][d], Range(c, Sum(p) + 1, 1))) if c <= r && r - 1 <= Sum(Map(q => u[q] if q <= Length(u) else 0, Range(1, b, 1))) else 0, Range(1, Sum(p) + 1)), Range(1, Sum(p) + 1)), Map(r => Map(c => 1 if r == 1 && c == Sum(p) + 1 else 0, Range(1, Sum(p) + 1)), Range(1, Sum(p) + 1)), Range(1, Max(Max(p), Length(p))))[Sum(p) + 1], ), Map(i => m[i + 1] - m[i], Range(1, Max(Max(p), Length(p))))), Map(jj => Min(Map(aa => Min(Map(bb => jj * (aa + bb) + Sum(Map(i => Max(p[i] - bb, 0) if i > aa else 0, Range(1, Length(p)))), Range(0, Max(p), 1))), Range(0, Length(p), 1))), Range(0, Max(Max(p), Length(p)), 1)), )',
  },
  {
    head: 'RefinementCount',
    findstat: 'St000345',
    summary:
      'The partitions that refine this one, whose parts subdivide to give theirs. Itself included.',
    epsil:
      'p => 1 if Length(p) < 1 else 1 if Sum(p) < 2 else Apply((mj: list<integer>) => Apply( (ma: list<integer>) => Fold((a, b) => Apply((fl: list<integer>) => Apply((ways: list<integer>) => Apply( (ap: list<integer>) => Apply( (cm: list<integer>) => Apply((sg: list<integer>) => Apply( (kp: list<integer>) => [Map(g => Apply( (r: integer) => Apply( (c: integer) => cm[(kp[r] - 1) * Sum(p) + c], 1 + (g - 1) % Sum(p), ), 1 + (g - 1 - (g - 1) % Sum(p)) / Sum(p), ), Range(1, Length(kp) * Sum(p))), [1], [a[3][1] + Length(kp)]], Filter(Range(1, Length(ap)), s => Count(Filter(Range(1, Length(ap)), u => u < s && (Sum(Map(k => Abs(cm[(s - 1) * Sum(p) + k] - cm[(u - 1) * Sum(p) + k]), Range(1, Sum(p)))) == 0 if sg[s] == sg[u] else 1 == 0))) == 0), ), Map(s => Sum(Map(k => cm[(s - 1) * Sum(p) + k] * (k * k + 1), Range(1, Sum(p)))), Range(1, Length(ap)))), Map(g => Apply((s: integer) => Apply( (c: integer) => Apply((e: integer) => Apply( (q: integer) => fl[(e - 1) * Sum(p) + c] - (1 if c == mj[q] else 0) + (1 if c == ma[q] else 0) + (1 if c == mj[q] - ma[q] else 0), 1 + (ap[s] - 1) % Length(mj), ), 1 + (ap[s] - 1 - (ap[s] - 1) % Length(mj)) / Length(mj)), 1 + (g - 1) % Sum(p), ), 1 + (g - 1 - (g - 1) % Sum(p)) / Sum(p)), Range(1, Length(ap) * Sum(p))), ), Filter(Range(1, (Length(fl) - Length(fl) % Sum(p)) / Sum(p) * Length(mj)), t => Apply( (e: integer) => Apply( (q: integer) => fl[(e - 1) * Sum(p) + mj[q]] >= 1, 1 + (t - 1) % Length(mj), ), 1 + (t - 1 - (t - 1) % Length(mj)) / Length(mj), )), ), a[2]), a[1]), [Map(k => Count(Filter(Range(1, Length(p)), i => p[i] == k)), Range(1, Sum(p))), [1], [1]], Range(1, Sum(p) - Length(p), 1)), Flatten(Map(pj => Map(pa => pa, Range(1, (pj - pj % 2) / 2)), Range(2, Sum(p))), 1), ), Flatten(Map(pj => Map(pa => pj, Range(1, (pj - pj % 2) / 2)), Range(2, Sum(p))), 1))[3][1]',
  },
  {
    head: 'RemovableHorizontalDominoes',
    findstat: 'St000256',
    summary:
      'Parts from which 2 can be subtracted and leave a partition: rows ending in a removable horizontal domino.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] >= 2 if i == Length(p) else p[i] - 2 >= p[i + 1]))',
  },
  {
    head: 'RimHooksRemovedToThreeCore',
    findstat: 'St000697',
    summary: 'The 3-rim hooks removed to reach the 3-core.',
    epsil:
      'p => 0 if Length(p) < 1 else (Sum(p) - (Sum(Map(r => Count(Filter(Range(1, Length(p)), i => (p[i] + (Length(p) - i)) % 3 == r)) * (r + 3 * (Count(Filter(Range(1, Length(p)), i => (p[i] + (Length(p) - i)) % 3 == r)) - 1) / 2), Range(0, 2))) - Length(p) * (Length(p) - 1) / 2)) / 3',
  },
  {
    head: 'RimHooksRemovedToTwoCore',
    findstat: 'St000698',
    summary:
      "The 2-rim hooks removed to reach the 2-core: the size less the core's, over 2, the core read off the abacus.",
    epsil:
      'p => 0 if Length(p) < 1 else (Sum(p) - (Sum(Map(r => Count(Filter(Range(1, Length(p)), i => (p[i] + (Length(p) - i)) % 2 == r)) * (r + 2 * (Count(Filter(Range(1, Length(p)), i => (p[i] + (Length(p) - i)) % 2 == r)) - 1) / 2), Range(0, 1))) - Length(p) * (Length(p) - 1) / 2)) / 2',
  },
  {
    head: 'RookPlacementCount',
    findstat: 'St000532',
    summary:
      'The rook placements, of any number of rooks, on the Ferrers board of the diagram.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (r: list<integer>) => Sum(r), Fold((a, b) => Map(i => a[1] if i == 1 else a[i] + (b - (i - 2)) * a[i - 1], Range(1, Length(p) + 1)), Map(i => 1 if i == 1 else 0, Range(1, Length(p) + 1)), Map(i => p[Length(p) - i + 1], Range(1, Length(p)))), )',
  },
  {
    head: 'RootedTreeCountWithNoLeafOfItsParentsColor',
    findstat: 'St001098',
    summary:
      'The rooted trees on these colored vertices, told apart by position within a color, in which no leaf has the color of its parent: n^(n-1) trees counted by the formal group law of x exp(-x).',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (bt: list<list<integer>>) => Apply( (pl: list<integer>) => Max(Sum(Map(d => pl[d + 1] * (0 if d == 0 else d ^ (d - 1)), Range(0, Sum(p), 1))), 0), Apply( (a_init: list<integer>) => Fold((a: list<integer>, b) => Apply((a_next: list<integer>) => a_next, Map(d => Max(Sum(Map(j => Max(a[d - j + 1] * bt[b + 1][j + 1] if j <= d else 0, 0), Range(0, b, 1))), 0) - Max(Sum(Map(j => Max(-(a[d - j + 1] * bt[b + 1][j + 1] if j <= d else 0), 0), Range(0, b, 1))), 0), Range(0, Sum(p), 1))), a_init, p), Map(d => 1 if d == 0 else 0, Range(0, Sum(p), 1)), ), ), Apply( (a_init: list<list<integer>>) => Fold( (a: list<list<integer>>, k) => Apply((a_next: list<list<integer>>) => a_next, Join(a, [Map(j => 0 if j == 0 else Max(Sum(Map(m => Max(Binomial(k - 1, m - 1) * m * (1 if m % 2 == 1 else -1) * a[k - m + 1][j], 0), Range(1, k))), 0) - Max(Sum(Map(m => Max(-(Binomial(k - 1, m - 1) * m * (1 if m % 2 == 1 else -1) * a[k - m + 1][j]), 0), Range(1, k))), 0), Range(0, Max(p), 1))])), a_init, Range(1, Max(p)), ), [Map(j => 1 if j == 0 else 0, Range(0, Max(p), 1))], ), )',
  },
  {
    head: 'RowCellPairs',
    findstat: 'St000566',
    summary:
      'Pairs of cells in the same row: the sum over parts of the binomial coefficient of the part and 2.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => p[i] * (p[i] - 1) / 2, Range(1, Length(p))))',
  },
  {
    head: 'RowRemovalGrundyValue',
    findstat: 'St001055',
    summary:
      'The Grundy value of the game that removes cells from the end of a row while the diagram stays a partition: staircase nim, the nim-sum of the differences of consecutive parts at odd positions.',
    epsil:
      'p => 0 if Length(p) < 1 else Fold((a, b) => a + b - 2 * Sum(Map(k => 2 ^ k * ((a - a % 2 ^ k) / 2 ^ k % 2) * ((b - b % 2 ^ k) / 2 ^ k % 2), Range(0, Sum(p)))), 0, Map(i => (p[i] if i == Length(p) else p[i] - p[i + 1]) if i % 2 == 1 else 0, Range(1, Length(p))))',
  },
  {
    head: 'SameLengthSubpartitionCount',
    findstat: 'St001389',
    summary: 'The partitions with as many parts contained in this one.',
    epsil:
      'p => 1 if Length(p) < 1 else Max(Sum(Fold((a, b) => Map(i => Sum(Map(k => a[k], Range(i, Max(p) + 1))) if i >= 2 && i <= b + 1 else 0, Range(1, Max(p) + 1)), Map(i => 1 if i >= 2 else 0, Range(1, Max(p) + 1)), Rest(p))), 0)',
  },
  {
    head: 'SeaweedAlgebraDimension',
    findstat: 'St001262',
    summary:
      'The dimension of the maximal parabolic seaweed algebra: half the sum of the squares of the parts and of the size.',
    epsil:
      'p => 0 if Length(p) < 1 else (Sum(Map(i => p[i] ^ 2, Range(1, Length(p)))) + Sum(p) ^ 2) / 2',
  },
  {
    head: 'SecondAlladiWeight',
    findstat: 'St000478',
    summary:
      'Half the last part (rounded up if odd), times the product over consecutive parts of half the gap less 1 for each even one of the two.',
    epsil:
      'p => 0 if Length(p) < 1 else (p[Length(p)] + 1 - (1 if p[Length(p)] % 2 == 0 else 0)) / 2 if Length(p) == 1 else 0 if Count(Filter(Range(1, Length(p) - 1), i => p[i] - p[i + 1] - (1 if p[i] % 2 == 0 else 0) - (1 if p[i + 1] % 2 == 0 else 0) == 0)) > 0 else (p[Length(p)] + 1 - (1 if p[Length(p)] % 2 == 0 else 0)) / 2 * Product(Map(i => (p[i] - p[i + 1] - (1 if p[i] % 2 == 0 else 0) - (1 if p[i + 1] % 2 == 0 else 0)) / 2, Range(1, Length(p) - 1)))',
  },
  {
    head: 'SelfEvacuatingTableauCount',
    findstat: 'St000618',
    summary:
      'The standard Young tableaux of the shape that evacuation fixes, equivalently its standard domino tableaux.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (t: list<integer>) => (1 if (Sum(p) - Sum(p) % 2) / 2 == 0 else Product(Range(1, (Sum(p) - Sum(p) % 2) / 2))) * Product(Map(i => Product(Map(j => (t[j] - t[i]) / 2 if j < i && (t[j] - t[i]) % 2 == 0 else 1, Range(1, Length(t)))), Range(1, Length(t)))) / Product(Map(j => 1 if (j - j % 2) / 2 == 0 else Product(Range(1, (j - j % 2) / 2)), t)) if Sum(Map(j => (j - j % 2) / 2, t)) - (Count(Filter(t, j => j % 2 == 0)) * (Count(Filter(t, j => j % 2 == 0)) - 1) / 2 + Count(Filter(t, j => j % 2 == 1)) * (Count(Filter(t, j => j % 2 == 1)) - 1) / 2) == (Sum(p) - Sum(p) % 2) / 2 else 0, Map(i => p[i] + (Length(p) - i), Range(1, Length(p))), )',
  },
  {
    head: 'SemistandardTableauCountWithContent',
    findstat: 'St000814',
    summary:
      'The semistandard tableaux of any shape in which the entry i occurs as many times as part i: the symmetric matrices of nonnegative integers with these row sums.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (rd: list<integer>) => Apply((pl: list<integer>) => Apply( (dg: list<list<integer>>) => Apply((cu: list<integer>) => Apply( (t: list<integer>) => t[Product(rd)], Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply( (a_next: list<integer>) => a_next, Join(a, [Max(Sum(Map(u => cu[u + 1] * a[w - u + 1] if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(1, w))), 0) / Sum(dg[w + 1])]), ), a_init, Range(1, Product(rd) - 1)), [1]), ), Map(u => 0 if u == 0 else Max(Sum(Map(k => (Sum(dg[u + 1]) / k if Sum(dg[u / k + 1]) == 1 else (Sum(dg[u + 1]) / k if Max(Sum(Map(i => 1 if dg[u / k + 1][i] > 1 else 0, Range(1, Length(rd)))), 0) == 0 else 0) if Sum(dg[u / k + 1]) == 2 else 0) if (1 if Max(Sum(Map(i => dg[u + 1][i] % k, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, Sum(p)))), 0), Range(0, Product(rd) - 1, 1))), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1)), ), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd)))), Map(i => p[i] + 1, Range(1, Length(p))), )',
  },
  {
    head: 'SemistandardTableauCountWithEntriesUpToFour',
    findstat: 'St000712',
    summary: 'Semistandard tableaux of the shape with entries at most 4.',
    epsil:
      'p => 1 if Length(p) < 1 else 0 if Length(p) > 4 else Product(Map(i => Product(Map(j => 4 + (j - i), Range(1, p[i]))), Range(1, Length(p)))) / Product(Map(i => Product(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'SemistandardTableauCountWithEntriesUpToLength',
    findstat: 'St000704',
    summary:
      'Semistandard tableaux of the shape with entries at most the number of parts.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => Product(Map(j => Length(p) + (j - i), Range(1, p[i]))), Range(1, Length(p)))) / Product(Map(i => Product(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'SemistandardTableauCountWithEntriesUpToSize',
    findstat: 'St000705',
    summary:
      'Semistandard tableaux of the shape with entries at most the size of the partition.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => Product(Map(j => Sum(p) + (j - i), Range(1, p[i]))), Range(1, Length(p)))) / Product(Map(i => Product(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'SemistandardTableauCountWithEntriesUpToThree',
    findstat: 'St000715',
    summary: 'Semistandard tableaux of the shape with entries at most 3.',
    epsil:
      'p => 1 if Length(p) < 1 else 0 if Length(p) > 3 else Product(Map(i => Product(Map(j => 3 + (j - i), Range(1, p[i]))), Range(1, Length(p)))) / Product(Map(i => Product(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'SemistandardTableauCountWithEntriesUpToTwo',
    findstat: 'St000714',
    summary:
      'Semistandard tableaux of the shape with entries at most 2: the product of 2 + j - i over the cells, over the hook product.',
    epsil:
      'p => 1 if Length(p) < 1 else 0 if Length(p) > 2 else Product(Map(i => Product(Map(j => 2 + (j - i), Range(1, p[i]))), Range(1, Length(p)))) / Product(Map(i => Product(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'SemistandardTableauWeightCountWithEntriesUpToLength',
    findstat: 'St001908',
    summary:
      'The distinct weights of the semistandard tableaux of the shape with entries at most the number of parts: the arrangements of the partitions of the size, at most that many parts, that the shape dominates.',
    epsil:
      'parts => 1 if Length(parts) < 1 else Apply( (t: list<list<integer>>) => Max(Sum(Map(r => t[r + 1][Sum(parts) + 1], Range(0, Length(parts), 1))), 0), Apply( (p: list<integer>) => Fold((a, b) => Map(r => Map(s => Max(Sum(Map(k => a[r - k + 1][s - k * (Max(parts) + 1 - b) + 1] * (0 if k > Length(parts) - (r - k) else (1 if Length(parts) - (r - k) == 0 else Product(Range(1, Length(parts) - (r - k)))) / ((1 if k == 0 else Product(Range(1, k))) * (1 if Length(parts) - (r - k) - k == 0 else Product(Range(1, Length(parts) - (r - k) - k))))) * (1 if k == 0 else (1 if s - k * (Max(parts) + 1 - b) + (Max(parts) + 1 - b) <= p[r - k + 1] else 0) if s <= p[r] else 0) if k * (Max(parts) + 1 - b) <= s else 0, Range(0, r, 1))), 0), Range(0, Sum(parts), 1)), Range(0, Length(parts), 1)), Map(r => Map(s => 1 if r == 0 && s == 0 else 0, Range(0, Sum(parts), 1)), Range(0, Length(parts), 1)), Range(1, Max(parts))), Map(i => Sum(Map(j => parts[j], Range(1, i))), Range(1, Length(parts))), ), )',
  },
  {
    head: 'SetPartitionsWithBlockSizesCount',
    findstat: 'St000049',
    summary:
      'The number of set partitions whose block sizes are the parts: the size factorial over the product of the factorials of the parts and of the multiplicities.',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Sum(p) == 0 else Product(Range(1, Sum(p)))) / (Product(Map(i => 1 if p[i] == 0 else Product(Range(1, p[i])), Range(1, Length(p)))) * Product(Map(i => Count(Filter(Range(1, i), j => p[j] == p[i])), Range(1, Length(p)))))',
  },
  {
    head: 'ShiftedStandardTableauCount',
    findstat: 'St001593',
    summary:
      'Standard tableaux of the shifted shape: the multinomial of the parts times, over pairs of parts, the difference over the sum. 0 when two parts are equal.',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Sum(p) == 0 else Product(Range(1, Sum(p)))) * Product(Map(i => Product(Map(j => p[j] - p[i] if j < i else 1, Range(1, Length(p)))), Range(1, Length(p)))) / (Product(Map(i => 1 if p[i] == 0 else Product(Range(1, p[i])), Range(1, Length(p)))) * Product(Map(i => Product(Map(j => p[j] + p[i] if j < i else 1, Range(1, Length(p)))), Range(1, Length(p)))))',
  },
  {
    head: 'ShorterSideRookPlacementCount',
    findstat: 'St000531',
    summary:
      "The ways to place as many non-attacking rooks as the shorter side of the Ferrers board's bounding rectangle has cells, 0 when they do not fit.",
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (r: list<integer>) => r[Min(Length(p), Max(p)) + 1], Fold((a, b) => Map(i => a[1] if i == 1 else a[i] + (b - (i - 2)) * a[i - 1], Range(1, Length(p) + 1)), Map(i => 1 if i == 1 else 0, Range(1, Length(p) + 1)), Map(i => p[Length(p) - i + 1], Range(1, Length(p)))), )',
  },
  {
    head: 'SingletonParts',
    findstat: 'St001484',
    summary: 'Parts that occur exactly once.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Max(p)), k => Count(Filter(Range(1, Length(p)), i => p[i] == k)) == 1))',
  },
  {
    head: 'SingletonRefinementCount',
    findstat: 'St000913',
    summary:
      'The chains of single splits (a part into two) from this partition down to all ones.',
    epsil:
      'p => 1 if Length(p) < 1 else 1 if Sum(p) < 2 else Apply( (pw: list<integer>) => Apply((mj: list<integer>) => Apply( (ma: list<integer>) => Apply((dl: list<integer>) => Apply( (levels: list<list<integer>>) => Sum(levels[2]), Fold((a, b) => Apply((fl: list<integer>) => Apply((ways: list<integer>) => Apply((moves: integer) => Apply( (nc: list<integer>) => Apply((od: list<integer>) => Apply((sc: list<integer>) => Apply( (st: list<integer>) => [Map(r => sc[st[r]], Range(1, Length(st))), Map(r => Sum(Map(o => ways[1 + (od[o] - 1 - (od[o] - 1) % moves) / moves], Range(st[r], Length(nc) if r == Length(st) else st[r + 1] - 1))), Range(1, Length(st)))], Filter(Range(1, Length(nc)), o => sc[1] > 0 if o == 1 else sc[o] > 0 && sc[o - 1] < sc[o]), ), Map(o => nc[od[o]], Range(1, Length(nc)))), Ordering(nc)), Map(t => Apply( (e: integer) => Apply( (q: integer) => fl[e] + dl[q] if (fl[e] - fl[e] % pw[mj[q]]) / pw[mj[q]] % ((Sum(p) - Sum(p) % mj[q]) / mj[q] + 1) >= 1 else 0, 1 + (t - 1) % moves, ), 1 + (t - 1 - (t - 1) % moves) / moves, ), Range(1, Length(fl) * moves)), ), Length(mj)), a[2]), a[1]), [[Sum(Map(i => pw[p[i]], Range(1, Length(p))))], [1]], Range(1, Sum(p) - Length(p), 1)), ), Map(i => pw[ma[i]] + pw[mj[i] - ma[i]] - pw[mj[i]], Range(1, Length(mj)))), Flatten(Map(pj => Map(pa => pa, Range(1, (pj - pj % 2) / 2)), Range(2, Sum(p))), 1), ), Flatten(Map(pj => Map(pa => pj, Range(1, (pj - pj % 2) / 2)), Range(2, Sum(p))), 1)), Fold((a, b) => Join(a, [a[Length(a)] * ((Sum(p) - Sum(p) % b) / b + 1)]), [1], Range(1, Sum(p) - 1, 1)), )',
  },
  {
    head: 'SmallestMissingPart',
    findstat: 'St000759',
    summary: 'The smallest positive integer that is not a part.',
    epsil:
      'p => 1 if Length(p) == 0 else Min(Filter(Range(1, Length(p) + 1), k => Count(Filter(Range(1, Length(p)), i => p[i] == k)) == 0))',
  },
  {
    head: 'SmallestNonRepeatedInteger',
    findstat: 'St001568',
    summary: 'The smallest positive integer that is not a part at least twice.',
    epsil:
      'p => 1 if Length(p) == 0 else Min(Filter(Range(1, Length(p) + 1), k => Count(Filter(Range(1, Length(p)), i => p[i] == k)) < 2))',
  },
  {
    head: 'SmallestOddRestrictionDepth',
    findstat: 'St000749',
    summary:
      'The fewest cells to remove from the diagram so that the partition left has an odd number of standard tableaux: the least d such that the restriction of the irreducible representation to the symmetric group on n - d points has a constituent of odd dimension.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (rd: list<integer>) => Apply((pl: list<integer>) => Apply( (dg: list<list<integer>>) => Min(Map(w => (Sum(p) - Sum(dg[w + 1]) if Max(Sum(Map(k => (Sum(dg[w + 1]) - Sum(dg[w + 1]) % 2 ^ k) / 2 ^ k, Range(1, Sum(p)))), 0) == Max(Sum(Map(i => Sum(Map(c => Max(Sum(Map(k => 1 if (dg[w + 1][i] - c + Max(Sum(Map(r => 1 if dg[w + 1][r] >= c else 0, Range(1, Length(rd)))), 0) - i + 1) % 2 ^ k == 0 else 0, Range(1, Sum(p)))), 0) if c <= dg[w + 1][i] else 0, Range(1, Sum(p)))), Range(1, Length(rd)))), 0) else Sum(p)) if (1 if Max(Sum(Map(i => (1 if dg[w + 1][i] < dg[w + 1][i + 1] else 0) if i < Length(rd) else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else Sum(p), Range(0, Product(rd) - 1, 1))), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1)), ), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd)))), Map(i => p[i] + 1, Range(1, Length(p))), )',
  },
  {
    head: 'SmirnovWordCount',
    findstat: 'St001097',
    summary:
      'The words with each letter used this many times and no letter twice in a row: the Carlitz-Scoville-Vaughan sum over the numbers of runs of each letter, taken as a binomial convolution over the parts.',
    epsil:
      'p => 1 if Length(p) < 1 else Max(Sum(Fold((a, b) => Map(i => Sum(Map(j => (0 if j - 1 > i - 1 else (1 if i - 1 == 0 else Product(Range(1, i - 1))) / ((1 if j - 1 == 0 else Product(Range(1, j - 1))) * (1 if i - 1 - (j - 1) == 0 else Product(Range(1, i - 1 - (j - 1)))))) * a[i - j + 1] * (0 if j == 1 || j - 1 > b else (-1) ^ (b - (j - 1)) * (0 if j - 2 > b - 1 else (1 if b - 1 == 0 else Product(Range(1, b - 1))) / ((1 if j - 2 == 0 else Product(Range(1, j - 2))) * (1 if b - 1 - (j - 2) == 0 else Product(Range(1, b - 1 - (j - 2))))))), Range(1, i))), Range(1, Sum(p) + 1)), Map(i => 1 if i == 1 else 0, Range(1, Sum(p) + 1)), p)), 0)',
  },
  {
    head: 'SquareRemovalGrundyValue',
    findstat: 'St000137',
    summary:
      'The Grundy value of the game that removes a cell or a 2 x 2 square of cells from the diagram, which must stay a partition, the player who cannot move losing.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[Product(rd)], Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply( (a_next: list<integer>) => a_next, Join(a, [Min(Map(k => k if Max(Sum(Map(i => (((1 if a[w - pl[i] + 1] == k else 0) if dg[w + 1][i + 1] < dg[w + 1][i] else 0) if i < Length(rd) else 1 if a[w - pl[i] + 1] == k else 0) if dg[w + 1][i] >= 1 else 0, Range(1, Length(rd)))) + Sum(Map(i => ((((1 if a[w - 2 * pl[i] - 2 * pl[i + 1] + 1] == k else 0) if i + 1 == Length(rd) || (dg[w + 1][i + 2] <= dg[w + 1][i] - 2 if i + 1 < Length(rd) else False) else 0) if dg[w + 1][i] >= 2 else 0) if dg[w + 1][i] == dg[w + 1][i + 1] else 0) if i < Length(rd) else 0, Range(1, Length(rd)))), 0) == 0 else Sum(p) + 1, Range(0, Sum(p), 1))) if (1 if Max(Sum(Map(i => (1 if dg[w + 1][i] < dg[w + 1][i + 1] else 0) if i < Length(rd) else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0]), ), a_init, Range(1, Product(rd) - 1)), [0]), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(i => p[i] + 1, Range(1, Length(p))))',
  },
  {
    head: 'SquareRootCount',
    findstat: 'St000811',
    summary:
      'The permutations whose square is a fixed permutation of this cycle type: a product over the cycle lengths d of the roots of the cycles of length d, which is also the sum of the irreducible character values at that class.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(d => Sum(Map(s => (1 if Count(Filter(Range(1, Length(p)), i => p[i] == d)) == 0 else Product(Range(1, Count(Filter(Range(1, Length(p)), i => p[i] == d))))) / ((1 if Count(Filter(Range(1, Length(p)), i => p[i] == d)) - 2s == 0 else Product(Range(1, Count(Filter(Range(1, Length(p)), i => p[i] == d)) - 2s))) * (1 if s == 0 else Product(Range(1, s))) * 2 ^ s) * d ^ s if d % 2 == 1 || Count(Filter(Range(1, Length(p)), i => p[i] == d)) == 2s else 0, Range(0, (Count(Filter(Range(1, Length(p)), i => p[i] == d)) - Count(Filter(Range(1, Length(p)), i => p[i] == d)) % 2) / 2, 1))), Range(1, Max(p))))',
  },
  {
    head: 'StandardTableauCount',
    findstat: 'St000003',
    summary:
      'The number of standard Young tableaux of the shape: the size factorial over the hook product.',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Sum(p) == 0 else Product(Range(1, Sum(p)))) / Product(Map(i => Product(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'StandardTableauCountWithEvenFirstDescent',
    findstat: 'St000621',
    summary:
      'The standard Young tableaux whose smallest descent, or the size when there is none, is even.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((u: list<integer>) => Apply( (t: list<integer>) => Sum(Map(i => (1 if i % 2 == 1 else -1) * Product(Map(r => Product(Map(s => t[r] - t[s] if r < s && r != i && s != i else 1, Range(1, Length(t)))), Range(1, Length(t)))) * (1 if t[i] == 0 else Product(Range(1, t[i]))) * (Sum(Map(d => (1 if (d + 0) % 2 == 0 else -1) * ((1 if Sum(p) - d == 0 else Product(Range(1, Sum(p) - d))) / (1 if t[i] - (Length(t) - 1) - d == 0 else Product(Range(1, t[i] - (Length(t) - 1) - d)))), Range(0, t[i] - (Length(t) - 1)))) if t[i] - (Length(t) - 1) >= 0 else 0), Range(1, Length(t)))) / Product(Map(j => 1 if j == 0 else Product(Range(1, j)), t)), Map(i => u[i] + (Length(u) - i), Range(1, Length(u))), ), p)',
  },
  {
    head: 'StandardTableauCountWithMajorIndexCongruentToOneModuloSize',
    findstat: 'St001440',
    summary:
      'The standard Young tableaux whose major index leaves remainder 1 on division by the size of the shape (never, when the size is 1).',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((m: number) => Apply( (q: list<integer>) => Sum(Map(i => q[i] if (i - 1 + m) % Sum(p) == 1 else 0, Range(1, Sum(p) * (Sum(p) + 1) / 2 + 1))), Apply((c: list<integer>) => Fold( (a, b) => Map(i => Sum(Map(t => a[i - t * b], Range(0, (i - 1 - (i - 1) % b) / b))), Range(1, Sum(p) * (Sum(p) + 1) / 2 + 1)), Fold((a, b) => Map(i => a[i] - a[i - b] if i > b else a[i], Range(1, Sum(p) * (Sum(p) + 1) / 2 + 1)), Map(i => 1 if i == 1 else 0, Range(1, Sum(p) * (Sum(p) + 1) / 2 + 1)), Range(1, Sum(p))), Flatten(Map(i => Map(j => p[i] - j + (c[j] - i) + 1, Range(1, p[i])), Range(1, Length(p)))), ), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))), ), Sum(Map(i => (i - 1) * p[i], Range(1, Length(p)))))',
  },
  {
    head: 'StandardTableauCountWithMajorIndexDivisibleBySize',
    findstat: 'St001442',
    summary:
      'The standard Young tableaux whose major index is divisible by the size of the shape.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((m: number) => Apply( (q: list<integer>) => Sum(Map(i => q[i] if (i - 1 + m) % Sum(p) == 0 else 0, Range(1, Sum(p) * (Sum(p) + 1) / 2 + 1))), Apply((c: list<integer>) => Fold( (a, b) => Map(i => Sum(Map(t => a[i - t * b], Range(0, (i - 1 - (i - 1) % b) / b))), Range(1, Sum(p) * (Sum(p) + 1) / 2 + 1)), Fold((a, b) => Map(i => a[i] - a[i - b] if i > b else a[i], Range(1, Sum(p) * (Sum(p) + 1) / 2 + 1)), Map(i => 1 if i == 1 else 0, Range(1, Sum(p) * (Sum(p) + 1) / 2 + 1)), Range(1, Sum(p))), Flatten(Map(i => Map(j => p[i] - j + (c[j] - i) + 1, Range(1, p[i])), Range(1, Length(p)))), ), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))), ), Sum(Map(i => (i - 1) * p[i], Range(1, Length(p)))))',
  },
  {
    head: 'StandardTableauCountWithNoConsecutiveEntriesInOneRow',
    findstat: 'St000212',
    summary:
      'The standard Young tableaux of the shape in which no row holds i and i + 1 together.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[Product(rd)], Apply((a_init: list<integer>) => Fold((a: list<integer>, w) => Apply( (a_next: list<integer>) => a_next, Join(a, [Max(Sum(Map(i => Max(Max(Sum(Map(m => Max((1 if m % 2 == 1 else -1) * a[w - m * pl[i] + 1] if m <= dg[w + 1][i] else 0, 0), Range(1, Sum(p)))), 0) - Max(Sum(Map(m => Max(-((1 if m % 2 == 1 else -1) * a[w - m * pl[i] + 1] if m <= dg[w + 1][i] else 0), 0), Range(1, Sum(p)))), 0), 0), Range(1, Length(rd)))), 0) - Max(Sum(Map(i => Max(-(Max(Sum(Map(m => Max((1 if m % 2 == 1 else -1) * a[w - m * pl[i] + 1] if m <= dg[w + 1][i] else 0, 0), Range(1, Sum(p)))), 0) - Max(Sum(Map(m => Max(-((1 if m % 2 == 1 else -1) * a[w - m * pl[i] + 1] if m <= dg[w + 1][i] else 0), 0), Range(1, Sum(p)))), 0)), 0), Range(1, Length(rd)))), 0) if (1 if Max(Sum(Map(i => (1 if dg[w + 1][i] < dg[w + 1][i + 1] else 0) if i < Length(rd) else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0]), ), a_init, Range(1, Product(rd) - 1)), [1]), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(i => p[i] + 1, Range(1, Length(p))))',
  },
  {
    head: 'StandardTableauCountWithOddFirstDescent',
    findstat: 'St000620',
    summary:
      'The standard Young tableaux whose smallest descent, or the size when there is none, is odd.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((u: list<integer>) => Apply( (t: list<integer>) => Sum(Map(i => (1 if i % 2 == 1 else -1) * Product(Map(r => Product(Map(s => t[r] - t[s] if r < s && r != i && s != i else 1, Range(1, Length(t)))), Range(1, Length(t)))) * (1 if t[i] == 0 else Product(Range(1, t[i]))) * (Sum(Map(d => (1 if (d + 1) % 2 == 0 else -1) * ((1 if Sum(p) - d == 0 else Product(Range(1, Sum(p) - d))) / (1 if t[i] - (Length(t) - 1) - d == 0 else Product(Range(1, t[i] - (Length(t) - 1) - d)))), Range(1, t[i] - (Length(t) - 1)))) if t[i] - (Length(t) - 1) >= 1 else 0), Range(1, Length(t)))) / Product(Map(j => 1 if j == 0 else Product(Range(1, j)), t)), Map(i => u[i] + (Length(u) - i), Range(1, Length(u))), ), p)',
  },
  {
    head: 'StarTranspositionFactorizationCount',
    findstat: 'St001936',
    summary:
      'Minimal transitive factorizations of a permutation of this cycle type into star transpositions: the product of the parts times (n + 1) ... (n + length - 2).',
    epsil:
      'p => 1 if Length(p) < 1 else 1 if Length(p) == 1 else Product(p) * (1 if Length(p) == 2 else Product(Range(Sum(p) + 1, Sum(p) + Length(p) - 2)))',
  },
  {
    head: 'SubpartitionCount',
    findstat: 'St000108',
    summary: 'The partitions contained in this one.',
    epsil:
      'p => 1 if Length(p) < 1 else Max(Sum(Fold((a, b) => Map(i => Sum(Map(k => a[k], Range(i, Max(p) + 1))) if i >= 1 && i <= b + 1 else 0, Range(1, Max(p) + 1)), Map(i => 1 if i >= 1 else 0, Range(1, Max(p) + 1)), Rest(p))), 0)',
  },
  {
    head: 'SubsetGreatestCommonDivisorSum',
    findstat: 'St001985',
    summary:
      'The sum, over the non-empty subsets of the parts, of their greatest common divisor: the sum over d of phi(d) times one less than 2 to the number of parts divisible by d.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(d => Count(Filter(Range(1, d), k => k * d / LCM(k, d) == 1)) * (2 ^ Count(Filter(Range(1, Length(p)), i => p[i] % d == 0)) - 1), Range(1, Max(p))))',
  },
  {
    head: 'SumOfEvenParts',
    findstat: 'St001248',
    summary: 'The sum of the even parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => p[i] if p[i] % 2 == 0 else 0, Range(1, Length(p))))',
  },
  {
    head: 'SumOfHookLengths',
    findstat: 'St000869',
    summary: 'The total of all hook lengths.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Sum(Map(j => p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'SumOfOddParts',
    findstat: 'St001249',
    summary: 'The sum of the odd parts.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => p[i] if p[i] % 2 == 1 else 0, Range(1, Length(p))))',
  },
  {
    head: 'SumOfPartsAtLeastTwo',
    findstat: 'St001279',
    summary: 'The sum of the parts that are at least 2.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => p[i] if p[i] >= 2 else 0, Range(1, Length(p))))',
  },
  {
    head: 'SymmetricDiagonalHooks',
    findstat: 'St001525',
    summary: 'Cells on the main diagonal whose arm and leg are equal.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (c: list<integer>) => Count(Filter(Filter(Range(1, Length(p)), i => p[i] >= i), i => p[i] == c[i])), Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p))), )',
  },
  {
    head: 'SymplecticDimensionRankThree',
    findstat: 'St000716',
    summary:
      'The dimension of the irreducible representation of Sp(6) with this highest weight; 0 if the partition has more than 3 parts.',
    epsil:
      'p => 1 if Length(p) < 1 else 0 if Length(p) > 3 else ((p[1] if Length(p) >= 1 else 0) + 3) * ((p[2] if Length(p) >= 2 else 0) + 2) * ((p[3] if Length(p) >= 3 else 0) + 1) * (((p[1] if Length(p) >= 1 else 0) + 3) ^ 2 - ((p[2] if Length(p) >= 2 else 0) + 2) ^ 2) * (((p[1] if Length(p) >= 1 else 0) + 3) ^ 2 - ((p[3] if Length(p) >= 3 else 0) + 1) ^ 2) * (((p[2] if Length(p) >= 2 else 0) + 2) ^ 2 - ((p[3] if Length(p) >= 3 else 0) + 1) ^ 2) / 720',
  },
  {
    head: 'SymplecticDimensionRankTwo',
    findstat: 'St000713',
    summary:
      'The dimension of the irreducible representation of Sp(4) with this highest weight; 0 if the partition has more than 2 parts.',
    epsil:
      'p => 1 if Length(p) < 1 else 0 if Length(p) > 2 else ((p[1] if Length(p) >= 1 else 0) + 2) * ((p[2] if Length(p) >= 2 else 0) + 1) * (((p[1] if Length(p) >= 1 else 0) + 2) ^ 2 - ((p[2] if Length(p) >= 2 else 0) + 1) ^ 2) / 6',
  },
  {
    head: 'TransitiveMonotoneFactorizationCount',
    findstat: 'St001938',
    summary:
      'Transitive monotone factorizations of genus zero of a permutation of this cycle type, into n + length - 2 transpositions.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => Product(Range(p[i] + 1, 2 * p[i])) / (1 if p[i] == 0 else Product(Range(1, p[i]))), Range(1, Length(p)))) * Product(p) * (1 if Length(p) < 4 else Product(Range(2 * Sum(p) + 1, 2 * Sum(p) + Length(p) - 3))) / ((2 * Sum(p) - 1) * 2 * Sum(p) if Length(p) == 1 else 2 * Sum(p) if Length(p) == 2 else 1)',
  },
  {
    head: 'TwelveTimesMajorIndexVarianceOfStandardTableaux',
    findstat: 'St001178',
    summary:
      'Twelve times the variance of the major index over the standard tableaux: the sum of the first n squares, less the sum of the squared hook lengths.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => i ^ 2, Range(1, Sum(p)))) - Sum(Map(i => Sum(Map(j => (p[i] - j + (Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))[j] - i) + 1) ^ 2, Range(1, p[i]))), Range(1, Length(p))))',
  },
  {
    head: 'TwiceMeanMajorIndexOfStandardTableaux',
    findstat: 'St001177',
    summary:
      'Twice the mean major index over the standard tableaux: n choose 2, less the sum of the row lengths choose 2, plus the sum of the column lengths choose 2.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(p) * (Sum(p) - 1) / 2 - Sum(Map(i => i * (i - 1) / 2, p)) + Sum(Map(i => i * (i - 1) / 2, Map(i => Count(Filter(Range(1, Length(p)), j => p[j] >= i)), Range(1, Max(p)))))',
  },
  {
    head: 'UpperCoverCountInDominanceOrder',
    findstat: 'St000481',
    summary:
      'The partitions of the same size that cover this one in dominance order.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((u: list<integer>) => Sum(Map(i => Count(Filter(Range(1, Length(u)), j => j > i && (i == 1 || u[i - 1] > u[i]) && (j == Length(u) || u[j] > u[j + 1]) && (j == i + 1 || u[i] == u[j]))), Range(1, Length(u)))), p)',
  },
  {
    head: 'WordCountWithoutThreeConsecutiveIncreasingLetters',
    findstat: 'St001103',
    summary:
      'The words in which letter i occurs as many times as part i that have no three consecutive letters in increasing order.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply( (rd: list<integer>) => Apply((pl: list<integer>) => Apply( (dg: list<list<integer>>) => Apply((bw: list<integer>) => Apply( (t: list<integer>) => t[Product(rd)], Apply((a_init: list<integer>) => Fold( (a: list<integer>, w) => Apply((a_next: list<integer>) => a_next, Join(a, [Max(Sum(Map(u => bw[u + 1] * a[w - u + 1] if (1 if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0, Range(1, w))), 0)])), a_init, Range(1, Product(rd) - 1), ), [1]), ), Map(u => 0 if u == 0 else (1 if Sum(dg[u + 1]) == 1 else 0 if Sum(dg[u + 1]) == 2 else -1 if (Sum(dg[u + 1]) - 2) % 3 == 1 else 1 if (Sum(dg[u + 1]) - 2) % 3 == 2 else 0) if Max(Sum(Map(i => 1 if dg[u + 1][i] > 1 else 0, Range(1, Length(rd)))), 0) == 0 else 0, Range(0, Product(rd) - 1, 1))), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1)), ), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd)))), Map(i => p[i] + 1, Range(1, Length(p))), )',
  },
  {
    head: 'YoungLatticeCoveringRelationCount',
    findstat: 'St001360',
    summary:
      "The covering relations of Young's lattice among the partitions contained in this one: the sum of their corners.",
    epsil:
      'p => 0 if Length(p) < 1 else Apply( (t: list<list<integer>>) => Max(Sum(t[2]) + Sum(Map(i => t[1][i], Range(2, Max(p) + 1))), 0), Fold((a, b) => [ Map(i => Sum(Map(k => a[1][k], Range(i, Max(p) + 1))) if i >= 1 && i <= b + 1 else 0, Range(1, Max(p) + 1)), Map(i => Sum(Map(k => a[2][k] + (a[1][k] if k > i else 0), Range(i, Max(p) + 1))) if i <= b + 1 else 0, Range(1, Max(p) + 1)), ], [Map(i => 1, Range(1, Max(p) + 1)), Map(i => 0, Range(1, Max(p) + 1))], Rest(p)), )',
  },
  {
    head: 'ZeroOneMatrixCountWithDecreasingColumnSums',
    findstat: 'St000813',
    summary:
      'The matrices of 0 and 1 whose row sums are the parts and whose column sums weakly decrease, with no empty column.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((rd: list<integer>) => Apply( (pl: list<integer>) => Apply((dg: list<list<integer>>) => Apply( (t: list<integer>) => t[Product(rd)], Apply( (a_init: list<integer>) => Fold((a: list<integer>, s) => Apply( (a_next: list<integer>) => a_next, Apply((c_init: list<integer>) => Fold( (c: list<integer>, w) => Apply((c_next: list<integer>) => c_next, Join(c, [a[w + 1] + Max(Sum(Map(u => ((c[w - u + 1] if (1 if Max(Sum(Map(i => 1 if dg[u + 1][i] > dg[w + 1][i] else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0) if (1 if Max(Sum(Map(i => 1 if dg[u + 1][i] > 1 else 0, Range(1, Length(rd)))), 0) == 0 else 0) == 1 else 0) if Sum(dg[u + 1]) == s else 0, Range(1, w))), 0)])), c_init, Range(1, Product(rd) - 1), ), [a[1]]), ), a_init, Range(1, Length(p))), Map(i => 1 if i == 1 else 0, Range(1, Product(rd))), ), ), Map(w => Map(i => (w - w % pl[i]) / pl[i] % rd[i], Range(1, Length(rd))), Range(0, Product(rd) - 1, 1))), Map(i => Product(Map(j => rd[j] if j < i else 1, Range(1, Length(rd)))), Range(1, Length(rd))), ), Map(i => p[i] + 1, Range(1, Length(p))))',
  },
];
