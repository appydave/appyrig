// G06 expression shape: David's ruling of 12 Nov 2026 on the expression sample, in place of sonarjs/expression-complexity.
// 1. A run of one logical operator (all && or all ||) is fine, however long: a flat guard chain reads as a list.
// 2. Conditional markup in JSX is not scored: {a && <X />} and {a ? <X /> : <Y />}.
// 3. A ternary nested inside another expression is flagged: an operand of && / || / ?? (x || (a ? b : c)),
//    the test of another ternary ((a ? b : c) ? d : e), or a ladder used as any operand (n + (a ? 1 : b ? 2 : 3)).
//    A ladder used whole (const v = a ? 1 : b ? 2 : 3, or a return) is fine, and so is one plain ternary in
//    arithmetic or a comparison (n + (a ? 1 : 0)).
// 4. && mixed with || is flagged when the two sit on one line with no brackets around the inner one.
// One finding per outermost expression. Its message carries the operator count (&&, ||, ??, ?:), which
// the scores gate (lint/gates/scores.mjs) freezes so a baselined expression cannot grow.

const OPERAND_PARENTS = new Set(['LogicalExpression', 'BinaryExpression', 'UnaryExpression']);
const EXPRESSION_PARENTS = new Set([...OPERAND_PARENTS, 'ConditionalExpression']);
const TERNARY = 'ConditionalExpression';
const COUNTED = new Set(['LogicalExpression', 'ConditionalExpression']);
const FUNCTIONS = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration']);
const JSX = new Set(['JSXElement', 'JSXFragment']);
const OTHER_CHAIN = { '&&': '||', '||': '&&' };

const MESSAGES = {
  nestedTernary:
    'Ternary used inside another expression ({{count}} operators). Name it: move it into a const or a small helper.',
  mixedChain:
    '&& mixed with || on one line without brackets ({{count}} operators). Bracket the inner group, put it on its own line, or name it as a boolean.',
};

const isJsx = (node) => JSX.has(node?.type);

/** A ternary is markup when either branch is JSX: point 2. */
const isMarkupTernary = (node) => isJsx(node.consequent) || isJsx(node.alternate);

const isLadder = (node) => node.consequent.type === TERNARY || node.alternate.type === TERNARY;

/** Where the ternary sits: the test of another ternary, an operand of && / || / ??, or a ladder as any operand. */
function sitsInsideExpression(node) {
  const { parent } = node;

  if (parent.type === TERNARY) {
    return parent.test === node;
  }

  return (
    parent.type === 'LogicalExpression' || (OPERAND_PARENTS.has(parent.type) && isLadder(node))
  );
}

/** Point 3, with point 2's markup left out. */
const isNestedTernary = (node) => !isMarkupTernary(node) && sitsInsideExpression(node);

function operatorToken(sourceCode, node) {
  return sourceCode.getFirstTokenBetween(node.left, node.right, (t) => t.value === node.operator);
}

/** A left operand is bracketed when a ")" follows it; a right operand when a "(" precedes it. */
function isBracketed({ sourceCode, child, side }) {
  const token =
    side === 'left' ? sourceCode.getTokenAfter(child) : sourceCode.getTokenBefore(child);

  return token?.value === (side === 'left' ? ')' : '(');
}

/** Point 4 for one side of an && or || node: the other operator, unbracketed, on the same line. */
function mixesOnOneLine({ sourceCode, node, side }) {
  const child = node[side];
  const mixed = child.type === 'LogicalExpression' && child.operator === OTHER_CHAIN[node.operator];

  if (
    !mixed ||
    isJsx(node.right) ||
    isJsx(child.right) ||
    isBracketed({ sourceCode, child, side })
  ) {
    return false;
  }

  return (
    operatorToken(sourceCode, node).loc.start.line ===
    operatorToken(sourceCode, child).loc.start.line
  );
}

function isMixedChain(sourceCode, node) {
  if (!(node.operator in OTHER_CHAIN)) {
    return false;
  }

  return ['left', 'right'].some((side) => mixesOnOneLine({ sourceCode, node, side }));
}

/** The outermost operator expression around the node, so one expression gives one finding. */
function rootOf(node) {
  let root = node;

  while (EXPRESSION_PARENTS.has(root.parent?.type)) {
    root = root.parent;
  }

  return root;
}

/** How many &&, ||, ?? and ?: the expression holds, not looking inside functions. */
function operatorCount(node, visitorKeys) {
  if (!node || typeof node.type !== 'string' || FUNCTIONS.has(node.type)) {
    return 0;
  }

  const own = COUNTED.has(node.type) ? 1 : 0;
  const children = (visitorKeys[node.type] ?? []).flatMap((key) => [node[key]].flat());

  return own + children.reduce((sum, child) => sum + operatorCount(child, visitorKeys), 0);
}

export const expressionShape = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'G06: no ternary inside another expression, no unbracketed && / || mix on one line',
    },
    schema: [],
    messages: MESSAGES,
  },
  create(context) {
    const { sourceCode } = context;
    const reported = new Set();

    const report = (node, messageId) => {
      const root = rootOf(node);

      if (reported.has(root)) {
        return;
      }

      reported.add(root);

      const count = operatorCount(root, sourceCode.visitorKeys);

      context.report({ node: root, messageId, data: { count: String(count) } });
    };

    return {
      ConditionalExpression(node) {
        if (isNestedTernary(node)) {
          report(node, 'nestedTernary');
        }
      },
      LogicalExpression(node) {
        if (isMixedChain(sourceCode, node)) {
          report(node, 'mixedChain');
        }
      },
    };
  },
};
