import test from 'node:test';
import assert from 'node:assert/strict';
import { mapActionStatus, parseRecurringTrigger, resolveActionTitle } from '../services/publication_runtime.helpers';

test('mapActionStatus maps plan statuses into runtime statuses', () => {
    assert.equal(mapActionStatus('completed'), 'published');
    assert.equal(mapActionStatus('skipped'), 'skipped');
    assert.equal(mapActionStatus('deferred'), 'deferred');
    assert.equal(mapActionStatus('planned'), 'planned');
    assert.equal(mapActionStatus(undefined), 'planned');
});

test('resolveActionTitle prefers display_name when present', () => {
    assert.equal(
        resolveActionTitle({ id: 'a-001', action_type: 'publish_article', display_name: 'Tilda — Publish anchor article' }),
        'Tilda — Publish anchor article'
    );
    assert.equal(
        resolveActionTitle({ id: 'a-001', action_type: 'publish_article' }),
        'a-001 · publish_article'
    );
});

test('parseRecurringTrigger handles daily local triggers', () => {
    const now = new Date('2026-05-04T09:30:00Z');
    const parsed = parseRecurringTrigger('daily_09:00_local', 'UTC', now);

    assert.ok(parsed);
    assert.equal(parsed?.due, true);
    assert.equal(parsed?.scheduleAt.toISOString(), '2026-05-04T08:00:00.000Z');
});

test('parseRecurringTrigger handles weekly wall-clock triggers', () => {
    const now = new Date('2026-05-05T09:10:00Z');
    const parsed = parseRecurringTrigger('weekly_tuesday_09:00_europe_lisbon', 'UTC', now);

    assert.ok(parsed);
    assert.equal(parsed?.due, true);
    assert.equal(parsed?.scheduleAt.toISOString(), '2026-05-05T08:00:00.000Z');
});

test('parseRecurringTrigger ignores unsupported trigger shapes', () => {
    assert.equal(parseRecurringTrigger('after_action:a-003', 'UTC', new Date('2026-05-05T09:10:00Z')), null);
});
