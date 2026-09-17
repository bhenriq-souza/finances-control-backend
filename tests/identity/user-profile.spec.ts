import 'reflect-metadata';
import { USER_PROFILES, isUserProfile } from '../../src/identity/user-profile';

describe('UserProfile', () => {
    it('tem exatamente os três perfis do produto', () => {
        expect(USER_PROFILES).toEqual(['ADMIN', 'BILLER', 'VIEWER']);
    });

    it.each([...USER_PROFILES])('reconhece %s', (profile) => {
        expect(isUserProfile(profile)).toBe(true);
    });

    it.each(['admin', 'OWNER', '', null, undefined, 3, {}])('recusa %p', (value) => {
        expect(isUserProfile(value)).toBe(false);
    });
});
