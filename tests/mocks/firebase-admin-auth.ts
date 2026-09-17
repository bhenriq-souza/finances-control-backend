import type { App } from './firebase-admin-app';

/** Stub de `firebase-admin/auth`; ver `firebase-admin-app.ts`. */
export const verifyIdToken = jest.fn();

export const getAuth = jest.fn((app: App) => ({
    app,
    verifyIdToken,
}));
