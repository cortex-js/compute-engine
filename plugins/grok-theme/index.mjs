/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-this-alias */
import {
  DeclarationReflection,
  ReferenceReflection,
  ReferenceType,
  ReflectionKind,
  ReflectionType,
} from 'typedoc';

import { MarkdownTheme, MarkdownThemeContext } from 'typedoc-plugin-markdown';

/**
 *
 * THEORY OF OPERATION
 *
 * The partials below are based on the default partials provided by the
 * markdown theme. They are modified in some small ways, for example to omit
 * some labels, or to add a `<MemberCard>` component around certain types of
 * reflections.
 *
 * See @custom comments for changes.
 */

function getReturnType(context, typeDeclaration, type) {
  if (typeDeclaration?.signatures) return context.partials.someType(type);

  if (type) {
    const returnType = context.partials.someType(type);
    if (context.options.getValue('useCodeBlocks')) {
      if (
        type instanceof ReflectionType &&
        context.options.getValue('expandObjects')
      )
        return codeBlock(returnType);
    }
    return returnType;
  }
  return '';
}

/**
 * @param {import('typedoc-plugin-markdown').MarkdownApplication} app
 */
export function load(app) {
  app.renderer.defineTheme('grok-theme', GrokTheme);
}

class GrokTheme extends MarkdownTheme {
  /**
   * @param {import('typedoc-plugin-markdown').MarkdownPageEvent} page
   */
  getRenderContext(page) {
    return new GrokThemeRenderContext(this, page, this.application.options);
  }
}

