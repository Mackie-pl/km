import { Routes } from '@angular/router';
import { SettingsComponent } from '@ui/pages/settings/settings.component';
import { WorkspaceConfig } from '@ui/pages/workspace-config/workspace-config';
import { WorkspaceWizardComponent } from '@ui/pages/workspace-config/workspace-wizard.component';
import { Empty } from '@ui/pages/empty/empty';
import { filePathMatcher } from '@core/utils/route-matchers';
import { entryExistsGuard } from '@core/utils/entry-exists.guard';

export const routes: Routes = [
	{
		path: 'settings',
		component: SettingsComponent,
	},
	{
		path: 'workspace',
		component: WorkspaceConfig,
	},
	{
		path: 'workspace/new',
		component: WorkspaceWizardComponent,
	},
	{
		matcher: filePathMatcher,
		canMatch: [entryExistsGuard],
		loadComponent: () =>
			import('@ui/pages/editor/editor').then((m) => m.Editor),
	},
	{
		path: '**',
		component: Empty,
	},
];
