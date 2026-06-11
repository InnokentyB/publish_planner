import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROJECT_KIND, normalizeProjectKind, slugifyProjectName } from '../utils/project.utils';

test('slugifyProjectName creates stable project slugs', () => {
    assert.equal(slugifyProjectName('Seturon Cycle 1 / 2026-04'), 'seturon-cycle-1-2026-04');
    assert.equal(slugifyProjectName('  Аналитическая мастерская  '), '');
});

test('normalizeProjectKind defaults to content_network', () => {
    assert.equal(normalizeProjectKind(undefined), DEFAULT_PROJECT_KIND);
    assert.equal(normalizeProjectKind(''), DEFAULT_PROJECT_KIND);
});

test('normalizeProjectKind normalizes custom labels', () => {
    assert.equal(normalizeProjectKind('Brand Network'), 'brand_network');
    assert.equal(normalizeProjectKind('Research+Publishing Hub'), 'research_publishing_hub');
});
