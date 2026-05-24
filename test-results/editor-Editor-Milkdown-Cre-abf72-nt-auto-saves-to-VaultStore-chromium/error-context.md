# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor.spec.ts >> Editor (Milkdown Crepe) >> editing content auto-saves to VaultStore
- Location: e2e\specs\editor.spec.ts:81:2

# Error details

```
TimeoutError: page.waitForSelector: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('.milkdown') to be visible

```

# Page snapshot

```yaml
- generic [ref=e5]:
  - complementary [ref=e7]:
    - generic [ref=e8]:
      - generic [ref=e9]: Notes
      - button "Collapse sidebar" [ref=e10] [cursor=pointer]:
        - img [ref=e11]
    - navigation [ref=e13]:
      - button "Notes" [ref=e14] [cursor=pointer]:
        - img [ref=e15]
        - generic [ref=e18]: Notes
      - button "Archive" [ref=e19] [cursor=pointer]:
        - img [ref=e20]
        - generic [ref=e23]: Archive
      - button "Trash" [ref=e24] [cursor=pointer]:
        - img [ref=e25]
        - generic [ref=e28]: Trash
      - generic [ref=e29]:
        - generic [ref=e30]: Vault
        - button "auto-save-note" [ref=e32] [cursor=pointer]:
          - img [ref=e33]
          - generic [ref=e36]: auto-save-note
    - 'button "Workspace: Auto-save Test" [ref=e38] [cursor=pointer]':
      - generic [ref=e39]: Auto-save Test
      - img [ref=e40]
  - generic [ref=e43]:
    - banner [ref=e45]:
      - generic [ref=e47]: Notes2
    - main [ref=e48]:
      - textbox [ref=e51]:
        - paragraph [ref=e52]: Initial
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
  49  | 		await expect(page.locator('.milkdown')).toBeVisible({ timeout: 5000 });
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
> 98  | 		await page.waitForSelector('.milkdown', { timeout: 5000 });
      |              ^ TimeoutError: page.waitForSelector: Timeout 5000ms exceeded.
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
  150 | 				};
  151 | 			};
  152 | 			const entry = km.vaultStore.getByPath('external-note');
  153 | 			if (entry) {
  154 | 				await km.vaultStore.updateFile(entry.id, '## Updated Externally');
  155 | 			}
  156 | 		});
  157 | 
  158 | 		// Wait for editor to react to the change
  159 | 		await page.waitForTimeout(1000);
  160 | 
  161 | 		// The editor should now display the new content
  162 | 		await expect(
  163 | 			page.locator('.milkdown h2').getByText('Updated Externally'),
  164 | 		).toBeVisible({ timeout: 3000 });
  165 | 	});
  166 | 
  167 | 	// ──────────── SCENARIO 5: No regress on concurrent edit ────────────
  168 | 	test('edit after external change does not regress', async ({
  169 | 		workspace,
  170 | 		page,
  171 | 	}) => {
  172 | 		await workspace.createStandaloneWorkspace('No Regress Test');
  173 | 
  174 | 		await page.evaluate(async () => {
  175 | 			const km = (
  176 | 				window as unknown as Record<string, unknown>
  177 | 			)['__KM_TEST__'] as {
  178 | 				vaultStore: { createFile: (path: string, content: string) => Promise<void> };
  179 | 			};
  180 | 			await km.vaultStore.createFile('no-regress-note', 'Base content');
  181 | 		});
  182 | 
  183 | 		await page.goto('/e/no-regress-note');
  184 | 		await page.waitForSelector('.milkdown', { timeout: 5000 });
  185 | 
  186 | 		// Simulate external update
  187 | 		await page.evaluate(async () => {
  188 | 			const km = (
  189 | 				window as unknown as Record<string, unknown>
  190 | 			)['__KM_TEST__'] as {
  191 | 				vaultStore: {
  192 | 					getByPath: (path: string) => { id: string; content?: string } | undefined;
  193 | 					updateFile: (id: string, content: string) => Promise<void>;
  194 | 				};
  195 | 			};
  196 | 			const entry = km.vaultStore.getByPath('no-regress-note');
  197 | 			if (entry) {
  198 | 				await km.vaultStore.updateFile(
```