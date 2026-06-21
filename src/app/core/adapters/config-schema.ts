/**
 * Schema-driven adapter configuration forms.
 *
 * Each non-local adapter type defines a schema describing what fields
 * its config form needs. The schema is consumed by
 * AdapterConfigFormComponent to render dynamic forms without writing
 * a new component per adapter type.
 */

/** A single form field in an adapter config form. */
export interface ConfigField {
	/** Unique key within the schema — maps directly to the AdapterConfig property. */
	key: string;
	/** Human-readable label shown above the input. */
	label: string;
	/** Input type — determines the rendered control. */
	type: 'text' | 'password' | 'number';
	/** Placeholder text inside the input. */
	placeholder: string;
	/** Whether this field must be filled before saving. */
	required: boolean;
	/** Optional default value when creating a new config. */
	defaultValue?: string | number;
}

/** Schema definition for a single adapter type. */
export interface AdapterConfigSchema {
	adapterId: string;
	label: string;
	description: string;
	/** Lucide icon name used in the UI (e.g. 'cloud', 'github'). */
	icon: string;
	fields: ConfigField[];
}

const GIT_SCHEMA: AdapterConfigSchema = {
	adapterId: 'git',
	label: 'Git',
	description: 'Sync notes via a remote Git repository',
	icon: 'cloud',
	fields: [
		{
			key: 'repoUrl',
			label: 'Repository URL',
			type: 'text',
			placeholder: 'https://github.com/user/repo.git',
			required: true,
		},
		{
			key: 'branch',
			label: 'Branch',
			type: 'text',
			placeholder: 'main',
			required: false,
			defaultValue: 'main',
		},
		{
			key: 'token',
			label: 'Personal Access Token',
			type: 'password',
			placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
			required: true,
		},
		{
			key: 'authorName',
			label: 'Author Name',
			type: 'text',
			placeholder: 'Your Name',
			required: true,
		},
		{
			key: 'authorEmail',
			label: 'Author Email',
			type: 'text',
			placeholder: 'you@example.com',
			required: true,
		},
		{
			key: 'pollIntervalMs',
			label: 'Poll Interval (ms)',
			type: 'number',
			placeholder: '30000',
			required: false,
			defaultValue: 30000,
		},
	],
};

const GDRIVE_SCHEMA: AdapterConfigSchema = {
	adapterId: 'gdrive',
	label: 'Google Drive',
	description: 'Sync notes across devices via Google Drive',
	icon: 'cloud',
	fields: [
		{
			key: 'path',
			label: 'Folder ID or Path',
			type: 'text',
			placeholder: 'folder-id-or-path',
			required: true,
		},
	],
};

const SCHEMAS: Record<string, AdapterConfigSchema> = {
	git: GIT_SCHEMA,
	gdrive: GDRIVE_SCHEMA,
};

/** Look up the config schema for a given adapter ID. */
export function getAdapterSchema(
	adapterId: string,
): AdapterConfigSchema | undefined {
	return SCHEMAS[adapterId];
}
