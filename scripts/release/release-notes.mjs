#!/usr/bin/env node
/**
 * Prints the notes of one version from RELEASE.md, for the GitHub release the
 * <local>-release.yml workflow creates from the tag:
 *
 *   node scripts/release/release-notes.mjs 1.4.2 [path/to/RELEASE.md]
 *
 * The section starts at the heading "## 1.4.2" (anything after the number, like " · 27 nov 2026",
 * is fine) and ends at the next "## ". Fails when the version has no section: a release always
 * says what changed.
 */
import { readFileSync } from 'node:fs';

const [version, file = 'RELEASE.md'] = process.argv.slice(2);
if (!version) {
	console.error('Uso: node scripts/release/release-notes.mjs <versão> [RELEASE.md]');
	process.exit(1);
}

const lines = readFileSync(file, 'utf8').split(/\r?\n/);
const start = lines.findIndex((line) => new RegExp(`^## ${version.replaceAll('.', '\\.')}\\b`).test(line));
if (start === -1) {
	console.error(`O ${file} não tem a seção "## ${version}". Escreva o que mudou antes da release.`);
	process.exit(1);
}

const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
const notes = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
process.stdout.write(`${notes}\n`);
