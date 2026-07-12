import { Injectable, computed, signal } from '@angular/core';

/**
 * PLACEHOLDER DATA LAYER for the background-agents feature.
 *
 * The "Agents Vault v2" screens (Activity page, agent detail, activity rail,
 * review bar, agents in the sidebar tree) are implemented UI-first against
 * this service. There is no agent runtime yet, so the service is EMPTY by
 * default — and every agent surface in the UI hides itself when the vault has
 * no agents (see `hasAgents`), which is exactly the behaviour we want once
 * real agents exist too.
 *
 * To preview the screens with the design's sample data, run in the console:
 *   localStorage.setItem('dotta.agentsPreview', '1')  // then reload
 * When the engine lands, replace the seeded signals with real sources and
 * keep the same shapes.
 */

/** Dev-only switch that seeds the sample agents & runs below. */
const AGENTS_PREVIEW_KEY = 'dotta.agentsPreview';

function agentsPreviewEnabled(): boolean {
	try {
		return localStorage.getItem(AGENTS_PREVIEW_KEY) === '1';
	} catch {
		return false;
	}
}

export type RunStatus =
	| 'running'
	| 'needs-review'
	| 'applied'
	| 'auto-applied'
	| 'no-changes';

export type TriggerKind = 'create' | 'edit' | 'cron' | 'manual';

export interface AgentTrigger {
	kind: TriggerKind;
	label: string;
}

export interface VaultAgent {
	/** Slug used in /agent/:agentId routes. */
	id: string;
	name: string;
	/** The agent is a file — shown as a mono chip in the detail hero. */
	fileName: string;
	/** Folder the agent watches; '' means vault-wide. */
	scope: string;
	/** One-sentence plain-language summary for the hero band. */
	description: string;
	/** The "WHAT IT DOES" plain-language behaviour. */
	instructions: string;
	/** Raw frontmatter lines for the collapsed source disclosure. */
	frontmatter: string[];
	triggers: AgentTrigger[];
	enabled: boolean;
}

export interface AgentRun {
	id: string;
	agentId: string;
	agentName: string;
	trigger: TriggerKind;
	triggerLabel: string;
	summary: string;
	status: RunStatus;
	/** Human relative time, e.g. "2m", "2h", "yesterday". */
	when: string;
	day: 'today' | 'yesterday';
	/** Vault path of the affected note, when one note is the subject. */
	notePath?: string;
}

const SAMPLE_AGENTS: VaultAgent[] = [
	{
		id: 'tagger',
		name: 'Tagger',
		fileName: 'Tagger.md',
		scope: 'Architecture',
		description:
			"Suggests tags for notes in Architecture whenever they're created or edited, plus a nightly sweep. Proposes only — you approve.",
		instructions:
			"When a note here is created or edited, read it and suggest one to three tags drawn from tags already used elsewhere in the vault. Don't invent a new tag unless the note clearly needs one. Skip notes under 40 words. Suggest for review — never change the note directly.",
		frontmatter: [
			'---',
			'on: [create, edit]',
			'schedule: "0 2 * * *"  # nightly 02:00',
			'scope: ./',
			'model: local/llama-3.2-3b',
			'autonomy: suggest',
			'---',
		],
		triggers: [
			{ kind: 'create', label: 'A note is created' },
			{ kind: 'edit', label: 'A note is edited' },
			{ kind: 'cron', label: 'Every night · 02:00' },
		],
		enabled: true,
	},
	{
		id: 'linker',
		name: 'Linker',
		fileName: 'Linker.md',
		scope: 'Architecture',
		description:
			'Adds backlinks between related notes in Architecture as you edit. Proposes only — nothing changes until you accept.',
		instructions:
			'When a note here is edited, look for mentions of other notes in the vault and propose backlinks for them. Only suggest links that add context — skip passing references.',
		frontmatter: [
			'---',
			'on: [edit]',
			'scope: ./',
			'model: local/llama-3.2-3b',
			'autonomy: suggest',
			'---',
		],
		triggers: [{ kind: 'edit', label: 'A note is edited' }],
		enabled: true,
	},
	{
		id: 'librarian',
		name: 'Librarian',
		fileName: 'Librarian.md',
		scope: '',
		description:
			'Sweeps the whole vault nightly — fixes broken links, flags orphan notes, and keeps folder notes up to date.',
		instructions:
			'Every night, scan the vault for broken links, orphaned notes, and stale folder indexes. Propose fixes for review; never delete anything.',
		frontmatter: [
			'---',
			'schedule: "0 2 * * *"  # nightly 02:00',
			'scope: /',
			'model: local/llama-3.2-3b',
			'autonomy: suggest',
			'---',
		],
		triggers: [{ kind: 'cron', label: 'Every night · 02:00' }],
		enabled: true,
	},
	{
		id: 'summarizer',
		name: 'Summarizer',
		fileName: 'Summarizer.md',
		scope: 'Embeddings',
		description:
			'Keeps a short summary line in the frontmatter of every note in Embeddings, refreshed nightly. Applies changes automatically.',
		instructions:
			'Every night, refresh the summary field in the frontmatter of notes changed that day. Keep summaries under 140 characters. Apply directly and log the change.',
		frontmatter: [
			'---',
			'schedule: "0 2 * * *"  # nightly 02:00',
			'scope: ./',
			'model: local/llama-3.2-3b',
			'autonomy: auto',
			'---',
		],
		triggers: [{ kind: 'cron', label: 'Every night · 02:00' }],
		enabled: true,
	},
];

