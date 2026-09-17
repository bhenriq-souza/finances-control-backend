import 'reflect-metadata';
import { USER_PROFILES, isUserProfile } from '../../src/platform/authorization';

describe('vocabulário de autorização da plataforma', () => {
    it('tem exatamente os três perfis do produto', () => {
        expect(USER_PROFILES).toEqual(['ADMIN', 'BILLER', 'VIEWER']);
    });

    it.each([...USER_PROFILES])('reconhece %s', (profile) => {
        expect(isUserProfile(profile)).toBe(true);
    });

    it.each(['admin', 'OWNER', '', null, undefined, 3, {}])('recusa %p', (value) => {
        expect(isUserProfile(value)).toBe(false);
    });

    it('o identity reexporta a mesma definição, sem uma segunda fonte de verdade', async () => {
        const identity = await import('../../src/identity/user-profile');

        expect(identity.USER_PROFILES).toBe(USER_PROFILES);
        expect(identity.isUserProfile).toBe(isUserProfile);
    });
});
