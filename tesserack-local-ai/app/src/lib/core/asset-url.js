import { base } from '$app/paths';

/** Resolve a public asset under SvelteKit's deployment base path. */
export function assetUrl(path) {
    return `${base}/${String(path).replace(/^\/+/, '')}`;
}
