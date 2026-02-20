// From https://github.com/typed-rocks/typescript/blob/main/one_of.ts

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type MergeTypes<TypesArray extends any[], Res = {}> = TypesArray extends [
  infer Head,
  ...infer Rem
]
  ? MergeTypes<Rem, Res & Head>
  : Res;

/** @internal  */
export type OneOf<
  TypesArray extends any[],
  Res = never,
  AllProperties = MergeTypes<TypesArray>
> = TypesArray extends [infer Head, ...infer Rem]
  ? OneOf<Rem, Res | OnlyFirst<Head, AllProperties>, AllProperties>
  : Res;

// type _SimpleOneOf<F, S> = OnlyFirst<F, S> | OnlyFirst<S, F>;

/** @internal */
type OnlyFirst<F, S> = F & { [Key in keyof Omit<S, keyof F>]?: never };
