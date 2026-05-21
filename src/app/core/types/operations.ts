import { type DeviceType, VAULT_OPERATION_TYPE } from './constants';

export type VaultOperation =
	| WriteFileOperation
	| DeleteFileOperation
	| RenameFileOperation;

interface BaseOperation {
	id: string;
	timestamp: number;
	deviceId: string;
	deviceType: DeviceType;
	synced: boolean;
}

export interface WriteFileOperation extends BaseOperation {
	type: typeof VAULT_OPERATION_TYPE.WRITE_FILE;
	path: string;
	content: string;
}

export interface DeleteFileOperation extends BaseOperation {
	type: typeof VAULT_OPERATION_TYPE.DELETE_FILE;
	path: string;
}

export interface RenameFileOperation extends BaseOperation {
	type: typeof VAULT_OPERATION_TYPE.RENAME_FILE;
	from: string;
	to: string;
}
