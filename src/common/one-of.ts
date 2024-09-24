// From https://github.com/typed-rocks/typescript/blob/main/one_of.ts

type MergeTypes<TypesArray extends any[], Res = {}> = TypesArray extends [
  infer Head,
  ...infer Rem,
]
  ? MergeTypes<Rem, Res & Head>
  : Res;

export type OneOf<
  TypesArray extends any[],
  Res = never,
  AllProperties = MergeTypes<TypesArray>,
> = TypesArray extends [infer Head, ...infer Rem]
  ? OneOf<Rem, Res | OnlyFirst<Head, AllProperties>, AllProperties>
  : Res;

type SimpleOneOf<F, S> = OnlyFirst<F, S> | OnlyFirst<S, F>;

type OnlyFirst<F, S> = F & { [Key in keyof Omit<S, keyof F>]?: never };
