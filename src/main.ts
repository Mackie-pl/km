import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from '@ui/app.component';
import { WorkspaceService } from '@services/workspace.service';
import { VaultStore } from '@vault/store';
import { SyncEngineService } from '@core/sync/sync-engine';
import { TestFsAdapter } from '@core/adapters/test-fs.adapter';

bootstrapApplication(AppComponent, appConfig)
	.then((ref) => {
		// Expose Angular services for E2E tests
		// Only active in dev/test builds — stripped in prod via tree-shaking
		// because nothing references __KM_TEST__ in application code.
		(window as unknown as Record<string, unknown>)['__KM_TEST__'] = {
			workspaceService: ref.injector.get(WorkspaceService),
			vaultStore: ref.injector.get(VaultStore),
			syncEngine: ref.injector.get(SyncEngineService),
			getTestAdapters: () => TestFsAdapter.getInstances(),
			/** Simulate an external change on the first TestFsAdapter */
			simulateExternalChange: (
				type: 'create' | 'modify' | 'delete',
				path: string,
				content?: string,
			) => {
				const adapters = TestFsAdapter.getInstances();
				if (adapters.length > 0 && adapters[0]) {
					adapters[0].simulateExternalChange(type, path, content);
				}
			},
		};
	})
	.catch((err: unknown) => {
		console.error(err);
	});
