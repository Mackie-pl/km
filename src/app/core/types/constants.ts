export const DEVICE_TYPE = {
	ANDROID: 'android',
	WINDOWS: 'windows',
	LINUX: 'linux',
	WEB: 'web',
} as const;

export type DeviceType = (typeof DEVICE_TYPE)[keyof typeof DEVICE_TYPE];

export const PLATFORM = {
	ANDROID: 'android',
	WINDOWS: 'windows',
	LINUX: 'linux',
	UNKNOWN: 'unknown',
} as const;

export type Platform = (typeof PLATFORM)[keyof typeof PLATFORM];

export const THEME = {
	LIGHT: 'light',
	DARK: 'dark',
	SYSTEM: 'system',
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

export const STORAGE_KEY = {
	THEME: 'app-theme',
	SETTINGS: 'app-settings',
} as const;