const SAMPLE_RUNS: AgentRun[] = [
	{
		id: 'run-librarian-1',
		agentId: 'librarian',
		agentName: 'Librarian',
		trigger: 'cron',
		triggerLabel: 'Nightly sweep',
		summary: 'scanning vault — 14 of 24 notes',
		status: 'running',
		when: '1m',
		day: 'today',
	},
	{
		id: 'run-tagger-1',
		agentId: 'tagger',
		agentName: 'Tagger',
		trigger: 'edit',
		triggerLabel: 'On edit',
		summary: 'Sync Engine Design — proposed #architecture #local-first',
		status: 'needs-review',
		when: '2m',
		day: 'today',
		notePath: 'Architecture/Sync Engine Design.md',
	},
	{
		id: 'run-linker-1',
		agentId: 'linker',
		agentName: 'Linker',
		trigger: 'edit',
		triggerLabel: 'On edit',
		summary: 'Local-First Architecture — 1 backlink → Conflict Handling',
		status: 'needs-review',
		when: '5m',
		day: 'today',
		notePath: 'Architecture/Local-First Architecture.md',
	},
	{
		id: 'run-summarizer-1',
		agentId: 'summarizer',
		agentName: 'Summarizer',
		trigger: 'cron',
		triggerLabel: 'Cron · 02:00',
		summary: 'updated summaries on 6 notes in Embeddings',
		status: 'applied',
		when: '2h',
		day: 'today',
	},
	{
		id: 'run-tagger-2',
		agentId: 'tagger',
		agentName: 'Tagger',
		trigger: 'create',
		triggerLabel: 'On create',
		summary: 'Local Embeddings — added 2 tags automatically',
		status: 'auto-applied',
		when: 'yesterday',
		day: 'yesterday',
	},
	{
		id: 'run-tagger-3',
		agentId: 'tagger',
		agentName: 'Tagger',
		trigger: 'cron',
		triggerLabel: 'Nightly',
		summary: '3 notes scanned',
		status: 'no-changes',
		when: 'yesterday 02:00',
		day: 'yesterday',
	},
];

@Injectable({ providedIn: 'root' })
export class AgentsService {
	readonly agents = signal<VaultAgent[]>(
		agentsPreviewEnabled() ? SAMPLE_AGENTS : [],
	);
	readonly runs = signal<AgentRun[]>(
		agentsPreviewEnabled() ? SAMPLE_RUNS : [],
	);

	/**
	 * Whether the vault has any agents. Every agent-related surface (Ask
	 * button, Activity link, review bar, activity rail, tree rows) keys off
	 * this so a vault without agents shows no agent chrome at all.
	 */
	readonly hasAgents = computed(() => this.agents().length > 0);

	/** Whether the amber review bar on notes was dismissed (per session). */
	readonly reviewBarDismissed = signal(false);

	readonly runningRuns = computed(() =>
		this.runs().filter((r) => r.status === 'running'),
	);

	readonly runningCount = computed(() => this.runningRuns().length);

	readonly pendingReviewCount = computed(
		() => this.runs().filter((r) => r.status === 'needs-review').length,
	);

	readonly runsToday = computed(
		() => this.runs().filter((r) => r.day === 'today').length,
	);

	readonly autoAppliedToday = computed(
		() =>
			this.runs().filter(
				(r) =>
					r.day === 'today' &&
					(r.status === 'applied' || r.status === 'auto-applied'),
			).length,
	);

	readonly enabledCount = computed(
		() => this.agents().filter((a) => a.enabled).length,
	);

	agentById(id: string): VaultAgent | undefined {
		return this.agents().find((a) => a.id === id);
	}

	runsForAgent(id: string): AgentRun[] {
		return this.runs().filter((r) => r.agentId === id);
	}

	toggleAgent(id: string): void {
		this.agents.update((list) =>
			list.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)),
		);
	}

	/**
	 * "Run now" placeholder — shows a running entry for a few seconds, then
	 * settles it as a no-changes run. Replaced by the real engine later.
	 */
	simulateManualRun(agentId: string): void {
		const agent = this.agentById(agentId);
		if (!agent) return;
		const id = `run-manual-${String(Date.now())}`;
		this.runs.update((runs) => [
			{
				id,
				agentId,
				agentName: agent.name,
				trigger: 'manual',
				triggerLabel: 'Manual',
				summary: 'running on demand…',
				status: 'running',
				when: 'now',
				day: 'today',
			},
			...runs,
		]);
		setTimeout(() => {
			this.runs.update((runs) =>
				runs.map((r) =>
					r.id === id
						? {
								...r,
								status: 'no-changes' as const,
								summary: 'manual run — no changes',
								when: 'just now',
							}
						: r,
				),
			);
		}, 3000);
	}

	dismissReviewBar(): void {
		this.reviewBarDismissed.set(true);
	}
}
