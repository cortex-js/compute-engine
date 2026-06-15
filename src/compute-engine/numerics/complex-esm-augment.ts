// Type-only augmentation of the `complex-esm` package.
//
// The shipped complex-esm typings declare `equals(a, b)` with a *required*
// second argument, but at runtime `b` is optional: it forwards to
// `new Complex(a, b)`, which accepts a single `Complex` (or number) argument.
// Add the single-argument overload so `c.equals(other)` type-checks.
//
// This lives in its own module — imported for its declaration side-effect by
// every file that calls `Complex.equals` with a single argument — so the
// augmentation is in scope no matter which bundle entry point pulls the file
// in. (A `declare module` augmentation only applies when its containing file
// is part of the program; keeping it in one shared module avoids both
// duplicate declarations and entry-point-specific gaps.)
export {};

declare module 'complex-esm' {
  interface Complex {
    equals(a: number | Complex): boolean;
  }
}
