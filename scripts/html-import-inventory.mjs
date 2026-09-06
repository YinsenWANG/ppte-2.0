#!/usr/bin/env node
// Static import/export/require/dynamic-import inventory; computed imports are reported,
// never presented as resolved. No module is executed. Run from the repository root.
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const files = execFileSync('git', ['ls-files', 'packages', 'apps'], { encoding: 'utf8' }).trim().split('\n').filter(f => /\.(ts|tsx|mjs|js)$/.test(f));
const options = { moduleResolution: ts.ModuleResolutionKind.NodeNext, module: ts.ModuleKind.NodeNext, allowJs: true };
const edges = [], computed = [];
for (const file of files) {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = node => {
    let value;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) value = node.moduleSpecifier;
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      value = node.arguments[0];
      if (!value || !ts.isStringLiteralLike(value)) computed.push({ from: file, expression: node.getText(ast) });
    }
    if (value && ts.isStringLiteralLike(value)) {
      const specifier = value.text;
      const resolved = ts.resolveModuleName(specifier, resolve(file), options, ts.sys).resolvedModule;
      edges.push({ from: file, specifier, to: resolved ? relative(process.cwd(), resolved.resolvedFileName) : null, typeOnly: Boolean(node.isTypeOnly || node.importClause?.isTypeOnly) });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
const reachable = new Set(), queue = ['apps/cli/index.ts'];
while (queue.length) {
  const file = queue.pop(); if (reachable.has(file)) continue; reachable.add(file);
  for (const edge of edges.filter(e => e.from === file && !e.typeOnly && e.to && !e.to.startsWith('node_modules'))) queue.push(edge.to);
}
const manifests = execFileSync('git', ['ls-files', '*package.json'], { encoding: 'utf8' }).trim().split('\n').filter(f => !f.includes('node_modules'));
console.log(JSON.stringify({ basisCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'tracked apps/packages source; static edges include type-only markers; dynamic expressions and non-source assets need separate review',
  sourceFiles: files.length, edges, computed, cliReachable: [...reachable].sort(),
  packageManifests: manifests.map(path => ({ path, ...JSON.parse(readFileSync(path, 'utf8')) })) }, null, 2));
