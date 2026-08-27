#!/usr/bin/env node
// Validador estrutural das specs e do backlog (spec 0000: INV-0000-01, 02, 03).

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SPECS_DIR = resolve(ROOT, 'specs');
const BACKLOG = resolve(ROOT, 'docs/backlog.md');

const REQUIRED_SECTIONS = [
  'Goal',
  'Scope / Non-goals',
  'Contracts',
  'Invariants',
  'Error cases',
  'Acceptance criteria',
  'Test mapping',
  'Open questions',
];

const VALID_STATUS = ['draft', 'approved', 'implemented', 'superseded'];

const problems = [];
const fail = (file, message) => problems.push(`${file}: ${message}`);

function parseFrontmatter(raw, file) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    fail(file, 'frontmatter YAML ausente (INV-0000-01)');
    return null;
  }
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^(\w+):\s*(.*)$/);
    if (entry) frontmatter[entry[1]] = entry[2].trim();
  }
  return frontmatter;
}

function parseDependsOn(value) {
  if (!value) return [];
  return [...value.matchAll(/"(\d+)"/g)].map((m) => m[1]);
}

const specs = new Map();

if (!existsSync(SPECS_DIR)) {
  console.error('specs/ não encontrado');
  process.exit(1);
}

const specFiles = readdirSync(SPECS_DIR).filter((f) => /^\d{4}-.+\.md$/.test(f));

if (specFiles.length === 0) {
  console.error('nenhuma spec encontrada em specs/');
  process.exit(1);
}

for (const file of specFiles) {
  const raw = readFileSync(join(SPECS_DIR, file), 'utf8');
  const frontmatter = parseFrontmatter(raw, file);
  if (!frontmatter) continue;

  const idFromName = file.slice(0, 4);
  const id = (frontmatter.id ?? '').replace(/"/g, '');

  if (!id) fail(file, 'frontmatter sem "id" (INV-0000-01)');
  else if (id !== idFromName) fail(file, `id "${id}" diverge do nome do arquivo "${idFromName}"`);

  if (!frontmatter.title) fail(file, 'frontmatter sem "title" (INV-0000-01)');

  const status = frontmatter.status;
  if (!VALID_STATUS.includes(status)) {
    fail(file, `status "${status ?? '(ausente)'}" inválido — use ${VALID_STATUS.join(' | ')}`);
  }

  // Seções obrigatórias, na ordem (INV-0000-01).
  const headings = [...raw.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
  let cursor = 0;
  for (const section of REQUIRED_SECTIONS) {
    const found = headings.indexOf(section, cursor);
    if (found === -1) {
      fail(file, `seção obrigatória ausente ou fora de ordem: "${section}" (INV-0000-01)`);
    } else {
      cursor = found + 1;
    }
  }

  // Open questions vazia é pré-requisito de "approved" (AC-0000-03).
  const openQuestions = raw.split(/^##\s+Open questions\s*$/m)[1] ?? '';
  const answered = /^\s*(nenhuma|none)\.?\s*$/i.test(openQuestions.trim());
  if (status === 'approved' && openQuestions.trim() && !answered) {
    fail(file, 'status "approved" com "Open questions" não vazia (AC-0000-03)');
  }

  specs.set(id, { file, dependsOn: parseDependsOn(frontmatter.depends_on) });
}

// depends_on resolve e o grafo é acíclico (INV-0000-03).
for (const [id, { file, dependsOn }] of specs) {
  for (const dependency of dependsOn) {
    if (!specs.has(dependency)) fail(file, `depends_on referencia spec inexistente "${dependency}"`);
  }
  const seen = new Set();
  const walk = (current, path) => {
    if (current === id && path.length > 0) {
      fail(file, `ciclo em depends_on: ${[id, ...path].join(' → ')} (INV-0000-03)`);
      return;
    }
    if (seen.has(current)) return;
    seen.add(current);
    for (const next of specs.get(current)?.dependsOn ?? []) walk(next, [...path, next]);
  };
  for (const dependency of dependsOn) walk(dependency, [dependency]);
}

// Toda tarefa referencia spec existente e ao menos um AC-* ou INV-* (INV-0000-02).
if (existsSync(BACKLOG)) {
  const backlog = readFileSync(BACKLOG, 'utf8').split(/\r?\n/);
  backlog.forEach((line, index) => {
    const task = line.match(/\bT-(\d{4})-(\d{2})\b/);
    if (!task) return;
    const location = `docs/backlog.md:${index + 1}`;
    if (!specs.has(task[1])) {
      fail(location, `tarefa T-${task[1]}-${task[2]} referencia spec inexistente "${task[1]}"`);
    }
    // O bloco da tarefa vai até a próxima tarefa ou linha em branco dupla.
    const block = backlog.slice(index, index + 6).join('\n');
    if (!/\b(AC|INV)-\d{4}-\d{2}\b/.test(block)) {
      fail(location, `tarefa T-${task[1]}-${task[2]} não referencia nenhum AC-* ou INV-* (INV-0000-02)`);
    }
  });
}

if (problems.length > 0) {
  console.error(`\ncheck-specs: ${problems.length} problema(s)\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`check-specs: ${specs.size} spec(s) válida(s).`);
