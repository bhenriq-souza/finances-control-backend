#!/usr/bin/env node
// Orquestrador único dos portões de qualidade (spec 0002).
// O CI invoca este script e nada mais — nunca reimplemente um gate lá.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRE_TOOLS = process.argv.includes('--require-tools');
const ROOT = resolve(import.meta.dirname, '..');

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';

/**
 * Cada gate declara como decidir se pode rodar. `available` retorna null quando
 * o gate está apto, ou o motivo do SKIP quando não está.
 */
const GATES = [
    {
        name: 'format',
        command: ['npx', 'prettier', '--check', '.'],
        available: () => needsDevDep('prettier'),
    },
    {
        name: 'lint',
        command: ['npx', 'eslint', '.'],
        available: () => needsDevDep('eslint'),
    },
    {
        name: 'types',
        command: ['npx', 'tsc', '--noEmit'],
        available: () => needsDevDep('typescript') ?? needsFile('tsconfig.json'),
    },
    {
        name: 'boundaries',
        command: ['npx', 'depcruise', 'src'],
        available: () =>
            needsDevDep('dependency-cruiser') ??
            needsFile('.dependency-cruiser.cjs') ??
            needsFile('src'),
    },
    {
        name: 'test',
        command: ['npx', 'jest', '--coverage'],
        available: () => needsDevDep('jest') ?? needsFile('tests'),
    },
    {
        name: 'audit',
        command: ['npm', 'audit', '--audit-level=high', '--omit=dev'],
        available: () => needsFile('package-lock.json'),
    },
    {
        name: 'specs',
        command: ['node', 'scripts/check-specs.mjs'],
        available: () => needsFile('scripts/check-specs.mjs'),
    },
];

function readManifest() {
    const path = resolve(ROOT, 'package.json');
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        console.error(`package.json ilegível: ${error.message}`);
        return null;
    }
}

const manifest = readManifest();

function needsDevDep(name) {
    if (!manifest) return 'package.json ainda não existe (scaffold pendente — FCB-002)';
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    if (!declared[name]) return `${name} não está declarado no package.json`;
    if (!existsSync(resolve(ROOT, 'node_modules', name))) {
        return `${name} declarado mas não instalado (rode npm ci)`;
    }
    return null;
}

function needsFile(relativePath) {
    return existsSync(resolve(ROOT, relativePath))
        ? null
        : `${relativePath} ainda não existe neste repositório`;
}

function runGate(gate) {
    const reason = gate.available();
    if (reason) {
        return { name: gate.name, status: SKIP, reason };
    }

    const [command, ...args] = gate.command;
    const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });

    if (result.error) {
        return { name: gate.name, status: FAIL, reason: result.error.message };
    }
    return result.status === 0
        ? { name: gate.name, status: PASS, reason: '' }
        : { name: gate.name, status: FAIL, reason: `código de saída ${result.status}` };
}

console.log(
    `\nPortões de qualidade — spec 0002${REQUIRE_TOOLS ? ' (modo estrito: SKIP conta como falha)' : ''}\n`,
);

const results = [];
for (const gate of GATES) {
    console.log(`\n──────── ${gate.name} ────────`);
    const result = runGate(gate);
    if (result.status === SKIP) console.log(`SKIP: ${result.reason}`);
    results.push(result);
}

const width = Math.max(...results.map((r) => r.name.length));
console.log('\n\nResumo\n');
for (const { name, status, reason } of results) {
    console.log(`  ${name.padEnd(width)}  ${status}${reason ? `  — ${reason}` : ''}`);
}

const failed = results.filter((r) => r.status === FAIL);
const skipped = results.filter((r) => r.status === SKIP);
const blocking = REQUIRE_TOOLS ? [...failed, ...skipped] : failed;

console.log('');
if (blocking.length === 0) {
    console.log(
        `Tudo verde (${results.length - skipped.length} executados, ${skipped.length} pulados).`,
    );
    process.exit(0);
}

if (REQUIRE_TOOLS && skipped.length > 0) {
    console.error(
        `Modo estrito: ${skipped.length} gate(s) pulado(s) — o CI exige todos disponíveis (INV-0002-05).`,
    );
}
console.error(`Bloqueando: ${blocking.map((r) => r.name).join(', ')}`);
process.exit(1);
