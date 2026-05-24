# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor.spec.ts >> Editor (Milkdown Crepe) >> navigates to editor route and shows Crepe editor
- Location: e2e\specs\editor.spec.ts:41:2

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.milkdown')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.milkdown')

```

```yaml
- complementary:
  - text: Notes
  - button "Collapse sidebar"
  - navigation:
    - button "Notes"
    - button "Archive"
    - button "Trash"
    - text: Vault No notes yet
  - 'button "Workspace: Editor Test"': Editor Test
- banner: Notes2
- main:
  - textbox:
    - paragraph
```

# Test source

```ts
  1   | import { test, expect } from '../fixtures/test';
  2   | 
  3   | /**
  4   |  * Milkdown / Crepe editor E2E tests.
  5   |  *
  6   |  * These tests define the contract the new editor component must satisfy.
  7   |  * Phase A: RED — no editor yet, all tests fail.
  8   |  * Phase F: GREEN — after implementation, all tests pass.
  9   |  */
  10  | 
  11  | test.describe('Editor (Milkdown Crepe)', () => {
  12  | 	test.beforeEach(async ({ page }) => {
  13  | 		await page.goto('/');
  14  | 		// Verify the test hook is available
  15  | 		const hasHook = await page.evaluate(() => {
  16  | 			return (
  17  | 				typeof (window as unknown as Record<string, unknown>)[
  18  | 					'__KM_TEST__'
  19  | 				] === 'object'
  20  | 			);
  21  | 		});
  22  | 		expect(hasHook).toBe(true);
  23  | 	});
  24  | 
  25  | 	// ──────────── SCENARIO 1: Lazy load gate ────────────
  26  | 	test('Milkdown JS not loaded before navigating to editor route', async ({
  27  | 		page,
  28  | 	}) => {
  29  | 		// Stay on root — no editor route yet
  30  | 		await expect(page.getByText('Welcome')).toBeVisible();
  31  | 		// No Crepe/Milkdown classes on the page
  32  | 		const hasMilkdown = await page.evaluate(() => {
  33  | 			return (
  34  | 				document.querySelector('.milkdown') !== null ||
  35  | 				document.querySelector('.crepe') !== null
  36  | 			);
  37  | 		});
  38  | 		expect(hasMilkdown).toBe(false);
  39  | 	});
  40  | 
  41  | 	test('navigates to editor route and shows Crepe editor', async ({
  42  | 		workspace,
  43  | 		page,
  44  | 	}) => {
  45  | 		await workspace.createStandaloneWorkspace('Editor Test');
  46  | 		await page.goto('/e/test-note');
  47  | 
  48  | 		// The Crepe editor root should be in the DOM
> 49  | 		await expect(page.locator('.milkdown')).toBeVisible({ timeout: 5000 });
      |                                           ^ Error: expect(locator).toBeVisible() failed
  50  | 	});
  51  | 
  52  | 	// ──────────── SCENARIO 2: Content from VaultStore ────────────
  53  | 	test('content from VaultStore appears in editor', async ({
  54  | 		workspace,
  55  | 		page,
  56  | 	}) => {
  57  | 		await workspace.createStandaloneWorkspace('Editor Content Test');
  58  | 		const testContent = '# Hello World\n\nThis is a **test**.';
  59  | 
  60  | 		// Create a file in the vault via the test hook
  61  | 		await page.evaluate(async (content) => {
  62  | 			const km = (
  63  | 				window as unknown as Record<string, unknown>
  64  | 			)['__KM_TEST__'] as {
  65  | 				vaultStore: { createFile: (path: string, content: string) => Promise<void> };
  66  | 			};
  67  | 			await km.vaultStore.createFile('test-note', content);
  68  | 		}, testContent);
  69  | 
  70  | 		// Navigate to the editor
  71  | 		await page.goto('/e/test-note');
  72  | 
  73  | 		// The editor should contain the markdown content
  74  | 		// Milkdown renders markdown as rich text, so "Hello World" should be visible as an H1
  75  | 		await expect(
  76  | 			page.locator('.milkdown h1').getByText('Hello World'),
  77  | 		).toBeVisible({ timeout: 5000 });
  78  | 	});
  79  | 
  80  | 	// ──────────── SCENARIO 3: Auto-save on edit ────────────
  81  | 	test('editing content auto-saves to VaultStore', async ({
  82  | 		workspace,
  83  | 		page,
  84  | 	}) => {
  85  | 		await workspace.createStandaloneWorkspace('Auto-save Test');
  86  | 
  87  | 		// Create a file with initial content
  88  | 		await page.evaluate(async () => {
  89  | 			const km = (
  90  | 				window as unknown as Record<string, unknown>
  91  | 			)['__KM_TEST__'] as {
  92  | 				vaultStore: { createFile: (path: string, content: string) => Promise<void> };
  93  | 			};
  94  | 			await km.vaultStore.createFile('auto-save-note', 'Initial');
  95  | 		});
  96  | 
  97  | 		await page.goto('/e/auto-save-note');
  98  | 		await page.waitForSelector('.milkdown', { timeout: 5000 });
  99  | 
  100 | 		// Type additional content into the editor
  101 | 		// Focus the editor and type
  102 | 		await page.locator('.milkdown').click();
  103 | 		await page.locator('.milkdown .ProseMirror').fill('Updated content');
  104 | 
  105 | 		// Wait for the debounced save
  106 | 		await page.waitForTimeout(1500);
  107 | 
  108 | 		// Check vault store has the updated content
  109 | 		const storedContent = await page.evaluate(async () => {
  110 | 			const km = (
  111 | 				window as unknown as Record<string, unknown>
  112 | 			)['__KM_TEST__'] as {
  113 | 				vaultStore: {
  114 | 					getByPath: (path: string) => { content?: string } | undefined;
  115 | 				};
  116 | 			};
  117 | 			return km.vaultStore.getByPath('auto-save-note')?.content ?? '';
  118 | 		});
  119 | 
  120 | 		expect(storedContent).toContain('Updated content');
  121 | 	});
  122 | 
  123 | 	// ──────────── SCENARIO 4: External vault update → editor refresh ────────────
  124 | 	test('external VaultStore change updates editor content via Slice', async ({
  125 | 		workspace,
  126 | 		page,
  127 | 	}) => {
  128 | 		await workspace.createStandaloneWorkspace('External Update Test');
  129 | 
  130 | 		await page.evaluate(async () => {
  131 | 			const km = (
  132 | 				window as unknown as Record<string, unknown>
  133 | 			)['__KM_TEST__'] as {
  134 | 				vaultStore: { createFile: (path: string, content: string) => Promise<void> };
  135 | 			};
  136 | 			await km.vaultStore.createFile('external-note', 'Original');
  137 | 		});
  138 | 
  139 | 		await page.goto('/e/external-note');
  140 | 		await page.waitForSelector('.milkdown', { timeout: 5000 });
  141 | 
  142 | 		// Now simulate an external vault update
  143 | 		await page.evaluate(async () => {
  144 | 			const km = (
  145 | 				window as unknown as Record<string, unknown>
  146 | 			)['__KM_TEST__'] as {
  147 | 				vaultStore: {
  148 | 					getByPath: (path: string) => { id: string; content?: string } | undefined;
  149 | 					updateFile: (id: string, content: string) => Promise<void>;
```