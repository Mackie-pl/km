/**
 * Icon catalog: emojis + curated Lucide icons for the icon picker.
 *
 * Each icon has:
 * - `value`: the stored string (emoji char, or `"lucide:<kebab-name>"`)
 * - `label`: human-readable name for search
 * - `type`: 'emoji' | 'lucide'
 */

export interface IconItem {
	value: string;
	label: string;
	type: 'emoji' | 'lucide';
}

import { isEmoji } from './emoji';

// ── Emoji catalog ──────────────────────────────────────────────────────────

const EMOJI_ICONS: IconItem[] = [
	// Documents
	{ value: '📄', label: 'Document', type: 'emoji' },
	{ value: '📝', label: 'Note', type: 'emoji' },
	{ value: '📋', label: 'Clipboard', type: 'emoji' },
	{ value: '📎', label: 'Paperclip', type: 'emoji' },
	{ value: '📁', label: 'Folder', type: 'emoji' },
	{ value: '📂', label: 'Open Folder', type: 'emoji' },
	{ value: '🗂️', label: 'Card Index Dividers', type: 'emoji' },
	{ value: '📚', label: 'Books', type: 'emoji' },
	{ value: '📖', label: 'Open Book', type: 'emoji' },
	{ value: '🔖', label: 'Bookmark', type: 'emoji' },
	{ value: '📌', label: 'Pin', type: 'emoji' },
	{ value: '🧾', label: 'Receipt', type: 'emoji' },
	{ value: '🏷️', label: 'Tag', type: 'emoji' },
	{ value: '📑', label: 'Bookmark Tabs', type: 'emoji' },
	{ value: '📰', label: 'Newspaper', type: 'emoji' },
	{ value: '✂️', label: 'Scissors', type: 'emoji' },
	{ value: '📏', label: 'Ruler', type: 'emoji' },

	// Objects & Tools
	{ value: '💡', label: 'Light Bulb', type: 'emoji' },
	{ value: '🔑', label: 'Key', type: 'emoji' },
	{ value: '🔒', label: 'Lock', type: 'emoji' },
	{ value: '🔓', label: 'Unlock', type: 'emoji' },
	{ value: '⚙️', label: 'Gear', type: 'emoji' },
	{ value: '🔧', label: 'Wrench', type: 'emoji' },
	{ value: '🔨', label: 'Hammer', type: 'emoji' },
	{ value: '🧰', label: 'Toolbox', type: 'emoji' },
	{ value: '🖊️', label: 'Pen', type: 'emoji' },
	{ value: '✏️', label: 'Pencil', type: 'emoji' },
	{ value: '🖍️', label: 'Crayon', type: 'emoji' },
	{ value: '🎨', label: 'Palette', type: 'emoji' },
	{ value: '🖼️', label: 'Picture', type: 'emoji' },
	{ value: '📦', label: 'Package', type: 'emoji' },
	{ value: '🎁', label: 'Gift', type: 'emoji' },
	{ value: '🧲', label: 'Magnet', type: 'emoji' },
	{ value: '🧪', label: 'Test Tube', type: 'emoji' },
	{ value: '🔬', label: 'Microscope', type: 'emoji' },
	{ value: '🔭', label: 'Telescope', type: 'emoji' },
	{ value: '💎', label: 'Gem', type: 'emoji' },
	{ value: '🔮', label: 'Crystal Ball', type: 'emoji' },
	{ value: '🧸', label: 'Teddy Bear', type: 'emoji' },
	{ value: '🧩', label: 'Puzzle', type: 'emoji' },
	{ value: '🎯', label: 'Target', type: 'emoji' },

	// Communication
	{ value: '💬', label: 'Speech Bubble', type: 'emoji' },
	{ value: '✉️', label: 'Envelope', type: 'emoji' },
	{ value: '📧', label: 'E-Mail', type: 'emoji' },
	{ value: '📤', label: 'Outbox', type: 'emoji' },
	{ value: '📥', label: 'Inbox', type: 'emoji' },
	{ value: '🗨️', label: 'Left Speech Bubble', type: 'emoji' },
	{ value: '🧠', label: 'Brain', type: 'emoji' },
	{ value: '💭', label: 'Thought', type: 'emoji' },
	{ value: '📢', label: 'Loudspeaker', type: 'emoji' },
	{ value: '🔔', label: 'Bell', type: 'emoji' },
	{ value: '🔕', label: 'Bell with Slash', type: 'emoji' },

	// Nature
	{ value: '🌱', label: 'Seedling', type: 'emoji' },
	{ value: '🌿', label: 'Herb', type: 'emoji' },
	{ value: '🌳', label: 'Deciduous Tree', type: 'emoji' },
	{ value: '🌲', label: 'Evergreen Tree', type: 'emoji' },
	{ value: '🌸', label: 'Cherry Blossom', type: 'emoji' },
	{ value: '🌻', label: 'Sunflower', type: 'emoji' },
	{ value: '🌊', label: 'Wave', type: 'emoji' },
	{ value: '☀️', label: 'Sun', type: 'emoji' },
	{ value: '🌙', label: 'Moon', type: 'emoji' },
	{ value: '⭐', label: 'Star', type: 'emoji' },
	{ value: '🌟', label: 'Glowing Star', type: 'emoji' },
	{ value: '☁️', label: 'Cloud', type: 'emoji' },
	{ value: '🌈', label: 'Rainbow', type: 'emoji' },
	{ value: '⛅', label: 'Sun Behind Cloud', type: 'emoji' },
	{ value: '🌧️', label: 'Rain', type: 'emoji' },
	{ value: '❄️', label: 'Snowflake', type: 'emoji' },
	{ value: '🔥', label: 'Flame', type: 'emoji' },
	{ value: '💧', label: 'Droplet', type: 'emoji' },

	// Symbols
	{ value: '❤️', label: 'Red Heart', type: 'emoji' },
	{ value: '💛', label: 'Yellow Heart', type: 'emoji' },
	{ value: '💚', label: 'Green Heart', type: 'emoji' },
	{ value: '💙', label: 'Blue Heart', type: 'emoji' },
	{ value: '💜', label: 'Purple Heart', type: 'emoji' },
	{ value: '🖤', label: 'Black Heart', type: 'emoji' },
	{ value: '✅', label: 'Check', type: 'emoji' },
	{ value: '❌', label: 'Cross', type: 'emoji' },
	{ value: '⭕', label: 'Circle', type: 'emoji' },
	{ value: '🔄', label: 'Counterclockwise', type: 'emoji' },
	{ value: '♻️', label: 'Recycle', type: 'emoji' },
	{ value: '⚠️', label: 'Warning', type: 'emoji' },
	{ value: '🚫', label: 'Prohibited', type: 'emoji' },
	{ value: '💯', label: '100', type: 'emoji' },
	{ value: '🔝', label: 'Top', type: 'emoji' },

	// People
	{ value: '👤', label: 'User', type: 'emoji' },
	{ value: '👥', label: 'Users', type: 'emoji' },
	{ value: '👋', label: 'Wave', type: 'emoji' },
	{ value: '🤝', label: 'Handshake', type: 'emoji' },
	{ value: '🙌', label: 'Raising Hands', type: 'emoji' },
	{ value: '👍', label: 'Thumbs Up', type: 'emoji' },
	{ value: '👎', label: 'Thumbs Down', type: 'emoji' },
	{ value: '💪', label: 'Muscle', type: 'emoji' },
	{ value: '🏆', label: 'Trophy', type: 'emoji' },
	{ value: '🚀', label: 'Rocket', type: 'emoji' },

	// Food
	{ value: '☕', label: 'Coffee', type: 'emoji' },
	{ value: '🍵', label: 'Tea', type: 'emoji' },
	{ value: '🥤', label: 'Cup', type: 'emoji' },
	{ value: '🍕', label: 'Pizza', type: 'emoji' },
	{ value: '🥗', label: 'Salad', type: 'emoji' },
	{ value: '🍎', label: 'Apple', type: 'emoji' },
	{ value: '🧁', label: 'Cupcake', type: 'emoji' },

	// Tech
	{ value: '💻', label: 'Laptop', type: 'emoji' },
	{ value: '🖥️', label: 'Desktop', type: 'emoji' },
	{ value: '📱', label: 'Smartphone', type: 'emoji' },
	{ value: '⌨️', label: 'Keyboard', type: 'emoji' },
	{ value: '🖱️', label: 'Mouse', type: 'emoji' },
	{ value: '🖨️', label: 'Printer', type: 'emoji' },
	{ value: '💾', label: 'Floppy Disk', type: 'emoji' },
	{ value: '💿', label: 'Optical Disc', type: 'emoji' },
	{ value: '🔋', label: 'Battery', type: 'emoji' },
	{ value: '📡', label: 'Satellite', type: 'emoji' },
	{ value: '🌐', label: 'Globe', type: 'emoji' },
	{ value: '🔗', label: 'Link', type: 'emoji' },

	// Time
	{ value: '⏰', label: 'Alarm Clock', type: 'emoji' },
	{ value: '⌚', label: 'Watch', type: 'emoji' },
	{ value: '⏱️', label: 'Stopwatch', type: 'emoji' },
	{ value: '⏲️', label: 'Timer', type: 'emoji' },
	{ value: '🕰️', label: 'Clock', type: 'emoji' },
	{ value: '📅', label: 'Calendar', type: 'emoji' },
	{ value: '📆', label: 'Tear-Off Calendar', type: 'emoji' },
	{ value: '⏳', label: 'Hourglass', type: 'emoji' },

	// Transport
	{ value: '✈️', label: 'Airplane', type: 'emoji' },
	{ value: '🚁', label: 'Helicopter', type: 'emoji' },
	{ value: '🚂', label: 'Train', type: 'emoji' },
	{ value: '🚗', label: 'Car', type: 'emoji' },
	{ value: '🚲', label: 'Bicycle', type: 'emoji' },
	{ value: '🚢', label: 'Ship', type: 'emoji' },
	{ value: '⛵', label: 'Sailboat', type: 'emoji' },
	{ value: '🛸', label: 'Flying Saucer', type: 'emoji' },

	// Misc
	{ value: '🎵', label: 'Music Note', type: 'emoji' },
	{ value: '🎶', label: 'Music', type: 'emoji' },
	{ value: '🎧', label: 'Headphones', type: 'emoji' },
	{ value: '🎤', label: 'Microphone', type: 'emoji' },
	{ value: '🎬', label: 'Clapper', type: 'emoji' },
	{ value: '🎭', label: 'Performing Arts', type: 'emoji' },
	{ value: '🎲', label: 'Dice', type: 'emoji' },
	{ value: '♟️', label: 'Chess Pawn', type: 'emoji' },
	{ value: '🃏', label: 'Joker', type: 'emoji' },
	{ value: '🎗️', label: 'Ribbon', type: 'emoji' },
	{ value: '🎀', label: 'Bow', type: 'emoji' },
];

