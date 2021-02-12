## `Sequence`

The most primitive collection: a series of expressions separated by a `,`.

| MathJSON                             | Latex     |
| :----------------------------------- | :-------- |
| `["Sequence", "x", "y"]`             | `x, y`    |
| `["Sequence", ["Add", "x", 1], "y"]` | `x + 1, y |

## `Sequence2`

A series of expressions separated by a `;`.

| MathJSON                                     | Latex     |
| :------------------------------------------- | :-------- |
| `["Sequence2", "x", "y"]`                    | `x; y`    |
| `["Sequence2", ["Sequence", "a", "b"], "y"]` | `a, b; y` |

## `Set`

| MathJSON            | Latex                 |
| :------------------ | :-------------------- |
| `["Set", "x", "y"]` | `\lbrack x, y\rbrack` |

## `List`

An ordered collection of elements.

Use to represent a data structure, as opposed to `Group` or `Sequence`.

| MathJSON                        | Latex           |
| :------------------------------ | :-------------- |
| `["List", "x", "y", "7", "11"]` | `[x, y, 7, 11]` |
| `["List", "x", "Nothing", "y"]` | `[x,,y]`        |

## `Group`

One or more expressions in a sequence.

Use to represent function arguments, or to group arithmetic expressions.

| MathJSON                         | Latex                                                      |
| :------------------------------- | :--------------------------------------------------------- |
| `["Group", "x", "y", "7", "11"]` | `(x, y, 7, 11)`                                            |
| `()`                             | `["Group"]`                                                |
| `(a, b, c)`                      | `["Group", "a", "b", "c"]`                                 |
| `(a, b; c, d)`                   | `["Group", ["Sequence, "a", "b"], ["Sequence", "c", "d"]]` |
| `a, (b, c)`                      | `["Sequence", "a", ["Group", "b", "c"]]`                   |
