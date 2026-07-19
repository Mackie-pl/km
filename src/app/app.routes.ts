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
		path: 'vault',
		loadComponent: () =>
			import('@ui/pages/vault/vault-browser').then(
				(m) => m.VaultBrowserComponent,
			),
	},
	{
		path: 'activity',
		loadComponent: () =>
			import('@ui/pages/activity/activity').then((m) => m.Activity),
	},
	{
		path: 'archive',
		loadComponent: () =>
			import('@ui/pages/archive/archive').then((m) => m.Archive),
	},
	{
		path: 'agent/:agentId',
		loadComponent: () =>
			import('@ui/pages/agent-detail/agent-detail').then(
				(m) => m.AgentDetail,
			),
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