/** Utility functions extracted from the MarkdownTheme plugin */
function backTicks(text) {
  return /(`|\||\\)/g.test(text) ? escapeChars(text) : `\`${text}\``;
}

class GrokThemeRenderContext extends MarkdownThemeContext {
  constructor(theme, page, options) {
    super(theme, page, options);
    const superPartials = this.partials;
    this.partials = {
      ...superPartials,

      groups: (model, options) => {
        const groupsWithChildren = model?.filter(
          (group) => !group.allChildrenHaveOwnDocument()
        );

        const md = [];

        const getGroupTitle = (groupTitle) => {
          return groupTitle;
        };

        groupsWithChildren?.forEach((group, index) => {
          const isEventProps = getGroupTitle(group.title) === 'Events';
          if (group.categories) {
            // md.push(heading(options.headingLevel, getGroupTitle(group.title))); @custom
            if (group.description) {
              md.push(this.helpers.getCommentParts(group.description));
            }
            md.push(
              this.partials.categories(group.categories, {
                headingLevel: options.headingLevel + 1,
              })
            );
          } else {
            const isPropertiesGroup = group.children.every(
              (child) => child.kind === ReflectionKind.Property
            );
            const isEnumGroup = group.children.every(
              (child) => child.kind === ReflectionKind.EnumMember
            );
            // md.push(heading(options.headingLevel, getGroupTitle(group.title))); @custom
            if (group.description) {
              md.push(this.helpers.getCommentParts(group.description));
            }
            if (
              isPropertiesGroup &&
              this.helpers.useTableFormat('properties', options.kind)
            ) {
              md.push(
                this.partials.propertiesTable(group.children, {
                  isEventProps,
                })
              );
            } else if (isEnumGroup && this.helpers.useTableFormat('enums')) {
              md.push(this.partials.enumMembersTable(group.children));
            } else {
              if (group.children) {
                md.push(
                  this.partials.members(group.children, {
                    headingLevel: options.headingLevel + 1,
                    groupTitle: group.title,
                  })
                );
              }
            }
          }
        });
        return md.join('\n\n');
      },

      inheritance: (model, options) => {
        return '';
        // const md = [];

        // if (model.implementationOf) {
        //   if (options.headingLevel !== -1) {
        //     md.push(
        //       heading(options.headingLevel, this.getText('label.implementationOf')),
        //     );
        //   }
        //   md.push(this.partials.typeAndParent(model.implementationOf));
        // }

        // if (model.inheritedFrom) {
        //   if (options.headingLevel !== -1) {
        //     md.push(
        //       heading(options.headingLevel, this.getText('label.inheritedFrom')),
        //     );
        //   }
        //   md.push(this.partials.typeAndParent(model.inheritedFrom));
        // }

        // if (model.overwrites) {
        //   const overridesLabel = this.getText('label.overrides');
        //   if (options.headingLevel !== -1) {
        //     md.push(heading(options.headingLevel, overridesLabel));
        //   }
        //   md.push(this.partials.typeAndParent(model.overwrites));
        // }

        // return md.join('\n\n');
      },

      signatureReturns: (model, options) => {
        const md = [];
        const typeDeclaration = model.type?.declaration;
        // md.push(heading(options.headingLevel, this.i18n.theme_returns()));
        if (typeDeclaration?.signatures) {
          md.push(backTicks('Function'));
        } else {
          md.push(this.helpers.getReturnType(model.type));
        }
        if (model.comment?.blockTags.length) {
          const tags = model.comment.blockTags
            .filter((tag) => tag.tag === '@returns')
            .map((tag) => this.helpers.getCommentParts(tag.content));
          md.push(tags.join('\n\n'));
        }
        if (typeDeclaration?.signatures) {
          typeDeclaration.signatures.forEach((signature) => {
            md.push(
              this.partials.signature(signature, {
                headingLevel: options.headingLevel + 1,
                nested: true,
              })
            );
          });
        }
        if (typeDeclaration?.children) {
          md.push(
            this.partials.typeDeclaration(typeDeclaration, {
              headingLevel: options.headingLevel,
            })
          );
        }
        return md.join('\n\n');
      },

      members: (model, options) => {
        const md = [];
        // const displayHr = (reflection) => {
        //   if (this.options.getValue('outputFileStrategy') === 'modules') {
        //     return this.helpers.isGroupKind(reflection);
        //   }
        //   return true;
        // };
        const items = model?.filter((item) => !item.hasOwnDocument);
        items?.forEach((item, index) => {
          md.push(
            this.partials.member(item, { headingLevel: options.headingLevel })
          );
          // if (index < items.length - 1 && displayHr(item)) {
          //   md.push(horizontalRule());
          // }
        });
        return md.join('\n\n');
      },

      member: (model, options) => {
        const md = [];

        if (this.options.getValue('useHTMLAnchors') && model.anchor) {
          const id = model.anchor;
          md.push(`<a id="${id}" name="${id}"></a>`);
        }

        let hasCard = false;

        if (!model.hasOwnDocument) {
          hasCard = ![
            ReflectionKind.Class,
            ReflectionKind.Interface,
            ReflectionKind.Enum,
            ReflectionKind.TypeAlias,
          ].includes(model.kind);

          let memberName = this.partials.memberTitle(model);

          if (model.kind === ReflectionKind.Constructor) {
            memberName = `new ${model.parent.name}()`;
          } else if (model.parent?.kind === ReflectionKind.TypeLiteral) {
            memberName = `${model.parent.parent.name}.${memberName}`;
          } else {
            if (
              model.parent &&
              [
                ReflectionKind.Class,
                ReflectionKind.Interface,
                ReflectionKind.Enum,

                ReflectionKind.TypeAlias,
              ].includes(model.parent.kind)
            )
              memberName = `${model.parent.name}.${memberName}`;
          }
          if (hasCard) md.push(`<MemberCard>`);
          md.push(heading(options.headingLevel, memberName));
        }

        const getMember = (reflection) => {
          if (
            [
              ReflectionKind.Class,
              ReflectionKind.Interface,
              ReflectionKind.Enum,
            ].includes(reflection.kind)
          ) {
            return this.partials.memberWithGroups(reflection, {
              headingLevel: options.headingLevel + 1,
            });
          }

          if (reflection.kind === ReflectionKind.Constructor)
            return this.partials.constructor(reflection, {
              headingLevel: options.headingLevel,
            });

          if (reflection.kind === ReflectionKind.Accessor)
            return this.partials.accessor(reflection, {
              headingLevel: options.headingLevel + 1,
            });

          if (reflection.signatures) {
            return reflection.signatures
              ?.map((signature) => {
                const signatureMd = [];
                const multipleSignatures =
                  reflection.signatures && reflection.signatures?.length > 1;

                if (multipleSignatures) {
                  signatureMd.push(
                    heading(
                      options.headingLevel + 1,
                      `${escapeChars(signature.name)}(${signature.parameters
                        ?.map((param) => param.name)
                        .join(', ')})`
                    )
                  );
                }
                signatureMd.push(
                  this.partials.signature(signature, {
                    headingLevel: multipleSignatures
                      ? options.headingLevel + 2
                      : options.headingLevel + 1,
                    nested: options.nested,
                  })
                );
                return signatureMd.join('\n\n');
              })
              .join('\n\n');
          }

          if (reflection instanceof ReferenceReflection)
            return this.partials.referenceMember(reflection);

          return this.partials.declaration(reflection, {
            headingLevel: options.headingLevel + 1,
            nested: options.nested,
          });
        };

        const memberMarkdown = getMember(model);

        if (memberMarkdown) md.push(memberMarkdown);

        if (hasCard) md.push('</MemberCard>');

        return md.join('\n\n');
      },

      accessor: (model, options) => {
        const md = [];
        const showSources = model?.parent?.kind !== ReflectionKind.TypeLiteral;
        if (model.getSignature) {
          md.push(
            heading(
              options.headingLevel,
              this.internationalization.proxy.kind_get_signature()
            )
          );
          md.push(
            this.partials.signatureTitle(model.getSignature, {
              accessor: 'get',
            })
          );
          if (showSources && !this.options.getValue('disableSources')) {
            if (model.getSignature?.sources) {
              md.push(this.partials.sources(model.getSignature));
            }
          }
          if (model.getSignature.comment) {
            md.push(
              this.partials.comment(model.getSignature.comment, {
                headingLevel: options.headingLevel + 1,
              })
            );
          }
          if (model.getSignature?.type) {
            md.push(
              this.partials.signatureReturns(model.getSignature, {
                headingLevel: options.headingLevel + 1,
              })
            );
          }
        }
        if (model.setSignature) {
          // md.push(
          //   heading(
          //     options.headingLevel,
          //     this.internationalization.proxy.kind_set_signature()
          //   )
          // ); @custom
          md.push(
            this.partials.signatureTitle(model.setSignature, {
              accessor: 'set',
            })
          );
          if (showSources && !this.options.getValue('disableSources')) {
            if (model.setSignature?.sources) {
              md.push(this.partials.sources(model.setSignature));
            }
          }
          if (model.setSignature.comment) {
            md.push(
              this.partials.comment(model.setSignature.comment, {
                headingLevel: options.headingLevel + 1,
              })
            );
          }
          if (model.setSignature?.parameters?.length) {
            md.push(
              heading(
                options.headingLevel + 1,
                this.internationalization.kindPluralString(
                  ReflectionKind.Parameter
                )
              )
            );
            if (this.helpers.useTableFormat('parameters')) {
              md.push(
                this.partials.parametersTable(model.setSignature.parameters)
              );
            } else {
              md.push(
                this.partials.parametersList(model.setSignature.parameters, {
                  headingLevel: options.headingLevel + 1,
                })
              );
            }
          }
          if (model.setSignature?.type) {
            md.push(
              this.partials.signatureReturns(model.setSignature, {
                headingLevel: options.headingLevel + 1,
              })
            );
          }
        }
        if (showSources && !this.options.getValue('disableSources')) {
          if (!model.getSignature && !model.setSignature) {
            md.push(this.partials.sources(model));
          }
        }
        if (model.comment) {
          md.push(
            this.partials.comment(model.comment, {
              headingLevel: options.headingLevel,
            })
          );
        }
        md.push(
          this.partials.inheritance(model, {
            headingLevel: options.headingLevel,
          })
        );
        return md.join('\n\n');
      },

      signature: (model, options) => {
        const md = [];
        if (!options.nested) {
          md.push(
            this.partials.signatureTitle(model, {
              accessor: options.accessor,
            })
          );
        }
        if (
          !options.nested &&
          model.sources &&
          !this.options.getValue('disableSources')
        ) {
          md.push(this.partials.sources(model));
        }
        let modelComments = options.multipleSignatures
          ? model.comment
          : model.comment || model.parent?.comment;
        if (
          modelComments &&
          model.parent?.comment?.summary &&
          !options.multipleSignatures
        ) {
          modelComments = Object.assign(modelComments, {
            summary: model.parent.comment.summary,
          });
        }
        if (modelComments && model.parent?.comment?.blockTags) {
          modelComments.blockTags = [
            ...(model.parent?.comment?.blockTags || []),
            ...(model.comment?.blockTags || []),
          ];
        }
        if (modelComments) {
          md.push(
            this.partials.comment(modelComments, {
              headingLevel: options.headingLevel,
              showTags: false,
              showSummary: true,
            })
          );
        }
        if (!options.multipleSignatures && model.parent?.documents) {
          md.push(
            this.partials.documents(model?.parent, {
              headingLevel: options.headingLevel,
            })
          );
        }
        if (
          model.typeParameters?.length &&
          model.kind !== ReflectionKind.ConstructorSignature
        ) {
          // md.push(
          //   heading(
          //     options.headingLevel,
          //     this.internationalization.kindPluralString(
          //       ReflectionKind.TypeParameter
          //     )
          //   )
          // ); @custom
          if (this.helpers.useTableFormat('parameters')) {
            md.push(this.partials.typeParametersTable(model.typeParameters));
          } else {
            md.push(this.partials.typeParametersList(model.typeParameters));
          }
        }
        if (model.parameters?.length) {
          // md.push(
          //   heading(
          //     options.headingLevel,
          //     this.internationalization.kindPluralString(
          //       ReflectionKind.Parameter
          //     )
          //   )
          // ); @custom
          if (this.helpers.useTableFormat('parameters')) {
            md.push(this.partials.parametersTable(model.parameters));
          } else {
            md.push(
              this.partials.parametersList(model.parameters, {
                headingLevel: options.headingLevel,
              })
            );
          }
        }
        if (model.type) {
          md.push(
            this.partials.signatureReturns(model, {
              headingLevel: options.headingLevel,
            })
          );
        }
        if (modelComments) {
          md.push(
            this.partials.comment(modelComments, {
              headingLevel: options.headingLevel,
              showTags: true,
              showSummary: false,
            })
          );
        }
        md.push(
          this.partials.inheritance(model, {
            headingLevel: options.headingLevel,
          })
        );
        return md.join('\n\n');
      },
    };
  }
}

function escapeChars(str) {
  return str
    .replace(/>/g, '\\>')
    .replace(/</g, '\\<')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\*/g, '\\*');
}

