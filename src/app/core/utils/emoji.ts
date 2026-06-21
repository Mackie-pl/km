/**
 * Check whether a string is a single emoji character.
 *
 * Matches any codepoint from the main Unicode emoji ranges, including
 * skin-tone modifiers, ZWJ sequences (e.g. 👨‍👩‍👧, 🏳️‍🌈), and
 * variation selector-16 (️) which turns text-glyphs into emoji-style.
 *
 * This is intentionally lenient — we want to accept any emoji the user types
 * or pastes, even if it's not in our predefined catalog.
 */
export function isEmoji(text: string): boolean {
	if (!text || text.length > 8) return false;
	const single = text.trim();

	// Must match at least one emoji codepoint.  The full range is broad;
	// we cover the most common "Emoji_Presentation" and "Extended_Pictographic"
	// blocks rather than importing a 300 KB Unicode database.
	return /^(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\u00A9|\u00AE|\u203C|\u2049|\u2122|\u2139|\u2194-\u2199|\u21A9|\u21AA|\u231A|\u231B|\u2328|\u23CF|\u23E9-\u23F3|\u23F8-\u23FA|\u24C2|\u25AA|\u25AB|\u25B6|\u25C0|\u25FB-\u25FE|\u2600-\u27BF|\u2934|\u2935|\u2B05-\u2B07|\u2B1B|\u2B1C|\u2B50|\u2B55|\u3030|\u303D|\u3297|\u3299|\uFE0F|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF])+$/u.test(
		single,
	);
}
