import { Parser } from 'htmlparser2';

/**
 * Parse a Lit html`` template string to extract child custom element usage.
 *
 * Lit templates use special attribute prefixes:
 *   .prop=${expr}  — property binding
 *   @event=${expr} — event listener
 *   ?bool=${expr}  — boolean attribute
 *
 * These are not valid HTML so we normalize them before parsing, then
 * reverse the mapping on the extracted attributes.
 *
 * @param {string} templateString - Reconstituted template with __LIT_EXPR_N__
 *   placeholders where expressions were.
 * @returns {TemplateUsage[]}
 */
export function parseTemplate(templateString) {
  /** @type {TemplateUsage[]} */
  const usages = [];

  // Normalize Lit-specific attribute prefixes so htmlparser2 can parse them.
  const normalized = templateString
    .replace(/\.([a-zA-Z_][\w-]*)=/g, 'data-litprop-$1=')
    .replace(/@([a-zA-Z_][\w-]*)=/g, 'data-litevent-$1=')
    .replace(/\?([a-zA-Z_][\w-]*)=/g, 'data-litbool-$1=');

  const parser = new Parser({
    onopentag(tagName, attributes) {
      // Custom elements must contain a hyphen per the HTML spec.
      if (!tagName.includes('-')) return;

      const propBindings = [];
      const eventBindings = [];
      const boolBindings = [];
      const attrs = [];

      for (const [key, value] of Object.entries(attributes)) {
        if (key.startsWith('data-litprop-')) {
          propBindings.push(key.replace('data-litprop-', '.'));
        } else if (key.startsWith('data-litevent-')) {
          eventBindings.push(key.replace('data-litevent-', '@'));
        } else if (key.startsWith('data-litbool-')) {
          boolBindings.push(key.replace('data-litbool-', '?'));
        } else {
          attrs.push({ name: key, value });
        }
      }

      usages.push({
        tagName,
        propBindings,
        eventBindings,
        boolBindings,
        attributes: attrs,
      });
    },
  }, { lowerCaseTags: true, lowerCaseAttributeNames: false });

  parser.write(normalized);
  parser.end();

  return usages;
}

/**
 * Reconstitute a template string from Babel's TemplateLiteral quasis,
 * inserting numbered placeholders for each expression.
 *
 * @param {import('@babel/types').TemplateLiteral} templateLiteral
 * @returns {string}
 */
export function reconstitute(templateLiteral) {
  const quasis = templateLiteral.quasis;
  let result = '';

  for (let i = 0; i < quasis.length; i++) {
    result += quasis[i].value.raw;
    if (i < quasis.length - 1) {
      result += `__LIT_EXPR_${i}__`;
    }
  }

  return result;
}

/**
 * @typedef {object} TemplateUsage
 * @property {string} tagName
 * @property {string[]} propBindings  - e.g. ['.signal', '.ticker']
 * @property {string[]} eventBindings - e.g. ['@click', '@change']
 * @property {string[]} boolBindings  - e.g. ['?hidden']
 * @property {{ name: string, value: string }[]} attributes
 */
