export const DEFAULT_PROJECT_KIND = 'content_network';

export function slugifyProjectName(value: string) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

export function normalizeProjectKind(value?: string | null) {
    if (!value) {
        return DEFAULT_PROJECT_KIND;
    }

    const normalized = value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    return normalized || DEFAULT_PROJECT_KIND;
}

