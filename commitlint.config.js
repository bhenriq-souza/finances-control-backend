/**
 * Verificação local de INV-0001-02: todo commit rastreia até uma tarefa ou spec.
 * As regras abaixo são a tradução literal da spec 0001 (convenção de mensagem de
 * commit) — não afrouxe nenhuma delas para fazer um commit passar.
 */

/** Tipos permitidos pela spec 0001. */
const TYPES = ['feat', 'fix', 'docs', 'test', 'refactor', 'chore', 'ci'];

/** Escopo = módulo tocado (ADR-0003), mais os escopos transversais do repositório. */
const SCOPES = [
    'identity',
    'accounts',
    'expenses',
    'statements',
    'earnings',
    'reporting',
    'imports',
    'platform',
    'specs',
    'workflow',
];

/**
 * Rodapé `Task:`. Aceita o ID do backlog (`T-0003-01`), o ID da issue de entrega
 * para trabalho fora do backlog (`FCB-006`) e `misc`, exatamente como a spec 0001
 * define para o `task-id` do nome da branch.
 */
const TASK_FOOTER = /^Task: (T-\d{4}-\d{2}|FCB-\d+|misc)$/m;

module.exports = {
    extends: ['@commitlint/config-conventional'],
    plugins: [
        {
            rules: {
                'task-footer': (parsed) => [
                    TASK_FOOTER.test(parsed.raw ?? ''),
                    'a mensagem precisa do rodapé "Task: <T-xxxx-yy | FCB-nn | misc>" (INV-0001-02)',
                ],
            },
        },
    ],
    rules: {
        'type-enum': [2, 'always', TYPES],
        'scope-enum': [2, 'always', SCOPES],
        // A spec 0001 fixa o cabeçalho em 72 caracteres; o preset traz 100.
        'header-max-length': [2, 'always', 72],
        'task-footer': [2, 'always'],
    },
};
