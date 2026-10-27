import type { Expression, ExpressionInput } from './global-types.js';

/** Exact factoring controls. Limits bound work, not elapsed time or memory. */
export interface FactorOptions {
  /** Parse string inputs with strict LaTeX instead of the default lenient grammar. */
  strict?: boolean;
  /** Polynomial variable. Required when a generator is supplied. */
  variable?: string;
  /** A string expression or MathJSON/boxed generator selecting Q(alpha). */
  generator?: ExpressionInput;
  maxOperations?: number;
  /** Largest degree to factor. The conversion of an expression to a
   *  polynomial stops at degree 128, so a larger value does not raise that
   *  limit. */
  maxDegree?: number;
  maxCoefficientBits?: number;
  maxIntermediateCoefficientBits?: number;
  maxNormDegree?: number;
  maxNumberFieldPrimes?: number;
  maxNumberFieldLifts?: number;
  /** Collect exclusive arithmetic-kernel phase timings and operation counts. */
  profile?: boolean;
}

/** Kernel work only; excludes parsing, expression conversion and field setup. */
export interface FactorStatistics {
  operations: number;
  phases?: Record<string, { milliseconds: number; operations: number }>;
  /** Per square-free component; includes the cause preceding a norm fallback. */
  direct?: {
    primeAttempts: number;
    prime?: number;
    residueDegree?: number;
    modularFactors: number;
    lifts: number;
    precisionBits: number;
    boundBits?: number;
    fallback?: string;
    certificate?: string;
    recoveryCandidates?: number;
    recoveryRejections?: number;
    exactDivisions?: number;
  }[];
  norms?: number;
}

interface FactorizationBase {
  /** Product on success; an unevaluated Factor request otherwise. */
  expression: Expression;
  domain: 'QQ' | 'NumberField';
  variable: string;
  generator?: Expression;
  statistics?: FactorStatistics;
}

/**
 * Complete results certify irreducible factors in the selected field.
 * Zero has no irreducible factorization and is reported separately.
 * An unfinished or unsupported request never asserts irreducibility.
 */
export type FactorizationResult = FactorizationBase &
  (
    | {
        status: 'complete' | 'zero';
        coefficient: Expression;
        /** Rational factors are primitive integers; number-field factors are monic. */
        factors: { factor: Expression; multiplicity: number }[];
      }
    | {
        status: 'unsupported' | 'incomplete' | 'invalid';
        reason: string;
        stage: 'field-certification' | 'conversion' | 'factorization';
      }
  );
