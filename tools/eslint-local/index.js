import { rule, RULE_NAME } from './max-template-nesting.js';

/**
 * Local ESLint plugin with custom rules for this project.
 * @type {import('eslint').ESLint.Plugin}
 */
const localPlugin = {
	rules: {
		[RULE_NAME]: rule,
	},
};

export default localPlugin;