import { describe, it, expect } from 'vitest';
import { GDriveTokenStore, type GDriveTokenSet } from '../token-store';

const SET: GDriveTokenSet = {
	accessToken: 'access-123',
	expiresAt: 1_900_000_000_000,
};

describe('GDriveTokenStore', () => {
	it('round-trips a token set', async () => {
		const store = new GDriveTokenStore();
		await store.set(SET);
		expect(await store.get()).toEqual(SET);
	});

	it('returns null before anything is stored', async () => {
		const store = new GDriveTokenStore();
		expect(await store.get()).toBeNull();
	});

	it('clears the token set', async () => {
		const store = new GDriveTokenStore();
		await store.set(SET);
		await store.clear();
		expect(await store.get()).toBeNull();
	});

	it('keeps accounts independent', async () => {
		const store = new GDriveTokenStore();
		await store.set(SET, 'a');
		await store.set({ ...SET, accessToken: 'other' }, 'b');
		expect((await store.get('a'))?.accessToken).toBe('access-123');
		expect((await store.get('b'))?.accessToken).toBe('other');
	});
});
