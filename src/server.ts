// dotenv precisa rodar antes de qualquer import que toque no container,
// porque o container resolve variáveis de ambiente já na carga do módulo.
if (process.env.NODE_ENV === 'local') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config({ path: '.env.local' });
}

(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { App } = require('./app') as typeof import('./app');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { container } = require('./container') as typeof import('./container');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const platform = require('./platform') as typeof import('./platform');

    const logger = container.resolve<import('@bhs-dev/typescript-common-types').ILogger>(
        platform.LoggerServiceSymbol,
    );
    const jobs = container.resolve<import('./platform/jobs/job-queue').JobsLifecycle>(
        platform.JobQueueSymbol,
    );

    // Banco fora no boot não derruba o pod: o readiness reconecta (ERR-0003-02).
    try {
        await platform.initializeDataSource();
    } catch (error) {
        logger.error('database unavailable at boot', {
            error: error instanceof Error ? error.message : String(error),
        });
    }

    // Depois do DataSource; falha vira `checks.jobs: down` e o processo segue (ERR-0017-06).
    await jobs.start();

    const app = new App().build();
    const port = Number(process.env.SERVER_PORT);

    const server = app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`finances-control-backend listening on ${port}`);
    });

    const shutdown = (): void => {
        server.close();
        void jobs.stop().finally(() => process.exit(0));
    };

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
})();
