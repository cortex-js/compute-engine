# Event handlers in Epsil

Status: DRAFT. Not approved. No code is written.

## 1. Purpose

A host of the Compute Engine sends events: Tycho sends a click on a series, the
command-line tool can send "the program starts" and "the program stops". This
note proposes a way to write the response to an event in Epsil:

```epsil
let count = 0

on click(event) {
  count = count + 1
  last = event.point
}

on quit {
  Print("clicked", count, "times")
}
```

Epsil defines the declaration and stores it. The host defines every event,
asks whether one of its objects has a handler for a name, and calls it. Epsil
defines no event of its own and no rule for the order in which handlers run.

## 2. What a handler is

A handler is a function that is stored under an event name in a handler set
(section 5.1). It differs from a `function` in three points:

1. **It is not a binding.** The handler `click` and a variable `click` do not
   collide, and a handler cannot be read or called by name from Epsil code.
   A handler set is not a scope and holds no bindings.
2. **The host calls it.** Nothing in an Epsil program calls a handler in the
   first version.
3. **Its purpose is an effect.** Its body can assign to a variable of an
   enclosing scope without an effect specifier (section 6, decision D2).

Its body follows every other rule of a function body: it closes over the scope
where it is declared, its parameters are locals, and its value is the value of
its last expression.

## 3. Syntax

```
on <event-name> [ ( <parameters> ) ] { <body> }
```

- `<event-name>` is one or more names joined by dots: `click`, `plot.click`,
  `series.marker.click`. The dotted name is one string; the dot is not the
  member access of an expression here. A host uses the prefix as its
  namespace.
- The parameter list is optional: `on quit { … }` is `on quit() { … }`. It
  can hold only the names `target`, `self` and `event`, in any order
  (section 5.3).
- `on` is a contextual keyword. It starts a handler declaration only when a
  name follows it on the same line. In every other position it stays an
  ordinary identifier: `on = 5` and `on(3)` keep their present meaning.

This breaks no existing program. With the parser of commit
`7939b5fac3` (`src/epsil/parser.ts`), `on quit { 1 }`, `on click(p) { 1 }` and
`on plot.click(p) { 1 }` each give the error `unexpected-symbol` on the name
after `on`, while `on = 5` parses as an assignment and `on(3)` as a call.

A handler declaration is a statement. It is allowed at the top level of a
program and in a block; it is not an expression.

## 4. MathJSON form

```json
["DefineHandler", "'plot.click'", ["Function", body, "event"]]
```

The form follows `DefineFunction` (`src/compute-engine/library/core.ts`): the
operator is lazy, has the `scope` effect and gives `Nothing`. The event name is
a string, not a symbol, because it is not a binding. A host can build this
expression directly, so a handler does not need Epsil source. The Epsil
serializer writes it back as `on plot.click(event) { … }`.

A second `DefineHandler` for the same name in the same handler set replaces
the first.

## 5. Host interface

All names in this section are proposals.

### 5.1 The handler context: `withHandlers()`

Two questions about a handler have different answers:

- **Which names does its body see?** The lexical scope where the `on`
  statement is written, as for a function.
- **Which object does it belong to?** The handler context that the host set
  for the expression that holds the `on` statement.

The two must be apart. In a document, the cell of a series defines names that
other cells read (`f(x) = …`), so the cell cannot run in a scope of its own;
but its `on click` handler belongs to that series only.

The host sets the handler context around the work that it does for one of its
objects:

```ts
const seriesContext: HandlerContext = {
  handlers: ce.createHandlerSet(),
  self: series,
  events: plotEvents,
};

ce.withHandlers(seriesContext, () => executeEpsil(ce, source));
```

```ts
interface HandlerContext {
  // Where the `on` statements put their handlers.
  handlers: HandlerSet;
  // The value of `self` in each handler of this context: the object that
  // owns the handlers. Default: `Nothing`.
  self?: Expression;
  // The events that an `on` statement can name, and the type of the `event`
  // record of each.
  events: Record<string, { event?: string }>;
  // The types of `self` and `target`, for the static check. Default: `any`.
  selfType?: string;
  targetType?: string;
}

const plotEvents = {
  click: { event: 'record{point: tuple<real, real>, shift: boolean}' },
  'marker.click': { event: 'record{index: integer}' },
};
```

- The context is a parallel of the lexical scope: `ce.withHandlers()` sets it
  for the duration of the function, and an inner call replaces it until it
  returns. It changes how an `on` statement is read and nothing else.
- An expression is bound to the context when it is boxed. The handler is put
  in the set when the `on` statement is evaluated, so an `on` statement in a
  branch that does not run adds nothing. An asynchronous program
  (`executeEpsilAsync()`) keeps the context that was set when it started,
  although `withHandlers()` has returned when its later statements run.
