#!/usr/bin/env node
// Gate `sast` (spec 0002): análise estática de segurança do código com o Semgrep CE.
// Roda pela imagem oficial, com a versão fixada abaixo, para que o resultado seja o mesmo
// local e no CI. Sem Docker, usa o `semgrep` instalado na máquina.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const SEMGREP_VERSION = '1.179.0';

/** Pacotes de regras do registro do Semgrep; mudar a lista exige mudar a spec 0002. */
const RULESETS = ['p/javascript', 'p/typescript', 'p/nodejs', 'p/expressjs', 'p/secrets'];

const TARGETS = ['src', 'scripts'];

const ARGS = [
    'scan',
    '--metrics=off',
    '--error',
    '--severity=ERROR',
    '--severity=WARNING',
    ...RULESETS.map((ruleset) => `--config=${ruleset}`),
    ...TARGETS,
];

function hasCommand(command) {
    return !spawnSync(command, ['--version'], { stdio: 'ignore' }).error;
}

function run(command, args) {
    const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
    if (result.error) {
        console.error(`falha ao executar ${command}: ${result.error.message}`);
        return 1;
    }
    return result.status ?? 1;
}

const IMAGE = `semgrep/semgrep:${SEMGREP_VERSION}`;

process.exit(
    hasCommand('docker')
        ? run('docker', [
              'run',
              '--rm',
              '-v',
              `${ROOT}:/src`,
              '-w',
              '/src',
              IMAGE,
              'semgrep',
              ...ARGS,
          ])
        : run('semgrep', ARGS),
);
