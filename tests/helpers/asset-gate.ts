/**
 * Precise shipped-asset assertions.
 *
 * The gate these replace rejected any bundle whose bytes contained `import `,
 * `export `, `require(`, or `process.`. Those substrings are a *proxy* for the
 * real rule — the shipped classic asset must not load modules, evaluate code,
 * or reach the host at runtime — and the proxy rejected inert library text: a
 * `console.warn` string that names the plugin a developer should import.
 *
 * These helpers assert the capability itself by parsing the shipped bytes, so a
 * diagnostic message can never fail the gate and a real dynamic import can
 * never pass it.
 */
import ts from "typescript";

export type AssetFinding = {
  /** The forbidden capability the parse found. */
  kind: string;
  /** 1-based line in the scanned source. */
  line: number;
  /** The offending expression, bounded. */
  text: string;
};

const LOADERS = new Set(["importScripts", "require"]);

/**
 * Every capability the shipped asset must not have: static or dynamic module
 * loading, host loaders, `import.meta`, and dynamic code evaluation. String
 * contents and comments are not inspected — only executable syntax.
 */
export function forbiddenCapabilities(
  source: string,
  filename: string,
): AssetFinding[] {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const findings: AssetFinding[] = [];
  const add = (node: ts.Node, kind: string): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    findings.push({
      kind,
      line: line + 1,
      text: node.getText(file).slice(0, 80),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node, "static-module-syntax");
    } else if (ts.isImportEqualsDeclaration(node)) {
      add(node, "static-module-syntax");
    } else if (
      node.kind === ts.SyntaxKind.ImportKeyword &&
      node.parent !== undefined &&
      ts.isCallExpression(node.parent)
    ) {
      add(node.parent, "dynamic-import");
    } else if (
      ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      add(node, "import-meta");
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      LOADERS.has(node.expression.text)
    ) {
      add(node, "host-loader-call");
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "eval"
    ) {
      add(node, "dynamic-code-eval");
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Function"
    ) {
      add(node, "dynamic-code-eval");
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return findings;
}

/** The calendar/clock calls Inspector's own browser code never makes. */
export function calendarFree(source: string, filename: string): boolean {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      found = node.expression.text === "Date";
      if (found) return;
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "Date") {
        found = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Date"
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return !found;
}