- The host can use one `events` table for many contexts, and one context per
  object.
- Outside every `withHandlers()` call, the context is the default context of
  the engine: the set `ce.handlers` and no event. Each `on` statement then
  gives the warning `unknown-event`.
- The engine gives no meaning to `self`. Only the host has the relation
  between an object and its context.

```ts
interface HandlerSet {
  get(name: string): Handler | undefined;  // "is there a handler named foo"
  names(): string[];
  delete(name: string): boolean;
  clear(): void;
}

interface Handler {
  name: string;
  call(args?: { target?: Expression; event?: Expression }): Expression;
  callAsync(args?: { target?: Expression; event?: Expression }): Promise<Expression>;
}
```

- `names()` lets a host show that an object responds to an event, for
  example a pointer cursor on a series that has a `click` handler.
- `clear()` is for a source that is run again: the host empties the set of a
  cell before it runs the cell, so a handler that the user deleted from the
  source does not stay.
- `call()` gives the value of the body. An error in the body is an `Error`
  value, as for every Epsil evaluation; `call()` does not throw.

### 5.2 Bubbling and dispatch belong to the host

The engine has no dispatch function, and handler sets have no parent. A host
that wants "the series first, then the document" writes that rule:

```ts
const h =
  seriesContext.handlers.get('click') ?? documentContext.handlers.get('click');
h?.call({ target: series, event: { point, shift } });
```

In the handler of the document, `target` is the series and `self` is the
document. In the handler of the series, both are the series.

A host that wants the HyperTalk `pass` behavior reads the value that `call()`
gives (for example, `True` means "handled") and calls the next handler itself.
The engine gives no meaning to the value.

### 5.3 The arguments of a handler

Every handler of every event has the same three arguments:

| Name     | Value                                                     | Comes from                         |
| -------- | --------------------------------------------------------- | ---------------------------------- |
| `target` | the object that the event is about                        | `call()`; default: `self`          |
| `self`   | the object that owns the handler                          | the handler context                |
| `event`  | a record with the details of this event                   | `call()`; default: an empty record |

An `on` statement lists the arguments that its body uses, by name and in any
order: `on click(event) { … }`, `on click(self, target) { … }`,
`on quit { … }`. Another name in the list is the error
`unknown-handler-argument`. A name that is not in the list is not bound, so
a variable `event` or `target` of the document stays visible in a handler
that does not list that name.

When the context declares the event, the static check gives `event` the
record type of the declaration, so `event.pont` is an error before the
program runs. `target` and `self` have the types `targetType` and `selfType`.

An `on` statement for an event that the context does not declare is stored,
with the warning `unknown-event`; its `event` has the type `record`.

The command-line tool runs a program in a context that declares `init` and
`quit`, with no `self`. It calls `init` before the first statement of the
program and `quit` after the last one.

## 6. Decisions for the user

Each decision has a recommended option, which the rest of this note assumes.
If a decision is not made, the recommended option is built.

- D1: option (a), a warning. approved 2026-11-09
- D2: option (a), the `scope` effect without a specifier. approved 2026-11-09
- D3: option (a), no `Send` in the first version. approved 2026-11-09.
  Section 9 says what a later `Send` needs.
- D4: no decision needed.
- D5 (section 9.2): option (a), arguments bound by name. approved 2026-11-09
- D6 (section 9.3): option (a), the host names the owner of a handler at
  boxing. approved 2026-11-09
- D7: every handler has the arguments `target`, `self` and `event`; the
  details of an event are fields of the `event` record (section 5.3).
  approved 2026-11-10. It replaces the event-specific argument names of D5;
  the binding by name stays.
- D8: the host sets the handler context with `ce.withHandlers()`: the handler
  set, `self`, and the events with the type of their `event` record
  (section 5.1). approved 2026-11-10. It replaces `ce.declareEvent()` and the
  `handlers` option of `ce.box()`.

**D1. A handler for an event that the host did not declare.**
Example: `on clikc(p) { … }` in Tycho, where the event is `click`.

- (a) Recommended: a warning `unknown-event`; the handler is stored. The
  program runs, and the same source runs in a host that has other events.
- (b) An error; the handler is not stored. A typing error cannot go
  unseen, but a document with an `on quit` handler fails in a host that has
  no `quit` event.
- (c) No diagnostic. A typing error gives a handler that never runs.

**D2. Assignment to an outer variable in a handler body.**
Example: `let n = 0` followed by `on click { n = n + 1 }`.
In a `function`, this needs the specifier `scope`
(`function bump() scope { n = n + 1 }`, `src/epsil/docs/declarations.md`).

- (a) Recommended: a handler has the `scope` effect without a specifier. A
  handler with no effect has no use, so the specifier gives no information.
