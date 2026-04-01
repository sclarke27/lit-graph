import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { dirname, resolve } from 'node:path';
import { parseTemplate, reconstitute } from './template-parser.js';

// Handle CJS/ESM interop for @babel/traverse
const traverse = _traverse.default || _traverse;

/**
 * Parse a single source file and extract Lit component metadata.
 *
 * Returns an array because a file may define multiple custom elements
 * (or none — in which case the array is empty).
 *
 * @param {string} filePath - Absolute path to the source file.
 * @param {string} source   - File contents.
 * @returns {ComponentInfo[]}
 */
export function parseLitComponents(filePath, source) {
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');

  const plugins = [
    'classProperties',
    'classStaticBlock',
    ['decorators', { decoratorsBeforeExport: true }],
  ];
  if (isTS) {
    plugins.push('typescript');
  } else {
    plugins.push('jsx');
  }

  let ast;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins,
    });
  } catch {
    // File may not be parseable (e.g. invalid syntax). Skip silently.
    return [];
  }

  const fileDir = dirname(filePath);

  // Collect all class-level data keyed by class name.
  /** @type {Map<string, ComponentInfo>} */
  const classMap = new Map();

  // Also track customElements.define() calls to associate tag → class.
  /** @type {Map<string, string>} */
  const defineCallMap = new Map(); // className → tagName

  // Collect imports for the file.
  /** @type {ImportInfo[]} */
  const imports = [];

  traverse(ast, {
    // ── Imports ──────────────────────────────────────────────────
    ImportDeclaration(path) {
      const src = path.node.source.value;
      const specifiers = path.node.specifiers.map((s) => {
        if (t.isImportDefaultSpecifier(s)) return { kind: 'default', name: s.local.name };
        if (t.isImportNamespaceSpecifier(s)) return { kind: 'namespace', name: s.local.name };
        return { kind: 'named', name: s.local.name };
      });
      const isRelative = src.startsWith('.');
      imports.push({
        source: src,
        specifiers,
        isSideEffect: specifiers.length === 0,
        resolvedPath: isRelative ? resolve(fileDir, src) : null,
      });
    },

    // ── Class declarations ──────────────────────────────────────
    ClassDeclaration(path) {
      processClass(path, classMap, filePath);
    },
    ClassExpression(path) {
      processClass(path, classMap, filePath);
    },

    // ── customElements.define('tag', Class) ─────────────────────
    CallExpression(path) {
      const { callee, arguments: args } = path.node;

      // customElements.define(...)
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'customElements' }) &&
        t.isIdentifier(callee.property, { name: 'define' }) &&
        args.length >= 2 &&
        t.isStringLiteral(args[0]) &&
        t.isIdentifier(args[1])
      ) {
        defineCallMap.set(args[1].name, args[0].value);
      }
    },
  });

  // Merge defineCallMap into classMap for classes that didn't have a decorator.
  for (const [className, tagName] of defineCallMap) {
    const info = classMap.get(className);
    if (info && !info.tagName) {
      info.tagName = tagName;
    }
  }

  // Attach shared imports and filter to only classes that are custom elements.
  const results = [];
  for (const info of classMap.values()) {
    if (!info.tagName) continue; // Not a registered custom element — skip.
    info.imports = imports;
    results.push(info);
  }

  return results;
}

/**
 * Process a class declaration/expression node and extract Lit metadata.
 *
 * @param {import('@babel/traverse').NodePath} path
 * @param {Map<string, ComponentInfo>} classMap
 * @param {string} filePath
 */
