/**
 * Return the first action a user must take before the Lab can run.
 * Browser models are allowed through because Run loads them on demand.
 */
export function getLabRunBlockReason({
    romLoaded,
    labInitialized,
    mode,
    provider,
    needsApiKey = false,
    apiKey = '',
    endpoint = '',
    model = '',
}) {
    if (!romLoaded) return 'Load a ROM to start the Lab.';
    if (!labInitialized) return 'Lab is initializing…';
    if (mode !== 'play' || provider === 'browser') return '';
    if (needsApiKey && !String(apiKey).trim()) return 'Add an API key in Model settings.';
    if (!String(endpoint).trim()) return 'Configure an endpoint in Model settings.';
    if (!String(model).trim()) return 'Choose a model in Model settings.';
    return '';
}
