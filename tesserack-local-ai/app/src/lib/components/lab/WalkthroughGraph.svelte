<script>
    import { onMount, onDestroy } from 'svelte';
    import cytoscape from 'cytoscape';
    import dagre from 'cytoscape-dagre';
    import { resolveRedppLocation } from '$lib/core/lab/redpp-location-data.js';

    export let graphData = { nodes: [], edges: [] };
    export let currentLocation = null;
    export let nextLocation = null;
    export let completedObjectives = new Set();
    export let onNodeClick = null;

    let container;
    let cy = null;
    let resizeObserver = null;
    $: currentLocationResolution = resolveRedppLocation(currentLocation);
    $: exactLocation = currentLocationResolution.exactLocation;
    $: guideLocation = currentLocationResolution.guideLocation;

    // Hover state
    let hoverPosition = null;
    let hoverNode = null;
    let showZoomPreview = false;

    // Register dagre layout
    cytoscape.use(dagre);

    // Color scheme
    const colors = {
        location: '#74b9ff',
        objective: '#00cec9',
        item: '#fdcb6e',
        pokemon: '#e17055',
        trainer: '#d63031',
        requirement: '#636e72',
        current: '#00ff88',
        next: '#fdcb6e',      // Orange/yellow for next destination
        completed: '#00b894',
        edge: '#555',
        edgeHighlight: '#74b9ff'
    };

    // Kanto geographic coordinates (normalized 0-1000 for width, 0-600 for height)
    // Based on actual Kanto map layout
    const kantoPositions = {
        // Northwest - Indigo Plateau area
        'Indigo Plateau': { x: 80, y: 50 },
        'Victory Road': { x: 80, y: 120 },
        'Route 23': { x: 80, y: 200 },
        'Route 22': { x: 150, y: 280 },

        // North center - Viridian/Pewter area
        'Viridian City': { x: 150, y: 350 },
        'Viridian Forest': { x: 150, y: 280 },
        'Route 2': { x: 150, y: 220 },
        'Pewter City': { x: 150, y: 150 },
        'Route 3': { x: 250, y: 150 },
        'Mt. Moon': { x: 350, y: 150 },
        'Route 4': { x: 450, y: 150 },

        // Northeast - Cerulean area
        'Cerulean City': { x: 550, y: 150 },
        'Route 24': { x: 550, y: 80 },
        'Route 25': { x: 650, y: 50 },
        'Route 9': { x: 650, y: 150 },
        'Rock Tunnel': { x: 750, y: 150 },
        'Route 10': { x: 750, y: 220 },
        'Power Plant': { x: 850, y: 120 },

        // East - Lavender area
        'Lavender Town': { x: 750, y: 300 },
        'Pokemon Tower': { x: 800, y: 300 },
        'Route 8': { x: 650, y: 300 },
        'Route 12': { x: 750, y: 400 },

        // Center - Saffron/Celadon
        'Saffron City': { x: 550, y: 300 },
        'Route 5': { x: 550, y: 220 },
        'Route 6': { x: 550, y: 380 },
        'Route 7': { x: 450, y: 300 },
        'Celadon City': { x: 350, y: 300 },
        'Route 16': { x: 250, y: 300 },
        'Cycling Road': { x: 200, y: 400 },
        'Route 17': { x: 200, y: 450 },
        'Underground Path': { x: 500, y: 260 },

        // South - Vermilion area
        'Vermilion City': { x: 550, y: 450 },
        'Vermillion City': { x: 550, y: 450 }, // Handle typo
        'Route 11': { x: 650, y: 450 },
        "Diglett's Cave": { x: 250, y: 180 },

        // Southeast - Fuchsia area
        'Route 13': { x: 750, y: 480 },
        'Route 14': { x: 700, y: 520 },
        'Route 15': { x: 600, y: 550 },
        'Fuchsia City': { x: 450, y: 550 },
        'Fuchsia City Gym': { x: 480, y: 550 },
        'Safari Zone': { x: 450, y: 480 },
        'Route 18': { x: 300, y: 500 },

        // Southwest - Pallet/Cinnabar
        'Pallet Town': { x: 150, y: 450 },
        "Prof. Oak's Lab": { x: 180, y: 470 },
        'Route 1': { x: 150, y: 400 },
        'Route 21': { x: 150, y: 520 },
        'Cinnabar Island': { x: 150, y: 580 },
        'Route 20': { x: 300, y: 580 },
        'Route 19': { x: 450, y: 580 },
        'Seafoam Islands': { x: 300, y: 580 }
    };

    // Map interior/specific game locations to their parent map location
    const locationAliases = {
        // Pallet Town interiors
        'PLAYERS HOUSE 1F': 'Pallet Town',
        'PLAYERS HOUSE 2F': 'Pallet Town',
        'RIVALS HOUSE': 'Pallet Town',
        'OAKS LAB': 'Pallet Town',
        "PROF. OAK'S LAB": 'Pallet Town',
        'PROF OAKS LAB': 'Pallet Town',
        // Viridian City
        'VIRIDIAN POKEMON CENTER': 'Viridian City',
        'VIRIDIAN POKEMART': 'Viridian City',
        'VIRIDIAN GYM': 'Viridian City',
        // Pewter City
        'PEWTER POKEMON CENTER': 'Pewter City',
        'PEWTER POKEMART': 'Pewter City',
        'PEWTER GYM': 'Pewter City',
        'PEWTER MUSEUM': 'Pewter City',
        // Cerulean City
        'CERULEAN POKEMON CENTER': 'Cerulean City',
        'CERULEAN POKEMART': 'Cerulean City',
        'CERULEAN GYM': 'Cerulean City',
        'CERULEAN BIKE SHOP': 'Cerulean City',
        // Vermilion City
        'VERMILION POKEMON CENTER': 'Vermilion City',
        'VERMILION POKEMART': 'Vermilion City',
        'VERMILION GYM': 'Vermilion City',
        'SS ANNE': 'Vermilion City',
        'S.S. ANNE': 'Vermilion City',
        // Celadon City
        'CELADON POKEMON CENTER': 'Celadon City',
        'CELADON DEPT STORE': 'Celadon City',
        'CELADON GYM': 'Celadon City',
        'CELADON GAME CORNER': 'Celadon City',
        'ROCKET HIDEOUT': 'Celadon City',
        // Saffron City
        'SAFFRON POKEMON CENTER': 'Saffron City',
        'SAFFRON POKEMART': 'Saffron City',
        'SAFFRON GYM': 'Saffron City',
        'SILPH CO': 'Saffron City',
        'FIGHTING DOJO': 'Saffron City',
        // Lavender Town
        'LAVENDER POKEMON CENTER': 'Lavender Town',
        'LAVENDER POKEMART': 'Lavender Town',
        'POKEMON TOWER 1F': 'Pokemon Tower',
        'POKEMON TOWER 2F': 'Pokemon Tower',
        'POKEMON TOWER 3F': 'Pokemon Tower',
        'POKEMON TOWER 4F': 'Pokemon Tower',
        'POKEMON TOWER 5F': 'Pokemon Tower',
        'POKEMON TOWER 6F': 'Pokemon Tower',
        'POKEMON TOWER 7F': 'Pokemon Tower',
        // Fuchsia City
        'FUCHSIA POKEMON CENTER': 'Fuchsia City',
        'FUCHSIA POKEMART': 'Fuchsia City',
        'FUCHSIA GYM': 'Fuchsia City',
        // Cinnabar Island
        'CINNABAR POKEMON CENTER': 'Cinnabar Island',
        'CINNABAR POKEMART': 'Cinnabar Island',
        'CINNABAR GYM': 'Cinnabar Island',
        'POKEMON MANSION': 'Cinnabar Island',
        'CINNABAR LAB': 'Cinnabar Island',
        // Mt. Moon
        'MT MOON 1F': 'Mt. Moon',
        'MT MOON B1F': 'Mt. Moon',
        'MT MOON B2F': 'Mt. Moon',
        // Rock Tunnel
        'ROCK TUNNEL 1F': 'Rock Tunnel',
        'ROCK TUNNEL B1F': 'Rock Tunnel',
        // Victory Road
        'VICTORY ROAD 1F': 'Victory Road',
        'VICTORY ROAD 2F': 'Victory Road',
        'VICTORY ROAD 3F': 'Victory Road',
        // Indigo Plateau
        'POKEMON LEAGUE': 'Indigo Plateau',
        'LORELEI': 'Indigo Plateau',
        'BRUNO': 'Indigo Plateau',
        'AGATHA': 'Indigo Plateau',
        'LANCE': 'Indigo Plateau',
        'CHAMPION': 'Indigo Plateau',
    };

    /**
     * Map a game location name to a graph node location
     */
    function mapLocationToNode(locationName) {
        if (!locationName) return null;
        return resolveRedppLocation(locationName).guideLocation;
    }

    function getNodePosition(nodeName, nodeType) {
        // For locations, use geographic position
        if (nodeType === 'location' && kantoPositions[nodeName]) {
            return kantoPositions[nodeName];
        }
        return null; // Will use layout for non-positioned nodes
    }

    function buildCytoscapeData(data) {
        const elements = [];

        // Only show locations for cleaner geographic view
        // Objectives and trainers clutter the map
        const visibleTypes = ['location'];
        const visibleNodes = new Set();

        // Build a map of location -> connected objectives for tooltip
        const locationObjectives = new Map();
        for (const edge of data.edges) {
            if (edge.type === 'contains') {
                const objectives = locationObjectives.get(edge.from) || [];
                const targetNode = data.nodes.find(n => n.id === edge.to);
                if (targetNode) objectives.push(targetNode.name);
                locationObjectives.set(edge.from, objectives);
            }
        }

        // Add nodes
        for (const node of data.nodes) {
            if (!visibleTypes.includes(node.type)) continue;

            const pos = getNodePosition(node.name, node.type);
            if (!pos) continue; // Skip locations without positions

            visibleNodes.add(node.id);

            const isCurrentLocation = node.name === guideLocation || node.id === guideLocation;
            const isNextLocation = node.name === nextLocation || node.id === nextLocation;
            const isCompleted = completedObjectives.has(node.name) || completedObjectives.has(node.id);
            const objectives = locationObjectives.get(node.id) || [];

            let bgColor = colors[node.type] || '#999';
            if (isCurrentLocation) bgColor = colors.current;
            else if (isNextLocation) bgColor = colors.next;
            else if (isCompleted) bgColor = colors.completed;

            elements.push({
                data: {
                    id: node.id,
                    label: node.name,
                    type: node.type,
                    description: node.description,
                    objectives: objectives.join(', '),
                    isGymLeader: node.isGymLeader,
                    badge: node.badge,
                    bgColor,
                    borderWidth: isCurrentLocation ? 4 : (isNextLocation ? 3 : (node.isGymLeader ? 3 : 1)),
                    borderColor: isCurrentLocation ? '#fff' : (isNextLocation ? '#fdcb6e' : (node.isGymLeader ? '#d63031' : '#333'))
                },
                position: pos
            });
        }

        // Add edges (only between visible nodes)
        for (const edge of data.edges) {
            if (!visibleNodes.has(edge.from) || !visibleNodes.has(edge.to)) continue;

            // Only show leads_to edges for geographic connections
            if (edge.type !== 'leads_to') continue;

            elements.push({
                data: {
                    id: `${edge.from}-${edge.to}`,
                    source: edge.from,
                    target: edge.to,
                    edgeType: edge.type,
                    method: edge.method
                }
            });
        }

        return elements;
    }

    function initGraph() {
        console.log('[Graph] initGraph called, container:', !!container, 'nodes:', graphData.nodes?.length || 0);
        if (!container || !graphData.nodes?.length) return;

        const elements = buildCytoscapeData(graphData);
        console.log('[Graph] Built', elements.length, 'cytoscape elements');

        cy = cytoscape({
            container,
            elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'label': 'data(label)',
                        'background-color': 'data(bgColor)',
                        'border-width': 'data(borderWidth)',
                        'border-color': 'data(borderColor)',
                        'color': '#fff',
                        'text-valign': 'bottom',
                        'text-halign': 'center',
                        'text-margin-y': 8,
                        'font-size': '9px',
                        'font-weight': '500',
                        'text-wrap': 'wrap',
                        'text-max-width': '70px',
                        'width': 16,
                        'height': 16,
                        'shape': 'ellipse',
                        'text-outline-width': 2,
                        'text-outline-color': '#1a1a2e'
                    }
                },
                {
                    selector: 'node[type="location"]',
                    style: {
                        'width': 20,
                        'height': 20,
                        'font-size': '10px',
                        'font-weight': 'bold'
                    }
                },
                {
                    selector: 'node[type="objective"]',
                    style: {
                        'width': 12,
                        'height': 12,
                        'font-size': '8px'
                    }
                },
                {
                    selector: 'node[type="trainer"]',
                    style: {
                        'width': 18,
                        'height': 18,
                        'shape': 'diamond'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 3,
                        'line-color': colors.edge,
                        'target-arrow-color': colors.edge,
                        'target-arrow-shape': 'none',
                        'curve-style': 'taxi',
                        'taxi-direction': 'horizontal',
                        'opacity': 0.5
                    }
                },
                {
                    selector: 'edge[edgeType="leads_to"]',
                    style: {
                        'width': 4,
                        'line-color': colors.edgeHighlight,
                        'target-arrow-color': colors.edgeHighlight,
                        'opacity': 0.9
                    }
                },
                {
                    selector: 'node:selected',
                    style: {
                        'border-width': 4,
                        'border-color': '#fff'
                    }
                }
            ],
            layout: {
                name: 'preset', // Use predefined geographic positions
                padding: 30
            },
            minZoom: 0.1,
            maxZoom: 4,
        });

        // Click handler
        cy.on('tap', 'node', (evt) => {
            const node = evt.target.data();
            if (onNodeClick) {
                onNodeClick(node);
            }
        });

        // Hover handlers for zoom preview
        cy.on('mousemove', (evt) => {
            const pos = evt.position;
            hoverPosition = pos;
            showZoomPreview = true;
            updateZoomPreview(pos);
        });

        cy.on('mouseout', () => {
            showZoomPreview = false;
            hoverNode = null;
        });

        cy.on('mouseover', 'node', (evt) => {
            hoverNode = evt.target.data();
        });

        cy.on('mouseout', 'node', () => {
            hoverNode = null;
        });

        // Fit to view with slight zoom
        cy.fit(undefined, 20);
        // Zoom in a bit more for better visibility
        cy.zoom(cy.zoom() * 1.3);
        cy.center();
    }

    // Control functions
    function zoomIn() {
        if (cy) {
            cy.zoom(cy.zoom() * 1.3);
            cy.center();
        }
    }

    function zoomOut() {
        if (cy) {
            cy.zoom(cy.zoom() / 1.3);
            cy.center();
        }
    }

    function resetView() {
        if (cy) {
            cy.fit(undefined, 20);
            cy.zoom(cy.zoom() * 1.3);
            cy.center();
        }
    }

    let previewDebounceTimer = null;
    let lastPreviewPos = null;

    // Find nearby nodes for the hover preview
    let nearbyNodes = [];

    function updateZoomPreview(pos) {
        if (!cy) return;
        lastPreviewPos = pos;

        // Find nodes near the cursor position
        const radius = 100; // in model coordinates
        nearbyNodes = cy.nodes().filter(node => {
            const nodePos = node.position();
            const dx = nodePos.x - pos.x;
            const dy = nodePos.y - pos.y;
            return Math.sqrt(dx * dx + dy * dy) < radius;
        }).map(node => node.data()).slice(0, 5); // Limit to 5 nearest
    }

    function updateHighlights() {
        if (!cy) return;

        cy.nodes().forEach(node => {
            const data = node.data();
            const isCurrentLocation = data.label === guideLocation || data.id === guideLocation;
            const isNextLocation = data.label === nextLocation || data.id === nextLocation;
            const isCompleted = completedObjectives.has(data.label) || completedObjectives.has(data.id);

            let bgColor = colors[data.type] || '#999';
            if (isCurrentLocation) bgColor = colors.current;
            else if (isNextLocation) bgColor = colors.next;
            else if (isCompleted) bgColor = colors.completed;

            node.data('bgColor', bgColor);
            node.data('borderWidth', isCurrentLocation ? 4 : (isNextLocation ? 3 : (data.isGymLeader ? 3 : 1)));
            node.data('borderColor', isCurrentLocation ? '#fff' : (isNextLocation ? '#fdcb6e' : (data.isGymLeader ? '#d63031' : '#333')));
        });
    }

    export function centerOnNode(nodeName) {
        if (!cy) {
            console.log('[Graph] centerOnNode: cy not initialized');
            return;
        }

        // Map game location to graph node location
        const mappedName = mapLocationToNode(nodeName);
        console.log('[Graph] centerOnNode:', nodeName, '-> mapped to:', mappedName);

        // Try to find by label or id
        let node = cy.nodes().filter(n => n.data('label') === mappedName);
        if (!node.length) {
            node = cy.nodes().filter(n => n.data('id') === mappedName);
        }
        // Also try case-insensitive match
        if (!node.length) {
            node = cy.nodes().filter(n =>
                n.data('label')?.toLowerCase() === mappedName?.toLowerCase()
            );
        }
        // Try original name if mapping didn't work
        if (!node.length && mappedName !== nodeName) {
            node = cy.nodes().filter(n =>
                n.data('label')?.toLowerCase() === nodeName?.toLowerCase()
            );
        }

        console.log('[Graph] centerOnNode: found', node.length, 'nodes');

        if (node.length) {
            cy.animate({
                center: { eles: node },
                zoom: 2,
                duration: 500
            });
        }
    }

    export function fitGraph() {
        if (cy) {
            cy.fit(undefined, 20);
        }
    }

    onMount(() => {
        initGraph();

        // Auto-fit when container resizes
        resizeObserver = new ResizeObserver(() => {
            if (cy) {
                cy.resize();
                cy.center();
            }
        });
        if (container) {
            resizeObserver.observe(container);
        }
    });

    onDestroy(() => {
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        if (cy) {
            cy.destroy();
            cy = null;
        }
    });

    // Reinitialize graph when data loads (handles async loading)
    $: if (container && graphData.nodes.length > 0 && !cy) {
        initGraph();
    }

    $: if (cy && currentLocation) {
        updateHighlights();
    }

    $: if (cy && completedObjectives) {
        updateHighlights();
    }

    $: if (cy && nextLocation) {
        updateHighlights();
    }

    // Auto-center on current location when it changes
    $: if (cy && currentLocation) {
        centerOnNode(currentLocation);
    }

    // Build current location info for the info panel
    $: currentLocationInfo = buildLocationInfo(currentLocation, graphData, completedObjectives);

    function buildLocationInfo(locName, data, completed) {
        if (!locName || !data?.nodes?.length) return null;

        // Map the location name
        const mappedName = mapLocationToNode(locName);

        // Find the location node
        const locationNode = data.nodes.find(n =>
            n.type === 'location' &&
            (n.name === mappedName || n.name.toLowerCase() === mappedName?.toLowerCase())
        );

        if (!locationNode) return {
            name: resolveRedppLocation(locName).exactLocation,
            guideContext: null,
            description: null,
            objectives: [],
            connections: [],
        };

        // Find objectives at this location
        const objectives = [];
        for (const edge of data.edges) {
            if (edge.from === locationNode.id && edge.type === 'contains') {
                const target = data.nodes.find(n => n.id === edge.to);
                if (target?.type === 'objective') {
                    objectives.push({
                        name: target.name,
                        completed: completed.has(target.name) || completed.has(target.id)
                    });
                }
            }
        }

        // Find connected locations
        const connections = [];
        for (const edge of data.edges) {
            if (edge.type === 'leads_to') {
                if (edge.from === locationNode.id) {
                    const target = data.nodes.find(n => n.id === edge.to);
                    if (target) connections.push({ name: target.name, direction: 'to' });
                } else if (edge.to === locationNode.id) {
                    const source = data.nodes.find(n => n.id === edge.from);
                    if (source) connections.push({ name: source.name, direction: 'from' });
                }
            }
        }

        return {
            name: resolveRedppLocation(locName).exactLocation,
            guideContext: locationNode.name,
            description: locationNode.description,
            objectives,
            connections: [...new Map(connections.map(c => [c.name, c])).values()].slice(0, 4)
        };
    }
