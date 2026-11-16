# Documentation example source probes

Worktree: `/tmp/wt-program-accepted-sol`. The source probes ran before writing the corresponding documentation results. They are focused read-only evaluations, not tests, builds or timing measurements. The initial source fingerprints matched before/after (`sourceStable: true`); exact hashes and complete diagnostics are in [raw output](docs-example-checks.json). Later candidate fixes require reprobes for affected examples.

Commands (all exit 0):

```sh
node --import tsx /private/tmp/program-doc-probe.mts
node --import tsx /private/tmp/program-doc-extra-probe.mts
node --import tsx /private/tmp/program-doc-api-probe.mts
```

Additional inline source probes checked `binderSitesOf` with the first Program operand and `checkEpsil` for a later top-level function with console effects. Their exact Epsil input/output is recorded below. Parser shapes omit source metadata; execution values use MathJSON.

The earlier-const default regression is recorded below and reported to the implementation owner: frozen baseline returns 6, this pre-repair candidate returned an unevaluated call with `expected-a-literal-default`. The documentation retains the supported earlier-const behavior; its repaired candidate result is pending. The later-const control failed on both baseline and candidate.

## 1. parse

```epsil
2x + 1
```

```json
{
  "ast": [
    "Program",
    [
      "Add",
      [
        "Multiply",
        2,
        "x"
      ],
      1
    ]
  ],
  "diagnostics": []
}
```

## 2. parse

```epsil
// empty source
```

```json
{
  "ast": [
    "Program"
  ],
  "diagnostics": []
}
```

## 3. parse

```epsil
a
2
```

```json
{
  "ast": [
    "Program",
    "a",
    2
  ],
  "diagnostics": []
}
```

## 4. parse

```epsil
{1,2}
```

```json
{
  "ast": [
    "Program",
    [
      "Set",
      1,
      2
    ]
  ],
  "diagnostics": []
}
```

## 5. parse

```epsil
if a { }
```

```json
{
  "ast": [
    "Program",
    [
      "If",
      "a",
      [
        "Block"
      ]
    ]
  ],
  "diagnostics": []
}
```

## 6. parse

```epsil
if a { if b { 1 } }
```

```json
{
  "ast": [
    "Program",
    [
      "If",
      "a",
      [
        "Block",
        [
          "If",
          "b",
          [
            "Block",
            1
          ]
        ]
      ]
    ]
  ],
  "diagnostics": []
}
```

## 7. parse

```epsil
let y = do { let t = 3; t + 1 }
```

```json
{
  "ast": [
    "Program",
    [
      "Declare",
      "y",
      [
        "Dictionary",
        [
          "KeyValuePair",
          "value",
          [
            "Block",
            [
              "Declare",
              "t",
              [
                "Dictionary",
                [
                  "KeyValuePair",
                  "value",
                  3
                ]
              ]
            ],
            [
              "Add",
              "t",
              1
            ]
          ]
        ]
      ]
    ]
  ],
  "diagnostics": []
}
```

## 8. execute/check

```epsil
let a = 1; a = "x"; a
```

