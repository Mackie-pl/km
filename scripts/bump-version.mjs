// Single-source-of-truth version bump.
//
// package.json is the ONE place the version lives. This script bumps it, then
// keeps the two downstream copies in lockstep and creates the release tag:
//   - src-tauri/Cargo.toml        Rust crate version (cosmetic — the bundle
//                                 version comes from package.json via
//                                 tauri.conf.json "version": "../package.json")
//   - src/build-info.ts           committed dev placeholder (rebuilt for real
//                                 at build time by generate-build-info.mjs)
// ...then commits everything and tags vX.Y.Z. The release pipeline triggers on
// the pushed tag, so by default nothing is pushed automatically.
//
// Usage:
//   node scripts/bump-version.mjs <patch|minor|major|x.y.z> [--push]
// Without --push it stops after tagging; ship when ready with:
//   git push --follow-tags
// With --push it runs that push for you, triggering the release pipeline.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const push = args.includes('--push');
const arg = args.find((a) => a !== '--push');

if (!arg) {
	console.error('Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z> [--push]');
	process.exit(1);
}

function bumped(version, kind) {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!m) throw new Error(`Cannot parse current version "${version}"`);
	let [major, minor, patch] = m.slice(1).map(Number);
	if (kind === 'major') { major++; minor = 0; patch = 0; }
	else if (kind === 'minor') { minor++; patch = 0; }
	else if (kind === 'patch') { patch++; }
	else throw new Error(`Unknown bump kind "${kind}" (use patch|minor|major|x.y.z)`);
	return `${major}.${minor}.${patch}`;
}

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const explicit = /^\d+\.\d+\.\d+$/.test(arg);
const next = explicit ? arg : bumped(pkg.version, arg);
const tag = `v${next}`;

// Keep the version commit clean and unambiguous.
const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim();
if (dirty) {
	console.error('Working tree is not clean — commit or stash first:\n' + dirty);
	process.exit(1);
}

console.log(`Version: ${pkg.version} -> ${next}`);

// 1) package.json — the source of truth.
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2) src-tauri/Cargo.toml — first top-level `version = "..."` (the [package] one;
//    dependency lines like `tauri = { version = "2" }` don't start a line).
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
const cargoSrc = readFileSync(cargoPath, 'utf8');
const cargo = cargoSrc.replace(/^version\s*=\s*"[^"]*"/m, `version = "${next}"`);
writeFileSync(cargoPath, cargo);

// 2b) src-tauri/Cargo.lock — the workspace crate's own entry pins its version,
//     so a build after bumping rewrites the lock and dirties the tree. Sync it
//     here (version-only edit of the [[package]] block whose name is this crate)
//     so it rides along in the release commit. Skipped if no lockfile exists.
const crate = /^\s*name\s*=\s*"([^"]+)"/m.exec(cargoSrc)?.[1];
const lockPath = join(root, 'src-tauri', 'Cargo.lock');
if (crate && existsSync(lockPath)) {
	const lock = readFileSync(lockPath, 'utf8').replace(
		new RegExp(`(name = "${crate}"\\r?\\nversion = ")[^"]*(")`),
		`$1${next}$2`,
	);
	writeFileSync(lockPath, lock);
}

// 3) src/build-info.ts — update only the committed placeholder version string.
const biPath = join(root, 'src', 'build-info.ts');
const bi = readFileSync(biPath, 'utf8').replace(
	/version: '[^']*'/,
	`version: '${next}'`,
);
writeFileSync(biPath, bi);

// 4) Commit + tag.
execSync('git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src/build-info.ts', { cwd: root, stdio: 'inherit' });
execSync(`git commit -m "chore(release): ${tag}"`, { cwd: root, stdio: 'inherit' });
// Annotated tag (-a): lightweight tags are skipped by `git push --follow-tags`,
// so the release pipeline would never trigger. Annotated tags push correctly.
execSync(`git tag -a ${tag} -m "${tag}"`, { cwd: root, stdio: 'inherit' });

// 5) Optionally push the commit + tag to trigger the release pipeline.
if (push) {
	console.log(`\nPushing ${tag} (with --follow-tags)...`);
	execSync('git push --follow-tags', { cwd: root, stdio: 'inherit' });
	console.log(`\nPushed ${tag}. The release & Pages workflows are now running on GitHub.`);
} else {
	console.log(`\nTagged ${tag}. Push to trigger the release pipeline:\n  git push --follow-tags`);
}
