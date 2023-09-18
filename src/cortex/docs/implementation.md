---
title: Inside Cortex
permalink: /cortex/implementation/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---
# Inside Cortex

A Cortex program is an expression that gets transformed into an IR (Intermediate
Representation) expressed in MathJSON, compiled and evaluated by the Cortex
Compute Engine.

The process to convert a Cortex program into a MathJSON expression is pretty
straightforward:

- Function calls gets converted into MathJSON functions:

```cortex
Print("x =", x)
```

```json example
["Print", "'x ='", "x"]
```

- String get converted into MathJSON string. Interpolated strings get converted
  into MathJSON `String` functions:

```cortex
"The solution is \(x)"
```

```json example
["String", "'The solution is '", "x"]
```

- Operators get converted into equivalent MathJSON functions:

```cortex
2x + 1
```

```json example
["Add", ["Multiply", 2, "x"], 1]
```

- Collections (List, Set, Tuple, Sequence, Dicitionary) get converted into a
  corresponding MathJSON expression:

```cortex
set =  {2, 5, 7, 11, 13}
list = [2, 7, 2, 4, 2]
tuple = (1.5, 0.5)
sequence = 2, 5, 7
```

```json example
["Assign", "set", ["Set", 2, 5, 7, 11, 13]]
```

```json example
["Assign", "list", ["List", 2, 7, 2, 4, 2])]
```

```json example
["Assign", "tuple", ["Tuple", 1.5, 0.5])]
```

```json example
["Assign", "sequence", ["Sequence", 2, 5, 7])]
```

- Control structures get converted to an appropriate expression:

```cortex
if (x in PrimeNumber) {
  Print(x);
   x += 1;
} else {
  x += 2;
}
```

```json example
[
  "If",
  ["Element", "x", "PrimeNumber"],
  ["Do", ["Print", "x"], ["Equal", "x", ["Add", "x", 1]]],
  ["Add", "x", 2]
]
```
