import { Routes } from '@angular/router';
import { SettingsComponent } from '@ui/pages/settings/settings.component';
import { WorkspaceConfig } from '@ui/pages/workspace-config/workspace-config';
import { WorkspaceWizardComponent } from '@ui/pages/workspace-config/workspace-wizard.component';
import { Empty } from '@ui/pages/empty/empty';
import { Editor } from '@ui/pages/editor/editor';

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
		path: 'e/**',
		component: Editor,
	},
	{
		path: '**',
		component: Empty,
	},
];
