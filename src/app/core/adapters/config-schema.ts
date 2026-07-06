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
	/**
	 * Input type — determines the rendered control. `folder-picker` renders a
	 * button that opens an adapter-specific folder browser instead of a text box.
	 */
	type: 'text' | 'password' | 'number' | 'folder-picker';
	/** Placeholder text inside the input. */
	placeholder: string;
	/** Whether this field must be filled before saving. */
	required: boolean;
	/** Optional default value when creating a new config. */
	defaultValue?: string | number;
	/**
	 * When true, the field is hidden while ADDING an adapter and only shown when
	 * editing an existing one — for tuning knobs that should default on creation
	 * (e.g. the Drive poll interval).
	 */
	editOnly?: boolean;
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
	description:
		'Sync notes to a Google Drive folder. Saving opens Google sign-in; ' +
		'an existing folder is reused, otherwise one is created.',
	icon: 'cloud',
	fields: [
		{
			key: 'path',
			label: 'Folder',
			type: 'folder-picker',
			placeholder: 'Choose folder…',
			required: true,
		},
		{
			key: 'pollIntervalMs',
			label: 'Poll Interval (ms)',
			type: 'number',
			placeholder: '30000',
			required: false,
			defaultValue: 30000,
			editOnly: true,
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
