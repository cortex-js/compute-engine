import type {
  OptionKeyDocumentation,
  ParameterDocumentation,
} from '../compute-engine/global-types.js';

//
// The documentation of the parameters of a function: the `parameters` field
// of a library definition, and the tag lines of a `///` comment.
//
// A `///` comment is stored whole as the `description` of its definition.
// The editor services split it here: the tag lines leave the description and
// become the same data as the `parameters` and `examples` fields of a
// library definition.
//
//   @param <name> <markdown>
//   @key <param>.<key>[: <type> --] <markdown>
//   @sample <param>[.<key>] <epsil source>
//   @default <param>.<key> <epsil source>
//   @example <epsil source>
//
// A tag line runs to the end of the line; a following line that starts with
// whitespace and is not blank or a tag continues it. A line that starts with
// another `@word` stays in the description.
//

/** The documentation of one key of an options parameter. */
export type KeyDoc = {
  name: string;
  type?: string;
  documentation?: string;
  sample?: string;
  default?: string;
};

/** The documentation of one parameter. */
export type ParameterDoc = {
  documentation?: string;
  sample?: string;
  /** The keys of a parameter that takes a dictionary of options, in the
   * order of their declaration. */
  keys?: KeyDoc[];
};

/** A description split from its tags. */
export type DocComment = {
  /** The description without the tag lines, `undefined` when nothing else
   * is left. */
  description?: string;
  parameters: Map<string, ParameterDoc>;
  examples: string[];
};

const TAG = /^\s*@(param|key|sample|default|example)\b[ \t]*(.*)$/;

/** Split the tag lines from the text of a `///` comment. */
export function splitDocComment(text: string): DocComment {
  const parameters = new Map<string, ParameterDoc>();
  const examples: string[] = [];
  const kept: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = TAG.exec(lines[i]);
    if (match === null) {
      kept.push(lines[i]);
      continue;
    }
    let body = match[2].trim();
    while (
      i + 1 < lines.length &&
      /^\s/.test(lines[i + 1]) &&
      lines[i + 1].trim() !== '' &&
      !TAG.test(lines[i + 1])
    ) {
      i += 1;
      body += ' ' + lines[i].trim();
    }
    applyTag(match[1], body, parameters, examples);
  }
  while (kept.length > 0 && kept[0].trim() === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  const description = kept.length === 0 ? undefined : kept.join('\n');
  return {
    ...(description === undefined ? {} : { description }),
    parameters,
    examples,
  };
}

function applyTag(
  tag: string,
  body: string,
  parameters: Map<string, ParameterDoc>,
  examples: string[]
): void {
  if (tag === 'example') {
    if (body !== '') examples.push(body);
    return;
  }
  // The target: `name`, `...name` or `name.key`.
  const target =
    /^(?:\.\.\.)?([\p{L}_][\p{L}\p{N}_]*)(?:\.([\p{L}_][\p{L}\p{N}_]*))?/u.exec(
      body
    );
  if (target === null) return;
  const [, name, key] = target;
  let rest = body.slice(target[0].length).trim();
  const param = parameterOf(parameters, name);
  if (key === undefined) {
    if (tag === 'param') setText(param, 'documentation', rest);
    else if (tag === 'sample') setText(param, 'sample', rest);
    return;
  }
  const entry = keyOf(param, key);
  if (tag === 'key') {
    if (rest.startsWith(':')) {
      const separator = rest.indexOf(' -- ');
      const type = separator < 0 ? rest.slice(1) : rest.slice(1, separator);
      setText(entry, 'type', type.trim());
      rest = separator < 0 ? '' : rest.slice(separator + 4).trim();
    }
    setText(entry, 'documentation', rest);
  } else if (tag === 'sample') setText(entry, 'sample', rest);
  else if (tag === 'default') setText(entry, 'default', rest);
}

function setText<T extends object>(
  target: T,
  field: keyof T & string,
  text: string
): void {
  if (text !== '') (target as Record<string, string>)[field] = text;
}

