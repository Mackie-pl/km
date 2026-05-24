/**
 * Tauri 2.0 API mock for Playwright E2E tests.
 *
 * Injected via addInitScript so it runs before Angular bootstraps.
 * Overrides window.__TAURI_INTERNALS__, window.__TAURI__,
 * and window.showDirectoryPicker so the app behaves as if running
 * inside a Tauri desktop shell without an actual Rust backend.
 *
 * This file is plain JavaScript — it's injected raw into the browser.
 */
(function mockTauriApis() {
	if (typeof window === 'undefined') return;

	// Signal to TestFsAdapter that we're in an E2E test environment.
	// This flag is checked by TestFsAdapter.isAvailable() — without it,
	// TestFsAdapter doesn't activate, letting the real adapter (Tauri / Browser FS)
	// be picked by getWorkspacePickerAdapter() during dev.
	try {
		sessionStorage.setItem('KM_E2E_TEST', 'true');
	} catch {
		// sessionStorage may not be available in some test environments
	}

	// ----------------------------
	// 1. Tauri runtime detection
	// ----------------------------

	var MOCKED_TAURI = {
		invoke: mockInvoke,
		menu: {
			Menu: {
				new: async function () {
					return { append: async function () {} };
				},
			},
			MenuItem: {
				new: async function () {
					return {};
				},
			},
			Submenu: {
				new: async function () {
					return { append: async function () {} };
				},
			},
		},
	};

	Object.defineProperty(window, '__TAURI_INTERNALS__', {
		value: MOCKED_TAURI,
		writable: false,
	});

	Object.defineProperty(window, '__TAURI__', {
		value: MOCKED_TAURI,
		writable: false,
	});

	// ----------------------------
	// 2. invoke() routing
	// ----------------------------

	var invokeHandlers = new Map([
		[
			'get_platform',
			function () {
				return 'windows';
			},
		],
		[
			'pick_workspace_folder',
			function () {
				return { path: 'C:\\Users\\test\\notes' };
			},
		],
	]);

	function mockInvoke(cmd) {
		var handler = invokeHandlers.get(cmd);
		if (!handler) {
			return Promise.reject(
				new Error("[E2E Mock] invoke('" + cmd + "') not mocked"),
			);
		}
		return Promise.resolve(handler(cmd));
	}

	// Expose so test fixtures can override handlers dynamically
	window.__tauriMockSetInvokeHandler = function (cmd, handler) {
		invokeHandlers.set(cmd, handler);
	};

	// ----------------------------
	// 3. showDirectoryPicker mock
	// ----------------------------

	var directoryHandleMock = {
		name: 'PlaywrightTestVault',
		kind: 'directory',
		values: (function () {
			var files = [
				{ name: 'note-one.md', kind: 'file' },
				{ name: 'note-two.md', kind: 'file' },
				{ name: 'subfolder', kind: 'directory' },
			];
			var index = 0;
			return function () {
				return {
					next: function () {
						var done = index >= files.length;
						var value = done ? undefined : files[index];
						index++;
						return { done: done, value: value };
					},
				};
			};
		})(),
		getFileHandle: async function () {
			return {
				getFile: async function () {
					return new File(['# Test content'], 'note-one.md', {
						type: 'text/markdown',
					});
				},
				createWritable: async function () {
					return {
						write: async function () {},
						close: async function () {},
					};
				},
			};
		},
		getDirectoryHandle: async function () {
			return directoryHandleMock;
		},
		removeEntry: async function () {},
		queryPermission: async function () {
			return 'granted';
		},
		requestPermission: async function () {
			return 'granted';
		},
	};

	// Always override showDirectoryPicker — even if the browser has a real
	// implementation, our mock guarantees deterministic E2E test behaviour.
	window.showDirectoryPicker = async function (options) {
		return directoryHandleMock;
	};
})();
