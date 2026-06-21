/**
 * @import { Rule } from 'eslint'
 */

export const RULE_NAME = 'max-template-nesting';
export const MESSAGE_ID = 'maxTemplateNesting';

/**
 * All AST node types from `@angular-eslint/template-parser` that represent
 * nesting constructs (HTML elements + control flow blocks + ng-template).
 *
 * @see `KEYS` in `node_modules/@angular-eslint/template-parser/dist/index.js`
 */
const NESTING_TYPES = new Set([
	'Element',
	'IfBlock',
	'IfBlockBranch',
	'ForLoopBlock',
	'ForLoopBlockEmpty',
	'SwitchBlock',
	'SwitchBlockCaseGroup',
	'DeferredBlock',
	'DeferredBlockLoading',
	'DeferredBlockError',
	'DeferredBlockPlaceholder',
	'Content',
]);

/**
 * Rule that enforces a maximum nesting depth for elements and control-flow
 * blocks in Angular templates.
 * @type {Rule.RuleModule}
 */
export const rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Enforces a maximum nesting depth for elements and control-flow blocks in Angular templates.',
			category: 'Best Practices',
			recommended: false,
		},
		schema: [
			{
				type: 'object',
				properties: {
					max: {
						type: 'number',
						minimum: 1,
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			[MESSAGE_ID]:
				'HTML nesting depth of {{current}} exceeds the maximum allowed depth of {{max}}.',
		},
	},

	create(context) {
		const options = context.options[0] || {};
		const maxDepth = options.max || 5;
		let currentDepth = 0;

		return {
			// Enter any nesting-producing node
			'*'(/** @type {any} */ node) {
				if (NESTING_TYPES.has(node.type)) {
					currentDepth++;

					if (currentDepth > maxDepth) {
						context.report({
							node,
							messageId: MESSAGE_ID,
							data: {
								current: String(currentDepth),
								max: String(maxDepth),
							},
						});
					}
				}
			},

			'*:exit'(/** @type {any} */ node) {
				if (NESTING_TYPES.has(node.type)) {
					currentDepth--;
				}
			},
		};
	},
};
