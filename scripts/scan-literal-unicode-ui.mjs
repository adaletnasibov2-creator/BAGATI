import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots = ["app", "components"];
const escapePattern = /\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})/u;
const matches = [];
const runtimeStringEscapes = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && file.endsWith(".tsx")) scan(file);
  }
}

function scan(file) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isJsxText(node) && escapePattern.test(node.getText(source))) {
      matches.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind: "JSX text", text: node.getText(source).trim() });
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && escapePattern.test(node.initializer.getText(source))) {
      matches.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind: `JSX ${node.name.getText(source)} attribute`, text: node.initializer.getText(source) });
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && escapePattern.test(node.text)) {
      runtimeStringEscapes.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind: "runtime string contains literal escape", text: node.text });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

for (const root of roots) if (fs.existsSync(root)) walk(root);
console.log(JSON.stringify({ scannedRoots: roots, literalUnicodeEscapesInRenderedJsx: matches, runtimeStringsContainingLiteralUnicodeEscapes: runtimeStringEscapes }, null, 2));
if (matches.length || runtimeStringEscapes.length) process.exitCode = 1;