```json
{
  "value": 1,
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "`a` has the type `number`, and the value has the type `string`",
        "a := \"x\"",
        "assignment-type-mismatch"
      ],
      "code": "assignment-type-mismatch",
      "range": [
        11,
        18,
        11
      ]
    }
  ],
  "checkDiagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "`a` has the type `number`, and the value has the type `string`",
        "a := \"x\"",
        "assignment-type-mismatch"
      ],
      "code": "assignment-type-mismatch",
      "range": [
        11,
        18,
        11
      ]
    }
  ],
  "types": {
    "a": "number",
    "x": "unknown",
    "f": "unknown",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 9. execute/check

```epsil
function g(k) scope { t = k + 1; t }; let t = 0; [g(1), t]
```

```json
{
  "value": [
    "List",
    2,
    2
  ],
  "diagnostics": [],
  "checkDiagnostics": [],
  "types": {
    "a": "unknown",
    "x": "unknown",
    "f": "unknown",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 10. execute/check

```epsil
let a = g(3); function g(k) { k^2 }; a
```

```json
{
  "value": 9,
  "diagnostics": [],
  "checkDiagnostics": [],
  "types": {
    "a": "number",
    "x": "unknown",
    "f": "unknown",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 11. execute/check

```epsil
let a = h(1); let h = (x) => x + 1; a
```

```json
{
  "value": "a",
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "`h` is used before the statement that declares it in this block",
        "let a = h(1)",
        "read-before-declaration"
      ],
      "code": "read-before-declaration",
      "range": [
        8,
        9,
        8
      ]
    }
  ],
  "checkDiagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "`h` is used before the statement that declares it in this block",
        "let a = h(1)",
        "read-before-declaration"
      ],
      "code": "read-before-declaration",
      "range": [
        8,
        9,
        8
      ]
    }
  ],
  "types": {
    "a": "unknown",
    "x": "unknown",
    "f": "unknown",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 12. execute/check

```epsil
let f = (n: integer) => n+1; f = (s: string) => s; f("a")
```

```json
{
  "value": "'a'",
  "diagnostics": [],
  "checkDiagnostics": [],
  "types": {
    "a": "unknown",
    "x": "unknown",
    "f": "function",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 13. execute/check

```epsil
let f = (n: integer) => n; f = (s: string) => s; f = (n: integer) => n; f("a")
```

```json
{
  "value": [
    "Error",
    [
      "ErrorCode",
      "'incompatible-type'",
      "'integer'",
      "'string'"
    ],
    "'a'",
    [
      "ErrorTrace",
      [
        "ErrorFrame",
        "'f'",
        1
      ]
    ]
  ],
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "expected `integer`, got `string` at `a`",
        "f(\"a\")",
        "incompatible-type"
      ],
      "code": "incompatible-type",
      "range": [
        74,
        77,
        74
      ],
      "notes": [
        {
          "message": "`f` has signature `(n: integer) -> integer`; argument 1 is `n: integer`"
        },
        {
          "message": "`f` is defined here",
          "range": [
            4,
            5
          ]
        }
      ]
    }
  ],
  "checkDiagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "expected `integer`, got `string` at `a`",
        "f(\"a\")",
        "incompatible-type"
      ],
      "code": "incompatible-type",
      "range": [
        74,
        77,
        74
      ],
      "notes": [
        {
          "message": "`f` has signature `(n: integer) -> integer`; argument 1 is `n: integer`"
        },
        {
          "message": "`f` is defined here",
          "range": [
            4,
            5
          ]
        }
      ]
    }
  ],
  "types": {
    "a": "unknown",
    "x": "unknown",
    "f": "function",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 14. execute/check

```epsil
let n = 0; let bump = () => do { n = n + 1; n }; [bump(), bump(), n]
```

```json
{
  "value": [
    "List",
    1,
    2,
    2
  ],
  "diagnostics": [],
  "checkDiagnostics": [],
  "types": {
    "a": "unknown",
    "x": "unknown",
    "f": "unknown",
    "bump": "function",
    "c": "unknown"
  }
}
```

## 15. execute/check

```epsil
let z = "a"+1; 5
```

```json
{
  "value": 5,
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "expected `number`, got `string` at `a`",
        "\"a\" + 1",
        "incompatible-type"
      ],
      "code": "incompatible-type",
      "range": [
        8,
        11,
        8
      ]
    },
    {
      "severity": "error",
      "message": [
        "runtime-error",
        "expected `number`, got `string` at `a`",
        "in Add argument 1",
        "incompatible-type"
      ],
      "range": [
        8,
        11
      ]
    }
  ],
  "checkDiagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "expected `number`, got `string` at `a`",
        "\"a\" + 1",
        "incompatible-type"
      ],
      "code": "incompatible-type",
      "range": [
        8,
        11,
        8
      ]
    }
  ],
  "types": {
    "a": "unknown",
    "x": "unknown",
    "f": "unknown",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 16. execute/check

```epsil
const c=1; c=2; c
```

```json
{
  "value": 1,
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "cannot assign a value to the constant `c`",
        "c := 2",
        "constant-assignment"
      ],
      "code": "constant-assignment",
      "range": [
        11,
        14,
        11
      ],
      "notes": [
        {
          "message": "`c` is declared constant here",
          "range": [
            0,
            9
          ]
        }
      ]
    }
  ],
  "checkDiagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "cannot assign a value to the constant `c`",
        "c := 2",
        "constant-assignment"
      ],
      "code": "constant-assignment",
      "range": [
        11,
        14,
        11
      ],
      "notes": [
        {
          "message": "`c` is declared constant here",
          "range": [
            0,
            9
          ]
        }
      ]
    }
  ],
  "types": {
    "a": "unknown",
    "x": "unknown",
    "f": "unknown",
    "bump": "unknown",
    "c": "integer"
  }
}
```

## 17. execute/check

```epsil
let x=1; let x=2; x
```

```json
{
  "value": 1,
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "variable redeclaration: x",
        "let x = 2",
        "variable-redeclaration"
      ],
      "code": "variable-redeclaration",
      "range": [
        9,
        16,
        9
      ]
    }
  ],
  "checkDiagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "variable redeclaration: x",
        "let x = 2",
        "variable-redeclaration"
      ],
      "code": "variable-redeclaration",
      "range": [
        9,
        16,
        9
      ]
    }
  ],
  "types": {
    "a": "unknown",
    "x": "number",
    "f": "unknown",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 18. execute/check

```epsil
function f(x) {x+1}; f
```

```json
{
  "value": "f",
  "diagnostics": [],
  "checkDiagnostics": [],
  "types": {
    "a": "unknown",
    "x": "unknown",
    "f": "(x: unknown) -> number",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 19. execute/check

```epsil
let x = 5; x
```

```json
{
  "value": 5,
  "diagnostics": [],
  "checkDiagnostics": [],
  "types": {
    "a": "unknown",
    "x": "number",
    "f": "unknown",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 20. execute/check

```epsil
let f: (integer) -> integer = (x) => x+1; f(2)
```

```json
{
  "value": 3,
  "diagnostics": [],
  "checkDiagnostics": [],
  "types": {
    "a": "unknown",
    "x": "unknown",
    "f": "(integer) -> integer",
    "bump": "unknown",
    "c": "unknown"
  }
}
```

## 21. same-engine-rerun

```epsil
let value=1; value
```

```json
{
  "value": 1,
  "diagnostics": [],
  "type": "number"
}
```

## 22. same-engine-rerun

```epsil
let value="text"; value
```

```json
{
  "value": "'text'",
  "diagnostics": [],
  "type": "string"
}
```

## 23. same-engine-rerun

```epsil
value=2; value
```

```json
{
  "value": "'text'",
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "`value` has the type `string`, and the value has the type `2`",
        "value := 2",
        "assignment-type-mismatch"
      ],
      "code": "assignment-type-mismatch",
      "range": [
        0,
        7,
        0
      ]
    }
  ],
  "type": "string"
}
```

## 24. canonical-order

```epsil
let x=1; function f(x) { x+1 }; type alias Pair = tuple<number, number>; f(2)
```

```json
{
  "raw": [
    "Program",
    [
      "Declare",
      "x",
      [
        "Dictionary",
        [
          "KeyValuePair",
          "value",
          1
        ]
      ]
    ],
    [
      "DefineFunction",
      "f",
      [
        "Function",
        [
          "Block",
          [
            "Add",
            "x",
            1
          ]
        ],
        "x"
      ]
    ],
    [
      "DeclareType",
      "Pair",
      {
        "str": "tuple<number, number>"
      },
      [
        "Dictionary",
        [
          "KeyValuePair",
          "alias",
          "True"
        ]
      ]
    ],
    [
      "f",
      2
    ]
  ],
  "canonical": [
    "Program",
    [
      "DeclareType",
      "Pair",
      "'tuple<number, number>'",
      {
        "dict": {
          "alias": true
        }
      }
    ],
    [
      "DefineFunction",
      "f",
      [
        "Function",
        [
          "Block",
          [
            "Add",
            "x",
            1
          ]
        ],
        "x"
      ]
    ],
    [
      "Declare",
      "x",
      {
        "dict": {
          "value": 1
        }
      }
    ],
    [
      "f",
      2
    ]
  ]
}
```

## 25. execute-extra

```epsil
const W=5; function f(k=W) {k+1}; f()
```

```json
{
  "value": [
    "f"
  ],
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "expected a literal default: a default value is a constant: write a number, a string, a boolean, `[]`, `{}`, a constant (a library constant or a symbol declared constant) or a symbol that the parameter type lists, or pass the argument at `Optional(k, W)`",
        "(k = W) => do {k + 1}",
        "expected-a-literal-default"
      ],
      "code": "expected-a-literal-default",
      "range": [
        22,
        25,
        22
      ]
    },
    {
      "severity": "error",
      "message": [
        "runtime-error",
        "expected a literal default: a default value is a constant: write a number, a string, a boolean, `[]`, `{}`, a constant (a library constant or a symbol declared constant) or a symbol that the parameter type lists, or pass the argument at `Optional(k, W)`",
        "in DefineFunction argument 2",
        "expected-a-literal-default"
      ],
      "range": [
        22,
        25
      ]
    }
  ]
}
```

## 26. execute-extra

```epsil
function f(k=W) {k+1}; const W=5; f()
```

```json
{
  "value": [
    "f"
  ],
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "expected a literal default: a default value is a constant: write a number, a string, a boolean, `[]`, `{}`, a constant (a library constant or a symbol declared constant) or a symbol that the parameter type lists, or pass the argument at `Optional(k, W)`",
        "(k = W) => do {k + 1}",
        "expected-a-literal-default"
      ],
      "code": "expected-a-literal-default",
      "range": [
        11,
        14,
        11
      ]
    },
    {
      "severity": "error",
      "message": [
        "runtime-error",
        "expected a literal default: a default value is a constant: write a number, a string, a boolean, `[]`, `{}`, a constant (a library constant or a symbol declared constant) or a symbol that the parameter type lists, or pass the argument at `Optional(k, W)`",
        "in DefineFunction argument 2",
        "expected-a-literal-default"
      ],
      "range": [
        11,
        14
      ]
    }
  ]
}
```

## 27. execute-extra

```epsil
let n=0; let bump: () scope -> number = () => do {n=n+1;n}; [bump(),bump(),n]
```

```json
{
  "value": [
    "List",
    1,
    2,
    2
  ],
  "diagnostics": []
}
```

## 28. execute-extra

```epsil
let x = k; let k=2; x
```

```json
{
  "value": "x",
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "`k` is used before the statement that declares it in this block",
        "let x = k",
        "read-before-declaration"
      ],
      "code": "read-before-declaration",
      "range": [
        8,
        9,
        8
      ]
    }
  ]
}
```

## 29. execute-extra

```epsil
do { let a = 1; a = "x"; a }
```

```json
{
  "value": [
    "Error",
    [
      "ErrorCode",
      "'assignment-type-mismatch'",
      "'a'",
      "'number'",
      "'string'"
    ],
    [
      "ErrorTrace",
      [
        "ErrorFrame",
        "'Block'",
        2
      ]
    ]
  ],
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "`a` has the type `number`, and the value has the type `string`",
        "do {let a = 1; a := \"x\"; a}",
        "assignment-type-mismatch"
      ],
      "code": "assignment-type-mismatch",
      "range": [
        16,
        23,
        16
      ]
    }
  ]
}
```

## 30. execute-extra

```epsil
let s=0; s=s+0.5; s
```

```json
{
  "value": 0.5,
  "diagnostics": []
}
```

## 31. serialize-roundtrip

```epsil
a; 2
```

```json
{
  "serialized": "a\n2"
}
```

## 32. serialize-roundtrip

```epsil
// empty source
```

```json
{
  "serialized": ""
}
```

## 33. serialize-roundtrip

```epsil
2x+1
```

```json
{
  "serialized": "2x + 1"
}
```

## 34. binder-sites-api

```epsil
sum(k^2, k, 1, n)
```

```json
{
  "value": [
    {
      "name": "k",
      "operands": [
        0,
        1,
        2,
        3
      ]
    }
  ]
}
```

## 35. execute-extra

```epsil
5; function f(x) { x+1 }
```

```json
{
  "value": 5,
  "diagnostics": []
}
```

## 36. execute-extra

```epsil
let x = 5; x = x + 3; x
```

```json
{
  "value": 8,
  "diagnostics": []
}
```

## 37. check-only-extra

```epsil
parallel for k in [1] { log(k) }; function log(x) console { print(x) }
```

```json
{
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "parallel-effect",
        "console"
      ],
      "range": [
        22,
        32
      ]
    }
  ]
}
```

## Documentation generation and checks

`node --import tsx scripts/build-error-docs.ts` exited 0 and regenerated only `src/epsil/docs/errors.md` (66 documented codes). Its maintained source changes are explanation strings only. All six whole-program JSON examples in the edited implementation section also passed a JSON syntax check. No source tests, package build, full documentation build or timings ran for this documentation task.

## Frozen baseline controls for changelog claims

Commands used the preserved production `epsil.js` entry at `/private/tmp/program-only-accepted-baseline-20261115/ce/dist/esm-min/epsil.js` in plain Node (no build or timings), exit 0. The later-lambda read-before rule was already present at this baseline, so no new breaking-change claim is made for it. The older specification’s runner-2 observation is not the matched baseline.

```epsil
let a = 1; a = "x"; a
```

```json
{
  "value": "'x'",
  "diagnostics": []
}
```

```epsil
let a = h(1); let h = (x) => x + 1; a
```

```json
{
  "value": "a",
  "diagnostics": [
    {
      "severity": "error",
      "message": [
        "static-type-error",
        "`h` is used before the statement that declares it in this block",
        "let a = h(1)",
        "read-before-declaration"
      ],
      "code": "read-before-declaration",
      "range": [
        8,
        9,
        8
      ]
    }
  ]
}
```

```epsil
const W=5; function f(k=W) {k+1}; f()
```

```json
{
  "value": 6,
  "diagnostics": []
}
```

