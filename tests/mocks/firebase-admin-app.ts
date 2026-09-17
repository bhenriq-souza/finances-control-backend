/**
 * Stub de `firebase-admin/app` para a suíte. Mapeado em `jest.config.ts`, ele
 * garante que nenhum teste carregue o SDK de verdade — o que, além de honrar
 * INV-0010-07, evita que o Jest tenha de parsear as dependências ESM que o
 * `firebase-admin` arrasta.
 */
export type App = { name: string };

export const apps: App[] = [];

export const cert = jest.fn((serviceAccount: unknown) => ({ serviceAccount }));

export const getApps = jest.fn((): App[] => apps);

export const initializeApp = jest.fn((options: unknown, name: string): App => {
    const app = { name, options } as App;
    apps.push(app);

    return app;
});

export const resetApps = (): void => {
    apps.length = 0;
    cert.mockClear();
    getApps.mockClear();
    initializeApp.mockClear();
};
