// dotenv precisa rodar antes de qualquer import que toque no container,
// porque o container resolve variáveis de ambiente já na carga do módulo.
if (process.env.NODE_ENV === 'local') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config({ path: '.env.local' });
}

(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { App } = require('./app') as typeof import('./app');

    const app = new App().build();
    const port = Number(process.env.SERVER_PORT);

    app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`finances-control-backend listening on ${port}`);
    });
})();