</script>

<div class="graph-wrapper split-view">
    <!-- Left: Map -->
    <div class="map-side">
        <div class="graph-container" bind:this={container}></div>
        <div class="map-controls">
            <button class="map-ctrl-btn" on:click={zoomIn} title="Zoom In">+</button>
            <button class="map-ctrl-btn" on:click={zoomOut} title="Zoom Out">−</button>
            <button class="map-ctrl-btn" on:click={resetView} title="Reset View">⟲</button>
        </div>
    </div>

    <!-- Right: Location Info -->
    <div class="info-side">
        {#if currentLocationInfo}
            <div class="location-name">{currentLocationInfo.name}</div>
            {#if currentLocationInfo.guideContext && currentLocationInfo.guideContext !== currentLocationInfo.name}
                <div class="location-context">Guide context: {currentLocationInfo.guideContext}</div>
            {/if}
            {#if currentLocationInfo.description}
                <p class="location-desc">{currentLocationInfo.description}</p>
            {/if}

            {#if currentLocationInfo.objectives.length > 0}
                <div class="info-section">
                    <div class="info-label">Objectives</div>
                    <ul class="objectives-list">
                        {#each currentLocationInfo.objectives as obj}
                            <li class:completed={obj.completed}>
                                <span class="obj-marker">{obj.completed ? '✓' : '○'}</span>
                                {obj.name}
                            </li>
                        {/each}
                    </ul>
                </div>
            {/if}

            {#if currentLocationInfo.connections.length > 0}
                <div class="info-section">
                    <div class="info-label">Connected To</div>
                    <div class="connections-list">
                        {#each currentLocationInfo.connections as conn}
                            <span class="connection-chip">{conn.name}</span>
                        {/each}
                    </div>
                </div>
            {/if}
        {:else}
            <div class="no-location">
                <span>No location data</span>
            </div>
        {/if}
    </div>
</div>

<style>
    .graph-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
    }

    .graph-wrapper.split-view {
        display: flex;
        gap: 0;
    }

    .map-side {
        flex: 1;
        position: relative;
        min-width: 0;
    }

    .info-side {
        width: 220px;
        flex-shrink: 0;
        padding: 12px;
        background: var(--bg-input, #2a2a3e);
        border-left: 1px solid var(--border-color, #404060);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .location-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--accent-primary, #74b9ff);
    }

    .location-context {
        margin-top: -6px;
        font-size: 10px;
        color: var(--text-muted, #888);
    }

    .location-desc {
        font-size: 11px;
        color: var(--text-muted, #888);
        line-height: 1.4;
        margin: 0;
    }

    .info-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .info-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted, #888);
    }

    .objectives-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .objectives-list li {
        font-size: 11px;
        color: var(--text-secondary, #aaa);
        display: flex;
        align-items: flex-start;
        gap: 6px;
    }

    .objectives-list li.completed {
        color: var(--text-muted, #666);
        text-decoration: line-through;
    }

    .obj-marker {
        color: var(--accent-primary, #74b9ff);
        flex-shrink: 0;
    }

    .objectives-list li.completed .obj-marker {
        color: #00b894;
    }

    .connections-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .connection-chip {
        font-size: 10px;
        padding: 2px 6px;
        background: var(--bg-panel, #3a3a4e);
        border-radius: 4px;
        color: var(--text-secondary, #aaa);
    }

    .no-location {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted, #666);
        font-size: 12px;
    }

    .graph-container {
        width: 100%;
        height: 100%;
        min-height: 200px;
        background: var(--bg-dark, #1a1a2e);
        border-radius: 8px 0 0 8px;
        overflow: hidden;
    }

    .map-controls {
        position: absolute;
        bottom: 8px;
        left: 8px;
        display: flex;
        gap: 4px;
        z-index: 10;
    }

    .map-ctrl-btn {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-panel, #2d2d44);
        border: 1px solid var(--border-color, #404060);
        border-radius: 4px;
        color: var(--text-secondary, #b0b0c0);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .map-ctrl-btn:hover {
        background: var(--bg-input, #3d3d54);
        color: var(--text-primary, #fff);
        border-color: var(--accent-primary, #74b9ff);
    }

</style>
