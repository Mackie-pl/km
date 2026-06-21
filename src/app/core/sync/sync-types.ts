import type { Adapter } from '@core/adapters/adapter.interface';

export interface ActiveAdapterEntry {
	adapter: Adapter;
	root: string | undefined;
}
