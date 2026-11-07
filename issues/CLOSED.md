# Closed issues

One line per issue the Bug Review Board closed without a fix: reference, date,
the priority it had, kind, impact, probability and witness, the source
reference, what the user saw, the witness program and the reason.
`scripts/issues.mjs close` writes the lines. Search this file before you file an
issue: a match is a decided item, and new evidence is a new issue with
`source-ref: reopens CE-<n>`.
- CE-963 (2026-11-06, was P2; design, confidence, high, corpus; CE-690.1): A numeric integral next to a singular bound reports an error about 6,000 times larger than the error of its quadrature. Witness: `N(Integrate(t ↦ cos(t/2)/√(cos t − cos ½), [0, ½])) reports ± 7.0e-4 (= 2.22/√10⁷); the quadrature error is 1.2e-7`. Closed: user decision 2026-11-06 (a): keep the minimum error for a result next to a singular bound
