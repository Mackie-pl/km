# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor.spec.ts >> Editor (Milkdown Crepe) >> switching entryId loads new content
- Location: e2e\specs\editor.spec.ts:257:2

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
        - generic [ref=e31]:
          - button "note-b" [ref=e32] [cursor=pointer]:
            - img [ref=e33]
            - generic [ref=e36]: note-b
          - button "note-a" [ref=e37] [cursor=pointer]:
            - img [ref=e38]
            - generic [ref=e41]: note-a
    - 'button "Workspace: Switch Test" [ref=e43] [cursor=pointer]':
      - generic [ref=e44]: Switch Test
      - img [ref=e45]
  - generic [ref=e48]:
    - banner [ref=e50]:
      - generic [ref=e52]: Notes2
    - main [ref=e53]:
      - textbox [ref=e56]:
        - paragraph [ref=e57]: "# Note A"
```

# Test source

```ts
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
  199 | 					entry.id,
  200 | 					'External base content',
  201 | 				);
  202 | 			}
  203 | 		});
  204 | 
  205 | 		await page.waitForTimeout(500);
  206 | 
  207 | 		// User types new content
  208 | 		await page.locator('.milkdown .ProseMirror').fill('User wrote this');
  209 | 
  210 | 		await page.waitForTimeout(1500);
  211 | 
  212 | 		// Vault should have user content, not external content
  213 | 		const storedContent = await page.evaluate(async () => {
  214 | 			const km = (
  215 | 				window as unknown as Record<string, unknown>
  216 | 			)['__KM_TEST__'] as {
  217 | 				vaultStore: {
  218 | 					getByPath: (path: string) => { content?: string } | undefined;
  219 | 				};
  220 | 			};
  221 | 			return km.vaultStore.getByPath('no-regress-note')?.content ?? '';
  222 | 		});
  223 | 
  224 | 		expect(storedContent).toContain('User wrote this');
  225 | 	});
  226 | 
  227 | 	// ──────────── SCENARIO 6: Cleanup on navigation ────────────
  228 | 	test('editor destroys on navigation away', async ({
  229 | 		workspace,
  230 | 		page,
  231 | 	}) => {
  232 | 		await workspace.createStandaloneWorkspace('Cleanup Test');
  233 | 
  234 | 		await page.evaluate(async () => {
  235 | 			const km = (
  236 | 				window as unknown as Record<string, unknown>
  237 | 			)['__KM_TEST__'] as {
  238 | 				vaultStore: { createFile: (path: string, content: string) => Promise<void> };
  239 | 			};
  240 | 			await km.vaultStore.createFile('cleanup-note', 'Clean me');
  241 | 		});
  242 | 
  243 | 		await page.goto('/e/cleanup-note');
  244 | 		await page.waitForSelector('.milkdown', { timeout: 5000 });
  245 | 
  246 | 		// Navigate away
  247 | 		await page.goto('/settings');
  248 | 
  249 | 		// Editor DOM should be gone
  250 | 		const hasEditor = await page.evaluate(() => {
  251 | 			return document.querySelector('.milkdown') !== null;
  252 | 		});
  253 | 		expect(hasEditor).toBe(false);
  254 | 	});
  255 | 
  256 | 	// ──────────── SCENARIO 7: Switching entries ────────────
  257 | 	test('switching entryId loads new content', async ({
  258 | 		workspace,
  259 | 		page,
  260 | 	}) => {
  261 | 		await workspace.createStandaloneWorkspace('Switch Test');
  262 | 
  263 | 		// Create two notes
  264 | 		await page.evaluate(async () => {
  265 | 			const km = (
  266 | 				window as unknown as Record<string, unknown>
  267 | 			)['__KM_TEST__'] as {
  268 | 				vaultStore: { createFile: (path: string, content: string) => Promise<void> };
  269 | 			};
  270 | 			await km.vaultStore.createFile('note-a', '# Note A');
  271 | 			await km.vaultStore.createFile('note-b', '# Note B');
  272 | 		});
  273 | 
  274 | 		// Navigate to note-a
  275 | 		await page.goto('/e/note-a');
> 276 | 		await page.waitForSelector('.milkdown', { timeout: 5000 });
      |              ^ TimeoutError: page.waitForSelector: Timeout 5000ms exceeded.
  277 | 		await expect(
  278 | 			page.locator('.milkdown h1').getByText('Note A'),
  279 | 		).toBeVisible();
  280 | 
  281 | 		// Navigate to note-b
  282 | 		await page.goto('/e/note-b');
  283 | 		await page.waitForSelector('.milkdown', { timeout: 5000 });
  284 | 		await expect(
  285 | 			page.locator('.milkdown h1').getByText('Note B'),
  286 | 		).toBeVisible();
  287 | 
  288 | 		// Note A content should not be visible
  289 | 		await expect(
  290 | 			page.locator('.milkdown h1').getByText('Note A'),
  291 | 		).not.toBeVisible();
  292 | 	});
  293 | });
```