function processClass(path, classMap, filePath) {
  const node = path.node;
  const className = node.id ? node.id.name : null;
  if (!className) return;

  // Check if it extends LitElement (or any *Element base class).
  if (!extendsLitElement(node)) return;

  /** @type {ComponentInfo} */
  const info = {
    tagName: null,
    className,
    filePath,
    properties: [],
    internalState: [],
    eventsDispatched: [],
    templateUsages: [],
    imports: [],
  };

  // Extract tag name from @customElement('tag') decorator.
  info.tagName = extractCustomElementDecorator(node);

  // Walk the class body.
  for (const member of node.body.body) {
    // ── @property / @state decorators ──────────────────────────
    if (t.isClassProperty(member) || t.isClassAccessorProperty(member)) {
      const propInfo = extractDecoratorProperty(member);
      if (propInfo) {
        if (propInfo.isState) {
          info.internalState.push({ name: propInfo.name, type: propInfo.type });
        } else {
          info.properties.push({
            name: propInfo.name,
            type: propInfo.type,
            attribute: propInfo.attribute,
          });
        }
        continue;
      }

      // ── static properties = { ... } (Lit 2 pattern) ──────────
      if (member.static && isNamedProperty(member, 'properties')) {
        extractStaticProperties(member, info);
        continue;
      }
    }

    // ── static get properties() { return { ... } } ─────────────
    if (
      t.isClassMethod(member) &&
      member.static &&
      member.kind === 'get' &&
      isNamedMethod(member, 'properties')
    ) {
      extractStaticGetterProperties(member, info);
      continue;
    }

    // ── Methods: look for html`` templates and dispatchEvent ────
    if (t.isClassMethod(member) || t.isClassProperty(member)) {
      extractFromMethod(member, info);
    }
  }

  classMap.set(className, info);
}

// ── Helper: check if class extends LitElement ─────────────────────

function extendsLitElement(classNode) {
  const superClass = classNode.superClass;
  if (!superClass) return false;
  if (t.isIdentifier(superClass)) {
    // Direct: class Foo extends LitElement
    // Also match common base classes like *Element, *Base
    return superClass.name.includes('Element') || superClass.name.includes('Lit');
  }
  if (t.isMemberExpression(superClass)) {
    // e.g. Lit.LitElement — unlikely but handle it.
    return t.isIdentifier(superClass.property) && superClass.property.name.includes('Element');
  }
  return false;
}

// ── Helper: extract @customElement('tag') ─────────────────────────

function extractCustomElementDecorator(classNode) {
  const decorators = classNode.decorators;
  if (!decorators) return null;

  for (const dec of decorators) {
    const expr = dec.expression;
    if (
      t.isCallExpression(expr) &&
      t.isIdentifier(expr.callee, { name: 'customElement' }) &&
      expr.arguments.length >= 1 &&
      t.isStringLiteral(expr.arguments[0])
    ) {
      return expr.arguments[0].value;
    }
  }
  return null;
}

// ── Helper: extract @property / @state from class property ────────

function extractDecoratorProperty(member) {
  const decorators = member.decorators;
  if (!decorators || decorators.length === 0) return null;

  for (const dec of decorators) {
    const expr = dec.expression;

    // @state()
    if (
      (t.isCallExpression(expr) && t.isIdentifier(expr.callee, { name: 'state' })) ||
      t.isIdentifier(expr, { name: 'state' })
    ) {
      return {
        name: getMemberName(member.key),
        type: null,
        isState: true,
        attribute: false,
      };
    }

    // @property({ type: String, attribute: false })
    if (
      t.isCallExpression(expr) &&
      t.isIdentifier(expr.callee, { name: 'property' })
    ) {
      const options = expr.arguments[0];
      let type = null;
      let attribute = true;

      if (t.isObjectExpression(options)) {
        for (const prop of options.properties) {
          if (!t.isObjectProperty(prop)) continue;
          const key = getMemberName(prop.key);
          if (key === 'type' && t.isIdentifier(prop.value)) {
            type = prop.value.name;
          }
          if (key === 'attribute' && t.isBooleanLiteral(prop.value)) {
            attribute = prop.value.value;
          }
        }
      }

      return {
        name: getMemberName(member.key),
        type,
        isState: false,
        attribute,
      };
    }

    // @property (no call, just identifier)
    if (t.isIdentifier(expr, { name: 'property' })) {
      return {
        name: getMemberName(member.key),
        type: null,
        isState: false,
        attribute: true,
      };
    }
  }

  return null;
}

// ── Helper: extract from static properties = { ... } ─────────────

