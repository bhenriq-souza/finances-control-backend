// Executado antes de cada suíte: o container resolve variáveis de ambiente já na
// carga do módulo, então elas precisam existir antes de qualquer import de src/.
process.env.APPLICATION_NAME = 'finances-control-backend';
process.env.APPLICATION_VERSION = '0.0.0-test';
process.env.ENV = 'test';
process.env.SERVER_PORT = '3000';
process.env.LOG_LEVEL = 'error';
// Sem senha de propósito: nenhuma credencial é versionada, nem em teste (INV-0003-07).
process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgres://finances_test@localhost:5433/finances_test';
// Credenciais de mentira: nenhum teste fala com o Firebase — a porta TokenVerifier
// existe justamente para isso (INV-0010-07).
process.env.FIREBASE_PROJECT_ID = 'finances-test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