function parameterOf(
  parameters: Map<string, ParameterDoc>,
  name: string
): ParameterDoc {
  let param = parameters.get(name);
  if (param === undefined) {
    param = {};
    parameters.set(name, param);
  }
  return param;
}

function keyOf(param: ParameterDoc, name: string): KeyDoc {
  param.keys ??= [];
  let key = param.keys.find((k) => k.name === name);
  if (key === undefined) {
    key = { name };
    param.keys.push(key);
  }
  return key;
}

/** The paragraphs of a Markdown text: the runs of lines between blank
 * lines, a fenced code block (```) kept whole. */
export function paragraphsOf(text: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === '') {
      if (current.length > 0) paragraphs.push(current.join('\n'));
      current = [];
    } else current.push(line);
  }
  if (current.length > 0) paragraphs.push(current.join('\n'));
  return paragraphs;
}

/** The `parameters` field of a definition, in the form of the tags. */
export function parameterDocsOf(
  parameters: Readonly<Record<string, ParameterDocumentation>> | undefined
): Map<string, ParameterDoc> {
  const result = new Map<string, ParameterDoc>();
  if (parameters === undefined) return result;
  for (const [name, doc] of Object.entries(parameters)) {
    if (typeof doc === 'string') {
      result.set(name, { documentation: doc });
      continue;
    }
    const entry: ParameterDoc = {};
    if (doc.description) entry.documentation = doc.description;
    if (doc.sample) entry.sample = doc.sample;
    if (doc.keys !== undefined)
      entry.keys = Object.entries(doc.keys).map(([key, k]) => keyDocOf(key, k));
    result.set(name, entry);
  }
  return result;
}

function keyDocOf(name: string, doc: OptionKeyDocumentation): KeyDoc {
  if (typeof doc === 'string') return { name, documentation: doc };
  return {
    name,
    ...(doc.type ? { type: doc.type } : {}),
    ...(doc.description ? { documentation: doc.description } : {}),
    ...(doc.sample ? { sample: doc.sample } : {}),
    ...(doc.default ? { default: doc.default } : {}),
  };
}

/** The documentation of a definition: its description without its tag
 * lines, and its parameters and examples. The `parameters` and `examples`
 * fields of the definition come first and the tags after them (a tag fills
 * what the field leaves out).
 *
 * The description of a definition of the standard library is kept as the
 * definition writes it: a list of lines that the reference generator joins
 * (`scripts/build-library-reference.ts`), or one string. The description of
 * another definition, a `///` comment, is split into its paragraphs
 * (`paragraphsOf()`) when `library` is not set. */
export function definitionDocs(
  def: {
    description?: string | string[];
    parameters?: Readonly<Record<string, ParameterDocumentation>>;
    examples?: string | string[];
  },
  library = false
): {
  description?: string[];
  parameters: Map<string, ParameterDoc>;
  examples: string[];
} {
  const paragraphs =
    def.description === undefined
      ? []
      : typeof def.description === 'string'
        ? [def.description]
        : def.description;
  const parameters = parameterDocsOf(def.parameters);
  const examples =
    def.examples === undefined
      ? []
      : typeof def.examples === 'string'
        ? [def.examples]
        : [...def.examples];
  const description: string[] = [];
  for (const paragraph of paragraphs) {
    const split = splitDocComment(paragraph);
    if (split.description !== undefined)
      description.push(
        ...(library ? [split.description] : paragraphsOf(split.description))
      );
    examples.push(...split.examples);
    for (const [name, tags] of split.parameters) {
      const entry = parameters.get(name);
      if (entry === undefined) {
        parameters.set(name, tags);
        continue;
      }
      entry.documentation ??= tags.documentation;
      entry.sample ??= tags.sample;
      for (const key of tags.keys ?? []) {
        entry.keys ??= [];
        const existing = entry.keys.find((k) => k.name === key.name);
        if (existing === undefined) {
          entry.keys.push(key);
          continue;
        }
        existing.type ??= key.type;
        existing.documentation ??= key.documentation;
        existing.sample ??= key.sample;
        existing.default ??= key.default;
      }
    }
  }
  return {
    ...(description.length === 0 ? {} : { description }),
    parameters,
    examples,
  };
}
