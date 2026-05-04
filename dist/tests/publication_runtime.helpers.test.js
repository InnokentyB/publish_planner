"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const publication_runtime_helpers_1 = require("../services/publication_runtime.helpers");
(0, node_test_1.default)('mapActionStatus maps plan statuses into runtime statuses', () => {
    strict_1.default.equal((0, publication_runtime_helpers_1.mapActionStatus)('completed'), 'published');
    strict_1.default.equal((0, publication_runtime_helpers_1.mapActionStatus)('skipped'), 'skipped');
    strict_1.default.equal((0, publication_runtime_helpers_1.mapActionStatus)('deferred'), 'deferred');
    strict_1.default.equal((0, publication_runtime_helpers_1.mapActionStatus)('planned'), 'planned');
    strict_1.default.equal((0, publication_runtime_helpers_1.mapActionStatus)(undefined), 'planned');
});
(0, node_test_1.default)('resolveActionTitle prefers display_name when present', () => {
    strict_1.default.equal((0, publication_runtime_helpers_1.resolveActionTitle)({ id: 'a-001', action_type: 'publish_article', display_name: 'Tilda — Publish anchor article' }), 'Tilda — Publish anchor article');
    strict_1.default.equal((0, publication_runtime_helpers_1.resolveActionTitle)({ id: 'a-001', action_type: 'publish_article' }), 'a-001 · publish_article');
});
(0, node_test_1.default)('parseRecurringTrigger handles daily local triggers', () => {
    const now = new Date('2026-05-04T09:30:00Z');
    const parsed = (0, publication_runtime_helpers_1.parseRecurringTrigger)('daily_09:00_local', 'UTC', now);
    strict_1.default.ok(parsed);
    strict_1.default.equal(parsed?.due, true);
    strict_1.default.equal(parsed?.scheduleAt.toISOString(), '2026-05-04T08:00:00.000Z');
});
(0, node_test_1.default)('parseRecurringTrigger handles weekly wall-clock triggers', () => {
    const now = new Date('2026-05-05T09:10:00Z');
    const parsed = (0, publication_runtime_helpers_1.parseRecurringTrigger)('weekly_tuesday_09:00_europe_lisbon', 'UTC', now);
    strict_1.default.ok(parsed);
    strict_1.default.equal(parsed?.due, true);
    strict_1.default.equal(parsed?.scheduleAt.toISOString(), '2026-05-05T08:00:00.000Z');
});
(0, node_test_1.default)('parseRecurringTrigger ignores unsupported trigger shapes', () => {
    strict_1.default.equal((0, publication_runtime_helpers_1.parseRecurringTrigger)('after_action:a-003', 'UTC', new Date('2026-05-05T09:10:00Z')), null);
});