function extractStaticProperties(member, info) {
  const value = member.value;
  if (!t.isObjectExpression(value)) return;

  for (const prop of value.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const name = getMemberName(prop.key);
    if (!name) continue;

    let type = null;
    let attribute = true;
    let isState = false;

    if (t.isObjectExpression(prop.value)) {
      for (const opt of prop.value.properties) {
        if (!t.isObjectProperty(opt)) continue;
        const optKey = getMemberName(opt.key);
        if (optKey === 'type' && t.isIdentifier(opt.value)) type = opt.value.name;
        if (optKey === 'attribute' && t.isBooleanLiteral(opt.value)) attribute = opt.value.value;
        if (optKey === 'state' && t.isBooleanLiteral(opt.value)) isState = opt.value.value;
      }
    }

    if (isState) {
      info.internalState.push({ name, type });
    } else {
      info.properties.push({ name, type, attribute });
    }
  }
}

// ── Helper: extract from static get properties() { return {...} } ─

function extractStaticGetterProperties(member, info) {
  const body = member.body;
  if (!body || !body.body) return;

  for (const stmt of body.body) {
    if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
      // Reuse the same extraction logic with a synthetic member.
      extractStaticProperties({ value: stmt.argument }, info);
      break;
    }
  }
}

// ── Helper: walk method body for html`` and dispatchEvent ─────────

function extractFromMethod(member, info) {
  const nodesToWalk = [];

  if (t.isClassMethod(member) && member.body) {
    nodesToWalk.push(member.body);
  }
  if (t.isClassProperty(member) && member.value) {
    nodesToWalk.push(member.value);
  }

  for (const node of nodesToWalk) {
    // Use a simple recursive walk instead of a full traverse
    // (we're already inside a traverse, and nesting them can be tricky).
    walkNode(node, {
      TaggedTemplateExpression(n) {
        if (t.isIdentifier(n.tag, { name: 'html' })) {
          const templateStr = reconstitute(n.quasi);
          const usages = parseTemplate(templateStr);
          info.templateUsages.push(...usages);
        }
      },
      CallExpression(n) {
        // this.dispatchEvent(new CustomEvent('event-name', ...))
        if (
          t.isMemberExpression(n.callee) &&
          t.isThisExpression(n.callee.object) &&
          t.isIdentifier(n.callee.property, { name: 'dispatchEvent' }) &&
          n.arguments.length >= 1
        ) {
          const arg = n.arguments[0];
          if (
            t.isNewExpression(arg) &&
            t.isIdentifier(arg.callee, { name: 'CustomEvent' }) &&
            arg.arguments.length >= 1 &&
            t.isStringLiteral(arg.arguments[0])
          ) {
            info.eventsDispatched.push(arg.arguments[0].value);
          }
        }
      },
    });
  }
}

// ── Simple recursive AST walker ───────────────────────────────────

function walkNode(node, visitors) {
  if (!node || typeof node !== 'object') return;

  if (node.type && visitors[node.type]) {
    visitors[node.type](node);
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key.startsWith('_') || key === 'start' || key === 'end' || key === 'loc') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && item.type) {
          walkNode(item, visitors);
        }
      }
    } else if (child && typeof child === 'object' && child.type) {
      walkNode(child, visitors);
    }
  }
}

// ── Tiny helpers ──────────────────────────────────────────────────

function getMemberName(key) {
  if (t.isIdentifier(key)) return key.name;
  if (t.isStringLiteral(key)) return key.value;
  return null;
}

function isNamedProperty(member, name) {
  return t.isIdentifier(member.key, { name }) || t.isStringLiteral(member.key, { value: name });
}

function isNamedMethod(member, name) {
  return t.isIdentifier(member.key, { name });
}

/**
 * @typedef {object} ComponentInfo
 * @property {string|null} tagName
 * @property {string|null} className
 * @property {string} filePath
 * @property {{ name: string, type: string|null, attribute: boolean }[]} properties
 * @property {{ name: string, type: string|null }[]} internalState
 * @property {string[]} eventsDispatched
 * @property {import('./template-parser.js').TemplateUsage[]} templateUsages
 * @property {ImportInfo[]} imports
 */

/**
 * @typedef {object} ImportInfo
 * @property {string} source
 * @property {{ kind: string, name: string }[]} specifiers
 * @property {boolean} isSideEffect
 * @property {string|null} resolvedPath
 */
