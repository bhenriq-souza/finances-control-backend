import { runCli } from './main';

/* Entrada do `npm run load:initial` (spec 0019); a lógica e os testes ficam em `main.ts`. */
process.exitCode = runCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
});
