// SPDX-FileCopyrightText: giwt Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Flags functions with >= 3 positional parameters. The giwt convention is to
 * take a single destructured options object instead — see AGENTS.md,
 * "Code Conventions" → "Options-object parameters".
 */

const POSITIONAL_TYPES = new Set(["Identifier", "AssignmentPattern", "ArrayPattern"]);

function countPositional(params) {
  return params.filter((param) => POSITIONAL_TYPES.has(param.type)).length;
}

function checkFunction(context, node) {
  // Skip declarations without a body (overloads, `declare`, abstract methods).
  if (!node.body) {
    return;
  }
  if (node.params.length >= 3 && countPositional(node.params) >= 3) {
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
          MethodDefinition: (node) => checkFunction(context, node.value),
          PropertyDefinition: (node) => checkFunction(context, node.value),
        };
      },
    },
  },
};
