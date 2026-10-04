// SPDX-FileCopyrightText: giwt Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Flags functions with >= 3 positional parameters. The giwt convention is to
 * take a single destructured options object instead — see AGENTS.md,
 * "Code Conventions" → "Options-object parameters".
 *
 * Ported from loop-lore's `options-object-params` ESLint rule; semantics
 * match it exactly:
 *
 * - `AssignmentPattern` is unwrapped before counting: `b = 1` counts as one
 *   positional param, but `{ c, d } = {}` is an options object with a default
 *   and does not count.
 * - A leading TypeScript `this` parameter (an `Identifier` named `this`) is
 *   not a real argument and is excluded from the count.
 * - Functions whose arity is pinned by a type annotation are skipped (the
 *   options-object rewrite would break assignability): typed-const slots
 *   (`const f: T = (a, b, c) => {}`) and typed-object-literal slots (an
 *   object-literal method whose shape is annotation-dictated).
 * - Class members need no special handling: `MethodDefinition.value` /
 *   `PropertyDefinition.value` are traversed as ordinary function nodes, so a
 *   dedicated member visitor would double-report them.
 */

// See loop-lore `options-object-params.mjs`: ObjectPattern (an options
// object) and RestElement (`...rest`) are deliberately excluded — a rest
// element is not itself a positional param — but a function with 3+ other
// positional params is still flagged. TSParameterProperty is excluded too:
// parameter properties cannot be destructured.
const POSITIONAL_PARAM_TYPES = {
  Identifier: true,
  ArrayPattern: true,
};

function isTypedConstSlot(node) {
  // `const f: T = (a, b, c) => {}`
  const d = node.parent;
  return d?.type === "VariableDeclarator" && d.init === node
    && d.id.type === "Identifier" && d.id.typeAnnotation != null;
}

function isTypedObjectLiteralSlot(node) {
  const prop = node.parent;
  if (prop?.type !== "Property" || prop.value !== node) {
    return false;
  }
  const literal = prop.parent;
  if (literal?.type !== "ObjectExpression") {
    return false;
  }
  const slot = literal.parent;
  if (slot?.type === "VariableDeclarator" && slot.init === literal) {
    return slot.id.type === "Identifier" && slot.id.typeAnnotation != null;
  }
  if (slot?.type !== "ReturnStatement" || slot.argument !== literal) {
    return false;
  }
  const block = slot.parent;
  const fn = block?.parent;
  return block?.type === "BlockStatement" && "returnType" in (fn ?? {})
    && fn.returnType != null;
}

function checkFunction(context, node) {
  if (isTypedConstSlot(node) || isTypedObjectLiteralSlot(node)) {
    return;
  }
  // Skip declarations without a body (overloads, `declare`, abstract methods).
  if (!node.body) {
    return;
  }
  // A TypeScript `this` parameter is an Identifier named "this" and is not
  // a real argument; exclude it so it cannot inflate the positional count.
  const params = node.params[0]?.type === "Identifier"
      && node.params[0]?.name === "this"
    ? node.params.slice(1)
    : node.params;
  // Unwrap defaults before counting: `b = 1` is one positional param, but
  // `{ c, d } = {}` is an options object and must not inflate the count.
  const positional = params.filter((param) => {
    const binding = param.type === "AssignmentPattern" ? param.left : param;
    return POSITIONAL_PARAM_TYPES[binding.type] === true;
  });
  if (positional.length >= 3) {
    context.report({
      node,
      message:
        "Function has 3 or more positional parameters; use a single destructured options object instead (see AGENTS.md, Code Conventions: Options-object parameters).",
    });
  }
}

export default {
  meta: { name: "giwt-style" },
  rules: {
    "options-object-params": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Require an options object for functions with 3+ positional parameters",
        },
      },
      create(context) {
        return {
          FunctionDeclaration: (node) => checkFunction(context, node),
          FunctionExpression: (node) => checkFunction(context, node),
          ArrowFunctionExpression: (node) => checkFunction(context, node),
        };
      },
    },
  },
};
