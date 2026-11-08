import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const excluded = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", ".turbo"]);
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", ".md", ".prisma", ".sql"]);
const markers = new Set(["\u00c3", "\u00c2", "\u00c4", "\u00c5", "\u00c6", "\u00c7", "\u00d0", "\u00d1", "\u00d8", "\u00de", "\u00c9", "\u00ef", "\ufffd"]);
const strongMojibake = /[\u00c3\u00c2\u00c4\u00c5\u00c6\u00d0\u00d1\u00d8\u00de][\u0080-\u00ff\u0192\u2122\u0178]|\u00c9\u2122|\u00ef\u00bf\u00bd/u;
const decoder = new TextDecoder("windows-1252");
const byteByChar = new Map();
for (let byte = 0; byte < 256; byte++) byteByChar.set(decoder.decode(Uint8Array.of(byte)), byte);

function markerScore(value) {
  let score = 0;
  for (const char of value) if (markers.has(char)) score++;
  return score;
}

function repairRun(run) {
  let current = run;
  for (let pass = 0; pass < 4 && markerScore(current) > 0; pass++) {
    const bytes = [];
    for (const char of current) {
      const byte = byteByChar.get(char);
      if (byte === undefined) return current;
      bytes.push(byte);
    }
    let decoded;
    try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)); }
    catch { return current; }
    if (decoded === current || markerScore(decoded) >= markerScore(current)) return current;
    current = decoded;
  }
  return current;
}

function repairText(value) {
  let output = "";
  let changed = false;
  for (let start = 0; start < value.length;) {
    if (!byteByChar.has(value[start])) { output += value[start++]; continue; }
    let end = start + 1;
    while (end < value.length && byteByChar.has(value[end])) end++;
    const run = value.slice(start, end);
    const repaired = repairRun(run);
    output += repaired;
    if (repaired !== run) changed = true;
    start = end;
  }
  return { value: output, changed };
}

function hasSuspiciousQuestionMark(value) {
  return value.split(/\s+/u).some((token) => {
    // URL/query fragments legitimately contain embedded question marks.
    if (/[/:=]/u.test(token)) return false;
    return /(?:\p{L}\?\p{L}|\?\p{L}{2,})/u.test(token);
  });
}

if (process.argv.includes("--self-test")) {
  const validAzerbaijani = "Ə ə, Ğ ğ, İ i ı, Ö ö, Ş ş, Ü ü, Ç ç";
  const malformedLabel = "İctimai g" + String.fromCharCode(63) + "r" + String.fromCharCode(63) + "n" + String.fromCharCode(63) + "rl" + String.fromCharCode(63) + "k";
  if (hasSuspiciousQuestionMark(validAzerbaijani) || !hasSuspiciousQuestionMark(malformedLabel)) {
    throw new Error("Azerbaijani localization scanner self-test failed");
  }
}

function textRanges(sourceFile) {
  const ranges = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node)) ranges.push([node.getStart(sourceFile) + 1, node.end - 1]);
    else if (ts.isJsxText(node)) ranges.push([node.getStart(sourceFile), node.end]);
    else if (ts.isNoSubstitutionTemplateLiteral(node)) ranges.push([node.getStart(sourceFile) + 1, node.end - 1]);
    else if (ts.isTemplateHead(node)) ranges.push([node.getStart(sourceFile) + 1, node.end - 2]);
    else if (ts.isTemplateMiddle(node)) ranges.push([node.getStart(sourceFile) + 1, node.end - 2]);
    else if (ts.isTemplateTail(node)) ranges.push([node.getStart(sourceFile) + 1, node.end - 1]);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return ranges;
}

function sourceRepairs(file, content) {
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(path.extname(file).toLowerCase())) {
    const repaired = repairText(content);
    return repaired.changed ? [{ start: 0, end: content.length, text: repaired.value }] : [];
  }
  const scriptKind = file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : file.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const edits = [];
  for (const [start, end] of textRanges(parsed)) {
    const before = content.slice(start, end);
    const after = repairText(before);
    if (after.changed) edits.push({ start, end, text: after.value });
  }
  return edits;
}

function visit(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith(".next")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(full, files);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

const fix = process.argv.includes("--fix");
const files = visit(root);
const changed = [];
const unresolved = [];
const invalidUtf8 = [];
const suspiciousQuestionMarks = [];
for (const file of files) {
  const bytes = fs.readFileSync(file);
  let content;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { invalidUtf8.push(path.relative(root, file)); continue; }
  const edits = sourceRepairs(file, content);
  let result = content;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  if (fix) fs.writeFileSync(file, result, "utf8");
  if (edits.length) changed.push({ file: path.relative(root, file), textSegments: edits.length });
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(path.extname(file).toLowerCase())) {
    const parsed = ts.createSourceFile(file, result, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const [start, end] of textRanges(parsed)) {
      const fragment = result.slice(start, end);
      if (strongMojibake.test(fragment)) unresolved.push({ file: path.relative(root, file), codePoints: [...fragment.match(strongMojibake)[0]].map(char => `U+${char.codePointAt(0).toString(16).toUpperCase()}`) });
      if (hasSuspiciousQuestionMark(fragment)) suspiciousQuestionMarks.push({ file: path.relative(root, file), marker: "embedded-question-mark" });
    }
  } else {
    if (strongMojibake.test(result)) unresolved.push({ file: path.relative(root, file), codePoints: [...result.match(strongMojibake)[0]].map(char => `U+${char.codePointAt(0).toString(16).toUpperCase()}`) });
    if (hasSuspiciousQuestionMark(result)) suspiciousQuestionMarks.push({ file: path.relative(root, file), marker: "embedded-question-mark" });
  }
}

console.log(JSON.stringify({ mode: fix ? "fix" : "scan", filesScanned: files.length, filesWithRecoverableMojibake: changed.length, unresolvedMojibakeText: unresolved, suspiciousQuestionMarks, invalidUtf8, changed }, null, 2));
if (!fix && (changed.length > 0 || unresolved.length > 0 || suspiciousQuestionMarks.length > 0 || invalidUtf8.length > 0)) process.exitCode = 1;