function unEscapeChars(str) {
  return str
    .replace(
      /(`[^`]*?)\\*([^`]*?`)/g,
      (match, p1, p2) => `${p1}${p2.replace(/\*/g, '\\*')}`
    )
    .replace(/\\\\/g, '\\')
    .replace(/(?<!\\)\*/g, '')
    .replace(/\\</g, '<')
    .replace(/\\>/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\_/g, '_')
    .replace(/\\{/g, '{')
    .replace(/\\}/g, '}')
    .replace(/``.*?``|(?<!\\)`/g, (match) =>
      match.startsWith('``') ? match : ''
    )
    .replace(/`` /g, '')
    .replace(/ ``/g, '')
    .replace(/\\`/g, '`')
    .replace(/\\\*/g, '*')
    .replace(/\\\|/g, '|')
    .replace(/\\\]/g, ']')
    .replace(/\\\[/g, '[')
    .replace(/\[([^[\]]*)\]\((.*?)\)/gm, '$1');
}

function codeBlock(content) {
  const trimLastLine = (content) => {
    const lines = content.split('\n');
    return lines
      .map((line, index) => (index === lines.length - 1 ? line.trim() : line))
      .join('\n');
  };
  const trimmedContent =
    content.endsWith('}') ||
    content.endsWith('};') ||
    content.endsWith('>') ||
    content.endsWith('>;')
      ? trimLastLine(content)
      : content;
  return '```ts\n' + unEscapeChars(trimmedContent) + '\n```';
}

/**
 * Returns a heading in markdown format
 * @param level The level of the heading
 * @param text The text of the heading
 */
function heading(level, text) {
  level = level > 6 ? 6 : level;
  return `${[...Array(level)].map(() => '#').join('')} ${text}`;
}