// ── Lucide icons (curated set most useful for note-taking) ─────────────────

/**
 * Lucide icon class names (the PascalCase name after "Lucide" prefix).
 *
 * We store the kebab-case form as `"lucide:<kebab>"` in frontmatter.
 * The conversion: `FileText` → `file-text`, `BookOpenCheck` → `book-open-check`.
 */
const LUCIDE_ENTRIES: { className: string; label: string }[] = [
	// Documents & Files
	{ className: 'FileText', label: 'File Text' },
	{ className: 'FilePlus', label: 'File Plus' },
	{ className: 'FileImage', label: 'File Image' },
	{ className: 'FileSpreadsheet', label: 'File Spreadsheet' },
	{ className: 'FileCode', label: 'File Code' },
	{ className: 'FileJson', label: 'File JSON' },
	{ className: 'FileType', label: 'File Type' },
	{ className: 'FileEdit', label: 'File Edit' },
	{ className: 'FilePen', label: 'File Pen' },
	{ className: 'FileSearch', label: 'File Search' },
	{ className: 'FileArchive', label: 'File Archive' },
	{ className: 'Folder', label: 'Folder' },
	{ className: 'FolderOpen', label: 'Folder Open' },
	{ className: 'FolderPlus', label: 'Folder Plus' },
	{ className: 'FolderTree', label: 'Folder Tree' },
	{ className: 'StickyNote', label: 'Sticky Note' },
	{ className: 'BookOpen', label: 'Book Open' },
	{ className: 'Book', label: 'Book' },
	{ className: 'Bookmark', label: 'Bookmark' },
	{ className: 'Bookmarks', label: 'Bookmarks' },
	{ className: 'BookmarkCheck', label: 'Bookmark Check' },

	// Clipboard & Archive
	{ className: 'Clipboard', label: 'Clipboard' },
	{ className: 'ClipboardList', label: 'Clipboard List' },
	{ className: 'ClipboardCheck', label: 'Clipboard Check' },
	{ className: 'ClipboardPen', label: 'Clipboard Pen' },
	{ className: 'ClipboardCopy', label: 'Clipboard Copy' },
	{ className: 'ClipboardPaste', label: 'Clipboard Paste' },
	{ className: 'Scroll', label: 'Scroll' },
	{ className: 'ScrollText', label: 'Scroll Text' },
	{ className: 'Notebook', label: 'Notebook' },
	{ className: 'NotebookPen', label: 'Notebook Pen' },
	{ className: 'NotebookText', label: 'Notebook Text' },
	{ className: 'Library', label: 'Library' },
	{ className: 'Archive', label: 'Archive' },
	{ className: 'ArchiveRestore', label: 'Archive Restore' },
	{ className: 'Trash2', label: 'Trash' },

	// Objects & Tools
	{ className: 'Pen', label: 'Pen' },
	{ className: 'PenLine', label: 'Pen Line' },
	{ className: 'PenTool', label: 'Pen Tool' },
	{ className: 'Pencil', label: 'Pencil' },
	{ className: 'Highlighter', label: 'Highlighter' },
	{ className: 'Brush', label: 'Brush' },
	{ className: 'Palette', label: 'Palette' },
	{ className: 'Paintbrush', label: 'Paintbrush' },
	{ className: 'Eraser', label: 'Eraser' },
	{ className: 'Wrench', label: 'Wrench' },
	{ className: 'Hammer', label: 'Hammer' },
	{ className: 'Scissors', label: 'Scissors' },
	{ className: 'Settings', label: 'Settings' },
	{ className: 'SlidersHorizontal', label: 'Sliders' },
	{ className: 'Search', label: 'Search' },
	{ className: 'Eye', label: 'Eye' },
	{ className: 'EyeOff', label: 'Eye Off' },
	{ className: 'Lock', label: 'Lock' },
	{ className: 'LockOpen', label: 'Lock Open' },
	{ className: 'Key', label: 'Key' },
	{ className: 'Bell', label: 'Bell' },
	{ className: 'BellOff', label: 'Bell Off' },

	// Communication
	{ className: 'Mail', label: 'Mail' },
	{ className: 'MailOpen', label: 'Mail Open' },
	{ className: 'MessageSquare', label: 'Message Square' },
	{ className: 'MessageCircle', label: 'Message Circle' },
	{ className: 'MessageSquarePlus', label: 'Message Plus' },
	{ className: 'MessagesSquare', label: 'Messages' },
	{ className: 'Send', label: 'Send' },
	{ className: 'Share', label: 'Share' },
	{ className: 'User', label: 'User' },
	{ className: 'Users', label: 'Users' },
	{ className: 'UserPlus', label: 'User Plus' },
	{ className: 'AtSign', label: 'At Sign' },

	// Media & Design
	{ className: 'Image', label: 'Image' },
	{ className: 'Images', label: 'Images' },
	{ className: 'Music', label: 'Music' },
	{ className: 'Camera', label: 'Camera' },
	{ className: 'Play', label: 'Play' },
	{ className: 'Square', label: 'Square' },
	{ className: 'Circle', label: 'Circle' },
	{ className: 'Triangle', label: 'Triangle' },
	{ className: 'Diamond', label: 'Diamond' },

	// Nature / Weather
	{ className: 'Sun', label: 'Sun' },
	{ className: 'Moon', label: 'Moon' },
	{ className: 'Cloud', label: 'Cloud' },
	{ className: 'CloudSun', label: 'Cloud Sun' },
	{ className: 'CloudMoon', label: 'Cloud Moon' },
	{ className: 'CloudLightning', label: 'Cloud Lightning' },
	{ className: 'CloudRain', label: 'Cloud Rain' },
	{ className: 'CloudSnow', label: 'Cloud Snow' },
	{ className: 'Flame', label: 'Flame' },
	{ className: 'Snowflake', label: 'Snowflake' },
	{ className: 'Droplets', label: 'Droplets' },
	{ className: 'Wind', label: 'Wind' },
	{ className: 'Waves', label: 'Waves' },

	// Navigation & UI
	{ className: 'ArrowLeft', label: 'Arrow Left' },
	{ className: 'ArrowRight', label: 'Arrow Right' },
	{ className: 'ArrowUp', label: 'Arrow Up' },
	{ className: 'ArrowDown', label: 'Arrow Down' },
	{ className: 'ChevronLeft', label: 'Chevron Left' },
	{ className: 'ChevronRight', label: 'Chevron Right' },
	{ className: 'ChevronUp', label: 'Chevron Up' },
	{ className: 'ChevronDown', label: 'Chevron Down' },
	{ className: 'Expand', label: 'Expand' },
	{ className: 'Shrink', label: 'Shrink' },
	{ className: 'Maximize', label: 'Maximize' },
	{ className: 'Minimize', label: 'Minimize' },
	{ className: 'Move', label: 'Move' },
	{ className: 'ZoomIn', label: 'Zoom In' },
	{ className: 'ZoomOut', label: 'Zoom Out' },
	{ className: 'ExternalLink', label: 'External Link' },
	{ className: 'Link', label: 'Link' },
	{ className: 'Home', label: 'Home' },
	{ className: 'Hash', label: 'Hash' },
	{ className: 'Tag', label: 'Tag' },
	{ className: 'Flag', label: 'Flag' },

	// Time / Calendar
	{ className: 'Calendar', label: 'Calendar' },
	{ className: 'CalendarDays', label: 'Calendar Days' },
	{ className: 'CalendarPlus', label: 'Calendar Plus' },
	{ className: 'CalendarCheck', label: 'Calendar Check' },
	{ className: 'Clock', label: 'Clock' },
	{ className: 'Timer', label: 'Timer' },
	{ className: 'TimerReset', label: 'Timer Reset' },
	{ className: 'Hourglass', label: 'Hourglass' },
	{ className: 'AlarmClock', label: 'Alarm Clock' },
	{ className: 'AlarmClockCheck', label: 'Alarm Clock Check' },

	// Code & Tech
	{ className: 'Terminal', label: 'Terminal' },
	{ className: 'Code', label: 'Code' },
	{ className: 'CodeXml', label: 'Code XML' },
	{ className: 'GitBranch', label: 'Git Branch' },
	{ className: 'GitCommit', label: 'Git Commit' },
	{ className: 'GitPullRequest', label: 'Git Pull Request' },
	{ className: 'Database', label: 'Database' },
	{ className: 'Server', label: 'Server' },
	{ className: 'Monitor', label: 'Monitor' },
	{ className: 'Smartphone', label: 'Smartphone' },
	{ className: 'Tablet', label: 'Tablet' },
	{ className: 'Laptop', label: 'Laptop' },
	{ className: 'HardDrive', label: 'Hard Drive' },
	{ className: 'Wifi', label: 'WiFi' },
	{ className: 'Globe', label: 'Globe' },
	{ className: 'MapPin', label: 'Map Pin' },
	{ className: 'Map', label: 'Map' },
	{ className: 'Compass', label: 'Compass' },

	// Symbols
	{ className: 'Check', label: 'Check' },
	{ className: 'CheckCircle', label: 'Check Circle' },
	{ className: 'CheckSquare', label: 'Check Square' },
	{ className: 'X', label: 'X' },
	{ className: 'XCircle', label: 'X Circle' },
	{ className: 'Plus', label: 'Plus' },
	{ className: 'PlusCircle', label: 'Plus Circle' },
	{ className: 'Minus', label: 'Minus' },
	{ className: 'MinusCircle', label: 'Minus Circle' },
	{ className: 'Info', label: 'Info' },
	{ className: 'CircleHelp', label: 'Help' },
	{ className: 'AlertCircle', label: 'Alert Circle' },
	{ className: 'AlertTriangle', label: 'Warning' },
	{ className: 'Star', label: 'Star' },
	{ className: 'Heart', label: 'Heart' },
	{ className: 'HeartPulse', label: 'Heart Pulse' },
	{ className: 'Target', label: 'Target' },
	{ className: 'Award', label: 'Award' },
	{ className: 'Trophy', label: 'Trophy' },
	{ className: 'Medal', label: 'Medal' },
	{ className: 'CircleDot', label: 'Circle Dot' },
	{ className: 'Dot', label: 'Dot' },
];