- (b) The specifier is required: `on click scope { … }`. Handlers and
  functions follow one rule, and each handler carries one more word.

**D3. Calling a handler from Epsil code** (HyperTalk `send`).
Example: `on init { Send("reset") }`.

- (a) Recommended: not in the first version. Code that two handlers share
  goes in a `function`.
- (b) A `Send(name, args…)` operator. It needs a dispatch rule in the
  engine, which section 5.2 leaves to the host.

**D4. LaTeX.** A handler has no LaTeX form in the first version; a LaTeX cell
cannot declare one. No option is proposed: handlers are statements with
effects, and the LaTeX syntax has no block statement to carry them.

## 7. What is not in this proposal

- **Compilation.** A handler runs once per user action. It runs in the
  interpreter, and the compile targets do not change. A compilation of a
  program that holds a `DefineHandler` declines.
- **What the host does after a handler changed a variable.** Tycho must
  decide whether the new value is saved with the document, whether undo
  restores the old value, and how it finds the cells to evaluate again. The
  engine reports nothing more than it reports for any assignment.
- **A handler that runs while another runs.** The host decides whether an
  event that arrives during a `callAsync()` waits.

## 8. Order of work

1. `DefineHandler`, `HandlerSet`, `ce.withHandlers()` with the handler set
   and `self`. A host can use handlers from MathJSON after this step.
2. The `events` table of the context and the static check of `event`.
3. The Epsil `on` statement: parser, serializer, formatter, the `unknown-event`
   diagnostic, the documentation page.
4. `init` and `quit` in the command-line tool.
5. Tycho: one handler context per series and one per document, the `click`
   events, the rule for the order of handlers.

## 9. Targets

A target is the object that an event is about: the series that the user
clicked. Three needs call for it.

1. **A handler of an outer object must know which object got the event.** A
   document has one `on click` handler for all its series; the body needs the
   series that the user clicked. (HyperTalk: `the target`.)
2. **`Send` must name its recipient**: `Send(series, "click")`.
3. **A handler can be written away from its object**: the document script
   declares a handler for one series.

### 9.1 A target is a value of the host, not a concept of the engine

In Epsil, a target is a value that the host chooses to denote one of its
objects. The engine gives it no type of its own and no meaning. It can be:

- a string identifier or a record of the properties at the time of the event;
- an `object` value. An object is a mutable instance with a nominal type and
  slots, and two objects are equal only when they are the same instance
  (`docs/TYPE-SYSTEM.md`, "An object value is a `BoxedObject`"). A host that
  declares an object type for its series gives the handler a target whose
  slots it can read and assign, and identity is the comparison that a target
  needs.

The host keeps the relation between a target value and its handler set.

- **Need 1.** `target` is an argument of every handler (section 5.3):

  ```epsil
  on click(target) {
    selected = target
  }
  ```

- **Need 2.** A later `Send(target, name, arguments…)` does not dispatch in
  the engine. It calls a function that the host registered, with the target
  value, the event name and the arguments. The host finds the handler set of
  the target and applies its own order of handlers. So `Send` keeps the rule
  of section 5.2, and the first version needs nothing for it.
- **Need 3.** Not proposed. The host can already read a prefix of the event
  name as an object name (`on series1.click { … }` in the document's handler
  set), because the event name is a string that the host interprets.

### 9.2 Decision D5: arguments bound by name

A handler lists the arguments that it uses by name, not by position, and the
host can add a detail to an event without a change to an existing handler.
Decision D7 fixed the names to `target`, `self` and `event`; a new detail is a
new field of the `event` record. The options that were not taken: arguments by
position, and names that differ from one event to the next
(`on click(point, modifiers)`).

### 9.3 Decision D6: what owns a handler

Example: a Tycho document has two series cells, `f(x) = x^2` and
`g(x) = f(x) + 1`, and the first cell also holds `on click { … }`.

- (a) Taken: a handler set that the host names at boxing, through the handler
  context (section 5.1). Both cells run in the document scope, so `g` reads
  `f`; the handler goes in the set of the first series. The host can empty
  the set of one cell.
- (b) The lexical scope: the handler is stored in the scope where the `on`
  statement runs, and the host asks a scope for its handlers. The engine
  gets no new option on `ce.box()`. But the host must run each series in a
  scope of its own to tell the handlers apart, and then `f` is a local of
  the first cell that `g` cannot read. The host can avoid that only with
  event names that carry the object (`on series1.click`).
- (c) The host gives the target VALUE at boxing, and the engine keeps a
  table from target values to handlers. The engine then needs a rule for
  when two target values are the same, which a string, a record and an
  object answer differently; with (a) the host keeps that relation.

