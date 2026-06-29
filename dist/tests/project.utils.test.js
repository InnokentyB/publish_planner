"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const project_utils_1 = require("../utils/project.utils");
(0, node_test_1.default)('slugifyProjectName creates stable project slugs', () => {
    strict_1.default.equal((0, project_utils_1.slugifyProjectName)('Seturon Cycle 1 / 2026-04'), 'seturon-cycle-1-2026-04');
    strict_1.default.equal((0, project_utils_1.slugifyProjectName)('  Аналитическая мастерская  '), '');
});
(0, node_test_1.default)('normalizeProjectKind defaults to content_network', () => {
    strict_1.default.equal((0, project_utils_1.normalizeProjectKind)(undefined), project_utils_1.DEFAULT_PROJECT_KIND);
    strict_1.default.equal((0, project_utils_1.normalizeProjectKind)(''), project_utils_1.DEFAULT_PROJECT_KIND);
});
(0, node_test_1.default)('normalizeProjectKind normalizes custom labels', () => {
    strict_1.default.equal((0, project_utils_1.normalizeProjectKind)('Brand Network'), 'brand_network');
    strict_1.default.equal((0, project_utils_1.normalizeProjectKind)('Research+Publishing Hub'), 'research_publishing_hub');
});