// ── Build searchable catalog ───────────────────────────────────────────────

function pascalToKebab(pascal: string): string {
	return pascal
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
		.toLowerCase();
}

/** All icons = emoji + lucide, combined into a single searchable array. */
export const ALL_ICONS: IconItem[] = [
	...EMOJI_ICONS,
	...LUCIDE_ENTRIES.map((e) => ({
		value: `lucide:${pascalToKebab(e.className)}`,
		label: e.label,
		type: 'lucide' as const,
	})),
];

/**
 * Search icons by query string (fuzzy match on label & value).
 * Returns at most `maxResults` items, sorted by relevance.
 */
export function searchIcons(query: string, maxResults = 60): IconItem[] {
	const q = query.toLowerCase().trim();
	if (!q) return ALL_ICONS.slice(0, maxResults);

	const scored = ALL_ICONS.map((icon) => {
		const label = icon.label.toLowerCase();
		const value = icon.value.toLowerCase();
		let score = 0;

		// Exact label match
		if (label === q) score = 100;
		else if (label.startsWith(q)) score = 80;
		else if (label.includes(q)) score = 40;

		// Value match (lower priority)
		if (value === q) score = Math.max(score, 90);
		else if (value.startsWith(q)) score = Math.max(score, 60);
		else if (value.includes(q)) score = Math.max(score, 20);

		return { icon, score };
	})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((item) => item.icon);

	// If the query itself is a typed/pasted emoji, add it at the top
	// even if it isn't in our predefined catalog.
	if (isEmoji(q)) {
		const alreadyIncluded = scored.some((i) => i.value === q);
		if (!alreadyIncluded) {
			scored.unshift({
				value: q,
				label: q,
				type: 'emoji',
			});
		}
	}

	return scored.slice(0, maxResults);
}

/**
 * Check whether a stored icon value is a Lucide icon.
 */
export function isLucideIcon(value: string): boolean {
	return value.startsWith('lucide:');
}

/**
 * Extract the kebab-case name from a stored Lucide icon value.
 * Returns `null` if the value is not a Lucide icon reference.
 */
export function getLucideKebabName(value: string): string | null {
	if (!isLucideIcon(value)) return null;
	return value.slice('lucide:'.length);
}

/**
 * Convert a Lucide component class name (e.g. `"FileText"`)
 * to its kebab-case storage suffix (e.g. `"file-text"`).
 */
export function lucideClassNameToKebab(className: string): string {
	return pascalToKebab(className);
}
