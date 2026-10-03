import type { Expression, ExpressionInput } from './types-expression.js';

/** Positive orientation is counterclockwise. */
export type ContourOrientation = 'counterclockwise' | 'clockwise';

/** A closed contour, or a real line completed by a controlled semicircle.
 * Polygon vertices are complex numbers in traversal order. An explicit
 * polygon orientation overrides that order. */
export type Contour =
  | {
      /** The real axis from -infinity to +infinity, closed in a half-plane
       * after the large-arc contribution has been established. */
      kind: 'real-line';
      principalValue?: boolean;
    }
  | {
      kind: 'circle';
      center: ExpressionInput;
      radius: ExpressionInput;
      orientation?: ContourOrientation;
    }
  | {
      kind: 'polygon';
      vertices: readonly ExpressionInput[];
      orientation?: ContourOrientation;
    }
  | {
      kind: 'rectangle';
      lowerLeft: ExpressionInput;
      upperRight: ExpressionInput;
      orientation?: ContourOrientation;
    };

/** Accepted MathJSON forms are CircleContour(center, radius, orientation?),
 * PolygonContour(List(vertices...), orientation?), and
 * RectangleContour(lowerLeft, upperRight, orientation?), and
 * RealLineContour(principalValue?). The orientation is +1 (counterclockwise)
 * or -1 (clockwise); principalValue is True or False. Circle equations
 * Equal(Abs(z - center), radius) are also accepted. */
export type ContourInput = Contour | ExpressionInput;

export type NormalizedContour =
  | {
      kind: 'real-line';
      principalValue: boolean;
      orientation: ContourOrientation;
    }
  | {
      kind: 'circle';
      center: Expression;
      radius: Expression;
      orientation: ContourOrientation;
    }
  | {
      kind: 'polygon';
      vertices: readonly Expression[];
      orientation: ContourOrientation;
    };

export type ContourPole = {
  point: Expression;
  /** Classification of an isolated singularity candidate. Unsupported local
   * analysis leaves it undetermined rather than assuming it is removable. */
  kind: 'pole' | 'essential' | 'removable' | 'undetermined';
  location: 'inside' | 'outside' | 'boundary' | 'undetermined';
  enclosed: boolean | undefined;
  /** Finite pole order; absent for an essential singularity. */
  order?: number;
  residue?: Expression;
};

/** Intermediate results of symbolic contour integration. No partial sum is
 * exposed as an integral: value and residueSum exist only on success.
 * poles includes essential singularities and removable denominator zeros,
 * explicitly marked as such. The pole-on-contour status also covers an
 * essential singularity on the integration path.
 * polesComplete means candidate discovery is complete in poleScope, not that every
 * candidate's order or residue has been determined. */
export type ContourIntegralResult = {
  method: 'residue-theorem';
  status:
    | 'success'
    | 'pole-on-contour'
    | 'invalid-contour'
    | 'unsupported'
    | 'undetermined';
  reason?: string;
  contour?: NormalizedContour;
  polesComplete: boolean;
  /** Global for a complete finite singularity set; contour for a periodic family
   * enumerated over a bounding region containing the contour and its interior.
   * A contour-scoped list can include excluded candidates, but not every
   * exterior pole of the infinite family. Present after complete discovery. */
  poleScope?: 'global' | 'contour';
  poles: readonly ContourPole[];
  /** Sum of enclosed residues. On a real line this additionally includes
   * half of each simple real-axis residue of the exponential kernel. */
  residueSum?: Expression;
  value?: Expression;
  /** Real-line residues belong to the exponential kernel. Cosine/sine
   * integrals project the sum onto its real/imaginary part. In principal-value
   * mode, real-axis simple poles contribute half residues. */
  realIntegral?: {
    closure: 'upper' | 'lower';
    projection: 'none' | 'real' | 'imaginary';
    principalValue: boolean;
    /** Nonzero large-arc limit, subtracted from the residue-theorem result.
     * Present for rational principal values with a 1/z asymptote. */
    largeArcContribution?: Expression;
  };
};
