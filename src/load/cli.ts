import { runCli } from './main';

/* Entrada do `npm run load:initial` (spec 0019); a lógica e os testes ficam em `main.ts`. */
void runCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
}).then(
    (code) => {
        process.exitCode = code;
    },
    (failure: unknown) => {
        process.stderr.write(
            `${failure instanceof Error ? (failure.stack ?? failure.message) : String(failure)}\n`,
        );
        process.exitCode = 1;
    },
);
