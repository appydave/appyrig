/**
 * Stable names for frozen findings: `<function path>` for a function-level finding and
 * `<function path>>expr` for an expression, with `#2`, `#3` for repeats of the same name in one file.
 * A line number is never part of a key, so editing above a function does not move its entry.
 * The function path is the chain of enclosing function names; an anonymous one is `callback`.
 */
import ts from 'typescript';

const FILE_LEVEL = '(file)';
const EXPRESSION_RULE = 'sonarjs/expression-complexity';

function scriptKind(file) {
  if (file.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }

  return /\.(ts|mts|cts)$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

const NAME_HOLDERS = [ts.isVariableDeclaration, ts.isPropertyAssignment, ts.isPropertyDeclaration];

/** The declaration an anonymous function is assigned to (`const f = () => {}`), if any. */
const assignedTo = (node) => (NAME_HOLDERS.some((is) => is(node.parent)) ? node.parent : undefined);

/** The name a function is declared or assigned under, or null for an anonymous one. */
function declaredName(node, source) {
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }

  const holder = node.name ? node : assignedTo(node);

  return holder?.name ? holder.name.getText(source) : null;
}

/** The chain of enclosing function names, outermost first: `buildFlow>callback`. */
function pathOf(node, source) {
  const names = [];

  for (let at = node; at; at = at.parent) {
    if (ts.isFunctionLike(at)) {
      names.unshift(declaredName(at, source) ?? 'callback');
    }
  }

  return names.join('>') || FILE_LEVEL;
}

/** The innermost function-like node that contains the position, or undefined at file level. */
function innermostFunction(source, position) {
  let found;
  const visit = (node) => {
    if (position < node.getStart(source) || position >= node.end) {
      return;
    }

    found = ts.isFunctionLike(node) ? node : found;
    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

function baseKey(finding, source) {
  if (finding.ruleId === 'max-lines') {
    return FILE_LEVEL;
  }

  const position = source.getPositionOfLineAndCharacter(finding.line - 1, finding.column - 1);
  const base = pathOf(innermostFunction(source, position), source);

  return finding.ruleId === EXPRESSION_RULE ? `${base}>expr` : base;
}

/**
 * Keys for the findings of one file, in the order given: `[{ ruleId, line, column }]` -> `['name', 'name#2']`.
 * Repeats of one name under one rule are numbered in source order.
 */
export function keysFor({ file, text, findings }) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const inSourceOrder = findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => a.finding.line - b.finding.line || a.finding.column - b.finding.column);
  const seen = new Map();
  const keys = [];

  for (const { finding, index } of inSourceOrder) {
    const base = baseKey(finding, source);
    const slot = `${finding.ruleId}\u0000${base}`;
    const nth = (seen.get(slot) ?? 0) + 1;

    seen.set(slot, nth);
    keys[index] = nth === 1 ? base : `${base}#${nth}`;
  }

  return keys;
}
