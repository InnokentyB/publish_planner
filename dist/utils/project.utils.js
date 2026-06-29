"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROJECT_KIND = void 0;
exports.slugifyProjectName = slugifyProjectName;
exports.normalizeProjectKind = normalizeProjectKind;
exports.DEFAULT_PROJECT_KIND = 'content_network';
function slugifyProjectName(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}
function normalizeProjectKind(value) {
    if (!value) {
        return exports.DEFAULT_PROJECT_KIND;
    }
    const normalized = value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || exports.DEFAULT_PROJECT_KIND;
}
