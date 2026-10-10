const map = L.map('map').setView([40.4168, -3.7038], 12);

const canvasRenderer = L.canvas({ padding: 0.5 });

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const loadingProgress = document.getElementById('loading-progress');
const performanceIndicator = document.getElementById('performance-indicator');
const fpsElement = performanceIndicator ? performanceIndicator.querySelector('.fps') : null;
const speciesSearchInput = document.getElementById('species-search-input');
const speciesSuggestions = document.getElementById('species-suggestions');
const speciesTags = document.getElementById('species-tags');
const speciesFilterStatus = document.getElementById('species-filter-status');

const speciesState = {
    catalog: new Map(),
    selected: new Set(),
    allMarkers: [],
    activeSuggestion: -1,
    renderedSuggestions: [],
    uiRefreshFrame: null
};

const MAX_SPECIES_SUGGESTIONS = 10;
const speciesImageCache = new Map();
const WIKIPEDIA_API_URL = 'https://es.wikipedia.org/w/api.php';
const WIKIMEDIA_COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';

function metadataText(value) {
    if (!value) return '';
    const documentFragment = new DOMParser().parseFromString(String(value), 'text/html');
    return (documentFragment.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function safeExternalUrl(value) {
    if (!value) return '';

    try {
        const normalizedValue = String(value).startsWith('//') ? `https:${value}` : String(value);
        const url = new URL(normalizedValue);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch {
        return '';
    }
}

async function fetchJsonWithTimeout(url, timeout = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

function getWikipediaTitleCandidates(scientificName) {
    const candidates = [scientificName.trim()];
    const withoutCultivar = scientificName
        .replace(/\s+(?:cv\.\s*)?['"][^'"]+['"]\s*$/i, '')
        .trim();

    if (withoutCultivar && withoutCultivar !== candidates[0]) {
        candidates.push(withoutCultivar);
    }

    return candidates;
}

async function queryWikimediaSpeciesImage(scientificName) {
    for (const title of getWikipediaTitleCandidates(scientificName)) {
        const wikipediaParams = new URLSearchParams({
            action: 'query',
            format: 'json',
            origin: '*',
            prop: 'pageimages|info',
            inprop: 'url',
            piprop: 'thumbnail|name',
            pithumbsize: '640',
            pilicense: 'free',
            redirects: '1',
            titles: title
        });

        const wikipediaData = await fetchJsonWithTimeout(`${WIKIPEDIA_API_URL}?${wikipediaParams}`);
        const page = Object.values(wikipediaData.query?.pages || {})[0];
        if (!page || Object.prototype.hasOwnProperty.call(page, 'missing') || !page.thumbnail?.source || !page.pageimage) {
            continue;
        }

        const commonsParams = new URLSearchParams({
            action: 'query',
            format: 'json',
            origin: '*',
            prop: 'imageinfo',
            iiprop: 'url|extmetadata',
            iiurlwidth: '640',
            titles: `File:${page.pageimage}`
        });

        const commonsData = await fetchJsonWithTimeout(`${WIKIMEDIA_COMMONS_API_URL}?${commonsParams}`);
        const commonsPage = Object.values(commonsData.query?.pages || {})[0];
        const imageInfo = commonsPage?.imageinfo?.[0];
        const metadata = imageInfo?.extmetadata || {};
        const imageUrl = safeExternalUrl(imageInfo?.thumburl || page.thumbnail.source);
        const sourceUrl = safeExternalUrl(imageInfo?.descriptionurl || page.fullurl);
        const author = metadataText(metadata.Attribution?.value || metadata.Artist?.value);
        const license = metadataText(metadata.LicenseShortName?.value);
        const licenseUrl = safeExternalUrl(metadata.LicenseUrl?.value);

        // Only display images whose source and licensing metadata can be linked.
        if (!imageUrl || !sourceUrl || (!author && !license)) continue;

        return {
            imageUrl,
            sourceUrl,
            author: author || 'Autor indicado en Wikimedia Commons',
            license: license || 'Licencia indicada en Wikimedia Commons',
            licenseUrl,
            wikipediaUrl: safeExternalUrl(page.fullurl),
            matchedTitle: page.title
        };
    }

    return null;
}

function getSpeciesImage(scientificName) {
    const cacheKey = normalizeSpeciesName(scientificName);
    if (!cacheKey) return Promise.resolve(null);

    if (!speciesImageCache.has(cacheKey)) {
        const imagePromise = queryWikimediaSpeciesImage(scientificName).catch(error => {
            console.warn(`No se pudo cargar la imagen de ${scientificName}:`, error.message);
            return null;
        });
        speciesImageCache.set(cacheKey, imagePromise);
    }

    return speciesImageCache.get(cacheKey);
}

function createExternalLink(url, text, className = '') {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;
    if (className) link.className = className;
    return link;
}

async function loadSpeciesImageIntoPopup(marker, scientificName, container) {
    const imageData = await getSpeciesImage(scientificName);
    const popup = marker.getPopup();

    if (!container) return;
    if (!imageData) {
        container.remove();
        popup.update();
        return;
    }

    const figure = document.createElement('figure');
    const imageLink = createExternalLink(imageData.sourceUrl, '');
    imageLink.title = `Ver imagen y licencia en Wikimedia Commons`;

    const image = document.createElement('img');
    image.src = imageData.imageUrl;
    image.alt = scientificName;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('load', () => popup.update(), { once: true });
    image.addEventListener('error', () => {
        container.remove();
        popup.update();
    }, { once: true });
    imageLink.appendChild(image);

    const caption = document.createElement('figcaption');
    caption.append('Foto: ', createExternalLink(imageData.sourceUrl, imageData.author));
    caption.append(' · ');
    if (imageData.licenseUrl) {
        caption.appendChild(createExternalLink(imageData.licenseUrl, imageData.license));
    } else {
        caption.append(imageData.license);
    }
    caption.append(' · ', createExternalLink(imageData.sourceUrl, 'Wikimedia Commons'));

    figure.append(imageLink, caption);
    container.replaceChildren(figure);
    popup.update();
}

/**
 * Normalize names once when they enter the catalog. This makes every keystroke
 * a very small, accent-insensitive lookup over unique species rather than over
 * hundreds of thousands of markers.
 */
function normalizeSpeciesName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('es')
        .replace(/\s+/g, ' ')
        .trim();
}

function getSpeciesInfo(props) {
    const scientificName = String(props.sn || props.species || props["Nombre científico"] || '').trim();
    const commonName = String(props.cn || props.common_name || props.CODIGO_ESP || '').trim();
    const normalizedScientific = normalizeSpeciesName(scientificName);
    const normalizedCommon = normalizeSpeciesName(commonName);

    if (!normalizedScientific && !normalizedCommon) return null;

    return {
        id: normalizedScientific ? `scientific:${normalizedScientific}` : `common:${normalizedCommon}`,
        scientificName,
        commonName
    };
}

function scheduleSpeciesUiRefresh() {
    if (speciesState.uiRefreshFrame !== null) return;

    speciesState.uiRefreshFrame = requestAnimationFrame(() => {
        speciesState.uiRefreshFrame = null;
        updateSpeciesFilterStatus();
        if (speciesSearchInput && document.activeElement === speciesSearchInput && speciesSearchInput.value.trim()) {
            renderSpeciesSuggestions();
        }
    });
}

function registerSpecies(props, marker) {
    speciesState.allMarkers.push(marker);
    const info = getSpeciesInfo(props);
    if (!info) return null;

    let record = speciesState.catalog.get(info.id);
    let catalogChanged = false;

    if (!record) {
        record = {
            id: info.id,
            scientificName: info.scientificName,
            commonNames: new Set(),
            normalizedScientific: normalizeSpeciesName(info.scientificName),
            normalizedCommonNames: [],
            searchText: '',
            markers: []
        };
        speciesState.catalog.set(info.id, record);
        catalogChanged = true;
    }

    if (info.commonName && !record.commonNames.has(info.commonName)) {
        record.commonNames.add(info.commonName);
        record.normalizedCommonNames = Array.from(record.commonNames, normalizeSpeciesName);
        catalogChanged = true;
    }

    if (!record.scientificName && info.scientificName) {
        record.scientificName = info.scientificName;
        record.normalizedScientific = normalizeSpeciesName(info.scientificName);
        catalogChanged = true;
    }

    if (catalogChanged) {
        record.searchText = [record.normalizedScientific, ...record.normalizedCommonNames].join(' ');
        scheduleSpeciesUiRefresh();
    }

    record.markers.push(marker);
    marker.speciesId = record.id;
    return record.id;
}

function getSpeciesDisplayName(record) {
    return record.commonNames.values().next().value || record.scientificName || 'Especie sin nombre';
}

function getSpeciesSecondaryName(record) {
    const commonName = record.commonNames.values().next().value;
    return commonName && record.scientificName && commonName !== record.scientificName
        ? record.scientificName
        : '';
}

function getMatchingSpecies(query) {
    const normalizedQuery = normalizeSpeciesName(query);
    if (!normalizedQuery) return [];

    const matches = [];
    for (const record of speciesState.catalog.values()) {
        if (speciesState.selected.has(record.id) || !record.searchText.includes(normalizedQuery)) continue;

        const startsWithCommon = record.normalizedCommonNames.some(name => name.startsWith(normalizedQuery));
        const startsWithScientific = record.normalizedScientific.startsWith(normalizedQuery);
        const score = startsWithCommon ? 0 : startsWithScientific ? 1 : 2;
        matches.push({ record, score });
    }

    matches.sort((a, b) => a.score - b.score
        || getSpeciesDisplayName(a.record).localeCompare(getSpeciesDisplayName(b.record), 'es'));

    return matches.slice(0, MAX_SPECIES_SUGGESTIONS).map(match => match.record);
}

function closeSpeciesSuggestions() {
    if (!speciesSuggestions || !speciesSearchInput) return;
    speciesSuggestions.hidden = true;
    speciesSuggestions.replaceChildren();
    speciesSearchInput.setAttribute('aria-expanded', 'false');
    speciesSearchInput.setAttribute('aria-activedescendant', '');
    speciesState.activeSuggestion = -1;
    speciesState.renderedSuggestions = [];
}

function updateActiveSuggestion() {
    if (!speciesSuggestions || !speciesSearchInput) return;

    const options = speciesSuggestions.querySelectorAll('[role="option"]');
    options.forEach((option, index) => {
        const isActive = index === speciesState.activeSuggestion;
        option.classList.toggle('active', isActive);
        option.setAttribute('aria-selected', String(isActive));
    });

    const activeOption = options[speciesState.activeSuggestion];
    speciesSearchInput.setAttribute('aria-activedescendant', activeOption ? activeOption.id : '');
    if (activeOption) activeOption.scrollIntoView({ block: 'nearest' });
}

function renderSpeciesSuggestions() {
    if (!speciesSuggestions || !speciesSearchInput) return;

    const query = speciesSearchInput.value;
    if (!query.trim()) {
        closeSpeciesSuggestions();
        return;
    }

    const matches = getMatchingSpecies(query);
    speciesState.renderedSuggestions = matches;
    speciesState.activeSuggestion = -1;
    speciesSuggestions.replaceChildren();

    if (matches.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'species-no-results';
        emptyItem.textContent = districtState.isLoading ? 'Buscando mientras cargan los datos...' : 'No se encontraron especies';
        speciesSuggestions.appendChild(emptyItem);
    } else {
        matches.forEach((record, index) => {
            const option = document.createElement('li');
            option.id = `species-option-${index}`;
            option.className = 'species-suggestion';
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');

            const primary = document.createElement('span');
            primary.className = 'species-suggestion-common';
            primary.textContent = getSpeciesDisplayName(record);
            option.appendChild(primary);

            const secondaryName = getSpeciesSecondaryName(record);
            if (secondaryName) {
                const secondary = document.createElement('span');
                secondary.className = 'species-suggestion-scientific';
                secondary.textContent = secondaryName;
                option.appendChild(secondary);
            }

            option.addEventListener('mousedown', event => event.preventDefault());
            option.addEventListener('click', () => selectSpecies(record.id));
            speciesSuggestions.appendChild(option);
        });
    }

    speciesSuggestions.hidden = false;
    speciesSearchInput.setAttribute('aria-expanded', 'true');
}

function renderSpeciesTags() {
    if (!speciesTags) return;
    speciesTags.replaceChildren();

    for (const speciesId of speciesState.selected) {
        const record = speciesState.catalog.get(speciesId);
        if (!record) continue;

        const tag = document.createElement('span');
        tag.className = 'species-tag';
        tag.title = [getSpeciesDisplayName(record), getSpeciesSecondaryName(record)].filter(Boolean).join(' · ');

        const label = document.createElement('span');
        label.className = 'species-tag-label';
        label.textContent = getSpeciesDisplayName(record);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'species-tag-remove';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', `Quitar ${getSpeciesDisplayName(record)} del filtro`);
        removeButton.addEventListener('click', () => deselectSpecies(speciesId));

        tag.append(label, removeButton);
        speciesTags.appendChild(tag);
    }
}

function updateSpeciesFilterStatus() {
    if (!speciesFilterStatus) return;

    if (speciesState.selected.size === 0) {
        speciesFilterStatus.textContent = `${speciesState.catalog.size.toLocaleString('es-ES')} especies disponibles`;
        return;
    }

    let matchingTrees = 0;
    for (const speciesId of speciesState.selected) {
        matchingTrees += speciesState.catalog.get(speciesId)?.markers.length || 0;
    }

    const speciesLabel = speciesState.selected.size === 1 ? 'especie seleccionada' : 'especies seleccionadas';
    speciesFilterStatus.textContent = `${speciesState.selected.size} ${speciesLabel} · ${matchingTrees.toLocaleString('es-ES')} árboles cargados coinciden`;
}

function selectSpecies(speciesId) {
    const record = speciesState.catalog.get(speciesId);
    if (!record || speciesState.selected.has(speciesId)) return;

    const isFirstSelection = speciesState.selected.size === 0;
    speciesState.selected.add(speciesId);

    if (isFirstSelection) {
        markers.clearLayers();
    }
    if (record.markers.length > 0) {
        markers.addLayers(record.markers);
    }

    renderSpeciesTags();
    updateSpeciesFilterStatus();
    speciesSearchInput.value = '';
    closeSpeciesSuggestions();
    speciesSearchInput.focus();
}

function deselectSpecies(speciesId) {
    const record = speciesState.catalog.get(speciesId);
    if (!record || !speciesState.selected.delete(speciesId)) return;

    if (speciesState.selected.size === 0) {
        markers.clearLayers();
        markers.addLayers(speciesState.allMarkers);
    } else if (record.markers.length > 0) {
        markers.removeLayers(record.markers);
    }

    renderSpeciesTags();
    updateSpeciesFilterStatus();
}

function setupSpeciesSearch() {
    if (!speciesSearchInput || !speciesSuggestions) return;

    speciesSearchInput.addEventListener('input', renderSpeciesSuggestions);
    speciesSearchInput.addEventListener('focus', renderSpeciesSuggestions);
    speciesSearchInput.addEventListener('keydown', event => {
        const suggestionCount = speciesState.renderedSuggestions.length;

        if (event.key === 'ArrowDown' && suggestionCount > 0) {
            event.preventDefault();
            speciesState.activeSuggestion = (speciesState.activeSuggestion + 1) % suggestionCount;
            updateActiveSuggestion();
        } else if (event.key === 'ArrowUp' && suggestionCount > 0) {
            event.preventDefault();
            speciesState.activeSuggestion = speciesState.activeSuggestion <= 0
                ? suggestionCount - 1
                : speciesState.activeSuggestion - 1;
            updateActiveSuggestion();
        } else if (event.key === 'Enter' && speciesState.activeSuggestion >= 0) {
            event.preventDefault();
            selectSpecies(speciesState.renderedSuggestions[speciesState.activeSuggestion].id);
        } else if (event.key === 'Escape') {
            closeSpeciesSuggestions();
        }
    });

    document.addEventListener('click', event => {
        if (!event.target.closest('#species-search-panel')) closeSpeciesSuggestions();
    });
}

/**
 * Display an error message to the user.
 * Hides the loading overlay and shows a temporary error message that auto-removes after 5 seconds.
 * 
 * @param {string} message - The error message to display to the user
 */
function showError(message) {
    loadingOverlay.classList.add('hidden');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `<strong>Error:</strong><br>${message}`;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

/**
 * Hide the loading overlay with a short delay for smooth transition.
 * Provides visual feedback that loading is complete.
 */
function hideLoading() {
    setTimeout(() => {
        loadingOverlay.classList.add('hidden');
    }, 500);
}

/**
 * Marker cluster group configuration for tree markers.
 * Optimized for performance with chunked loading, dynamic cluster radius based on zoom level,
 * and disabled animations for better responsiveness with large datasets.
 * 
 * Key features:
 * - Chunked loading: Processes markers in batches to keep UI responsive
 * - Dynamic cluster radius: Smaller radius at higher zoom levels for better detail
 * - Clustering disabled at zoom 19: Shows individual markers at maximum zoom
 * - Removes markers outside visible bounds: Reduces memory usage
 */
const markers = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 100,
    chunkDelay: 10,
    maxClusterRadius: function(zoom) {
        return zoom < 13 ? 120 : zoom < 15 ? 80 : 50;
    },
    spiderfyOnMaxZoom: false,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 19,
    removeOutsideVisibleBounds: true,
    animate: false,
    animateAddingMarkers: false,
    spiderfyDistanceMultiplier: 1,
    iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        let sizeClass = 'small';
        
        if (count > 5000) sizeClass = 'large';
        else if (count > 1000) sizeClass = 'large';
        else if (count > 100) sizeClass = 'medium';
        
        return L.divIcon({
            html: '<div><span>' + (count > 9999 ? (count/1000).toFixed(1) + 'k' : count) + '</span></div>',
            className: 'marker-cluster marker-cluster-' + sizeClass,
            iconSize: L.point(40, 40)
        });
    }
});

/**
 * Global state object for managing district data loading.
 * Tracks which districts have been loaded to avoid duplicate requests.
 * 
 * Properties:
 * - index: District index JSON containing metadata about all districts
 * - loadedDistricts: Set of district codes that have been loaded
 * - districtLayers: Object tracking loaded district layers
 * - isLoading: Flag to prevent concurrent loading operations
 */
const districtState = {
    index: null,
    loadedDistricts: new Set(),
    districtLayers: {},
    isLoading: false
};

/**
 * Load the district index JSON file containing metadata about all districts.
 * The index includes district codes, names, filenames, tree counts, and file sizes.
 * 
 * @returns {Promise<boolean>} True if index loaded successfully, false otherwise
 */
async function loadDistrictIndex() {
    try {
        const response = await fetch('./data/districts/districts_index.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        districtState.index = await response.json();
        console.log(`📋 Índice cargado: ${districtState.index.total_districts} distritos, ${districtState.index.total_trees.toLocaleString()} árboles`);
        return true;
    } catch (error) {
        console.error('Error al cargar el índice:', error);
        showError('No se pudo cargar el índice de distritos');
        return false;
    }
}

/**
 * Yield control back to the browser to maintain UI responsiveness.
 * Used during long-running operations to prevent blocking the main thread.
 * 
 * @returns {Promise<void>} Promise that resolves immediately, allowing other tasks to run
 */
function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Calculate marker radius based on tree size (diameter + height).
 * Optimized for performance with minimal overhead per marker.
 * 
 * Size Calculation:
 * - Combines diameter (cm) and height (m) with weighted formula
 * - Diameter weighted at 40%, height weighted at 60% (height prioritized)
 * - Height converted to cm equivalent: height × 10 × 0.6
 * - Size = (diameter × 0.4) + (height × 10 × 0.6)
 * 
 * Radius Ranges (based on calculated size):
 * - Small trees (0-20 cm equivalent): 4-6 px
 * - Medium trees (20-50 cm equivalent): 6-10 px
 * - Large trees (50-100 cm equivalent): 10-16 px
 * - Very large trees (100+ cm equivalent): 16-26 px (uses square root scaling)
 * 
 * Special Cases:
 * - Missing/invalid data: returns 4px (small default marker)
 * - Extremely tall trees (20+ meters): adds +2px bonus (max 28px)
 * 
 * Performance: Uses fast property access and pre-computed constants for minimal CPU overhead.
 */
function calculateMarkerRadius(props) {
    const d = props.d;
    const h = props.h;
    
    let size = 0;
    let hasData = false;
    let isExtremelyTall = false;
    
    if (d && d > 0) {
        size += d * 0.4;
        hasData = true;
    }
    
    if (h && h > 0) {
        size += h * 10 * 0.6;
        hasData = true;
        
        if (h >= 20) {
            isExtremelyTall = true;
        }
    }
    
    if (!hasData || size <= 0) {
        return 4;
    }
    
    let radius;
    
    if (size < 20) {
        radius = 4 + size * 0.1;
    }
    else if (size < 50) {
        radius = 6 + (size - 20) * 0.133333;
    }
    else if (size < 100) {
        radius = 10 + (size - 50) * 0.12;
    }
    else {
        const excess = size - 100;
        if (excess > 200) {
            radius = 26;
        } else {
            radius = 16 + Math.sqrt(excess * 0.005) * 10;
        }
    }
    
    if (isExtremelyTall) {
        radius += 2;
        if (radius > 28) radius = 28;
    }
    
    return radius;
}

/**
 * Load tree data for a specific district and create markers on the map.
 * 
 * This function:
 * - Fetches the district's GeoJSON file
 * - Processes trees in chunks of 500 for better performance
 * - Creates circle markers with size and color based on tree properties
 * - Adds click handlers with popup information
 * - Yields to browser periodically to keep UI responsive
 * 
 * Marker properties:
 * - District 22 (Árboles Singulares): Fixed 8px radius, purple color (#9C27B0)
 * - Other districts:
 *   * Radius: Calculated based on tree diameter and height (see calculateMarkerRadius)
 *   * Color: Based on tree height:
 *     - < 16m: Regular green (#4CAF50)
 *     - 16-18.99m: Stronger green (#2E7D32)
 *     - ≥ 19m: Dark green-purple (#2D4A3A)
 * 
 * Popup includes: species, common name, diameter, height, district, neighborhood,
 * and links to Google Street View and image search.
 * 
 * @param {Object} districtInfo - District information object with code, name, and filename
 * @returns {Promise<void>} Resolves when district is loaded (or skipped if already loaded)
 */
async function loadDistrict(districtInfo) {
    const districtCode = districtInfo.code;
    
    if (districtState.loadedDistricts.has(districtCode)) {
        return;
    }
    
    console.log(`📥 Cargando distrito ${districtCode} - ${districtInfo.name}...`);
    
    try {
        const response = await fetch(`./data/districts/${districtInfo.filename}`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        // District name is the same for every feature in this file, so we read it
        // once from the FeatureCollection properties (populated by split-by-district.py)
        // instead of storing it on every feature's properties.
        const districtName = (data.properties && data.properties.district_name)
            || districtInfo.name
            || '';

        const districtMarkers = [];
        const chunkSize = 500; // Process trees in smaller chunks
        
        for (let i = 0; i < data.features.length; i++) {
            const feature = data.features[i];
            
            if (feature.geometry && feature.geometry.coordinates) {
                const [lng, lat] = feature.geometry.coordinates;
                const props = feature.properties || {};
                
                // Special styling for district 22 (Árboles Singulares)
                let markerRadius, fillColor, borderColor;
                
                if (districtCode === '22') {
                    // District 22: purple markers with fixed 8px radius
                    markerRadius = 8;
                    fillColor = '#9C27B0';  // Purple
                    borderColor = '#6A1B9A'; // Darker purple
                } else {
                    // Other districts: calculate radius based on tree size
                    markerRadius = calculateMarkerRadius(props);
                    
                    // Check tree height for color classification
                    const height = props.h || props.height;
                    const isTopTallTree = height && height >= 19; // 19m or more - dark green almost purple
                    const isTallTree = height && height >= 16; // 16m or more - stronger green
                    
                    // Color scheme based on height:
                    // < 16m: regular green
                    // 16m-18.99m: stronger green
                    // ≥ 19m: dark green almost purple
                    if (isTopTallTree) {
                        // 19m or taller: dark green almost purple
                        fillColor = '#2D4A3A';
                        borderColor = '#1B3A2A';
                    } else if (isTallTree) {
                        // 16m or taller (but < 19m): stronger green
                        fillColor = '#2E7D32';
                        borderColor = '#1B5E20';
                    } else {
                        // Regular trees: medium green
                        fillColor = '#4CAF50';
                        borderColor = '#2E7D32';
                    }
                }
                
                const marker = L.circleMarker([lat, lng], {
                    renderer: canvasRenderer,
                    radius: markerRadius,
                    fillColor: fillColor,
                    color: borderColor,
                    weight: 1,
                    opacity: 0.8,
                    fillOpacity: 0.6
                });

                registerSpecies(props, marker);
                
                marker.on('click', function() {
                    const scientificName = props.sn || props.species || props["Nombre científico"] || "";
                    const species = scientificName || "Especie desconocida";
                    const commonName = props.cn || props.common_name || props.CODIGO_ESP || "";
                    const diameter = props.d || props.diameter ? `${props.d || props.diameter} cm` : "N/A";
                    const height = props.h || props.height ? `${props.h || props.height} m` : "N/A";
                    // District is read from the enclosing FeatureCollection (districtName)
                    // rather than from every feature, which removes ~15 MB of redundant data.
                    const district = districtName || props.dt || props.NBRE_DTO || "";
                    const neighborhood = props.nb || props.NBRE_BARRI || "";
                    
                    // Track tree marker click in Google Analytics
                    if (typeof gtag === 'function') {
                        gtag('event', 'tree_marker_click', {
                            'tree_species': species,
                            'tree_common_name': commonName,
                            'tree_height': props.h || props.height || null,
                            'tree_diameter': props.d || props.diameter || null,
                            'tree_district': district,
                            'tree_neighborhood': neighborhood
                        });
                    }
                    
                    // Google Street View URL - opens Street View camera directly
                    const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
                    
                    // Google Images search URL - use commonName for district 22, otherwise use scientific name
                    const searchTerm = (districtCode === '22' && commonName) ? commonName : species;
                    const imagesSearchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(searchTerm)}`;
                    
                    let popupContent = `<div class="tree-info">`;
                    popupContent += `<span class="tree-species">🌳 ${species}</span>`;
                    if (commonName && commonName !== species) {
                        popupContent += `<span class="tree-common-name">${commonName}</span>`;
                    }
                    if (scientificName) {
                        popupContent += `<div class="tree-photo" aria-live="polite"><div class="tree-photo-loading">Cargando fotografía...</div></div>`;
                    }
                    popupContent += `<div class="tree-details">`;
                    if (districtCode === '22') {
                        popupContent += `
                        <div class="tree-details-item">
                            <strong>Árbol singular de la Comunidad de Madrid</strong>
                            <a href="https://es.wikipedia.org/wiki/%C3%81rboles_singulares_de_la_Comunidad_de_Madrid"
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Más información">
                            ℹ️
                            </a>
                        </div>
                        `;
                    } else {
                        popupContent += `<div class="tree-details-item"><strong>Diámetro:</strong> ${diameter}</div>`;
                        popupContent += `<div class="tree-details-item"><strong>Altura:</strong> ${height}</div>`;
                    }
                    
                    popupContent += `</div>`;
                    if ((district || neighborhood) && districtCode !== '22') {
                        popupContent += `<div class="tree-location">`;
                        if (district) {
                            popupContent += `<div class="tree-location-item"><strong>Distrito:</strong> ${district}</div>`;
                        }
                        if (neighborhood) {
                            popupContent += `<div class="tree-location-item"><strong>Barrio:</strong> ${neighborhood}</div>`;
                        }
                        popupContent += `</div>`;
                    }
                    popupContent += `<div class="tree-buttons">`;
                    popupContent += `
                        <a href="${streetViewUrl}" target="_blank" rel="noopener noreferrer" class="tree-action-button street-view-button" aria-label="Abrir esta ubicación en Street View">
                            <span class="tree-action-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"></path>
                                    <circle cx="12" cy="10" r="2.5"></circle>
                                </svg>
                            </span>
                            <span class="tree-action-copy"><strong>Street View</strong><small>Ver ubicación</small></span>
                        </a>`;
                    popupContent += `
                        <a href="${imagesSearchUrl}" target="_blank" rel="noopener noreferrer" class="tree-action-button images-button" aria-label="Buscar imágenes de esta especie">
                            <span class="tree-action-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="4" width="18" height="16" rx="3"></rect>
                                    <circle cx="8.5" cy="9" r="1.5"></circle>
                                    <path d="m21 15-4.5-4.5L7 20"></path>
                                </svg>
                            </span>
                            <span class="tree-action-copy"><strong>Imágenes</strong><small>Ver especie</small></span>
                        </a>`;
                    popupContent += `</div>`;
                    popupContent += `</div>`;
                    
                    const popupElement = document.createElement('div');
                    popupElement.innerHTML = popupContent;
                    marker.bindPopup(popupElement).openPopup();
                    if (scientificName) {
                        const photoContainer = popupElement.querySelector('.tree-photo');
                        loadSpeciesImageIntoPopup(marker, scientificName, photoContainer).catch(error => {
                            console.warn(`No se pudo mostrar la imagen de ${scientificName}:`, error.message);
                            photoContainer?.remove();
                            marker.getPopup()?.update();
                        });
                    }
                });
                
                districtMarkers.push(marker);
            }
            
            // Yield to browser periodically to keep UI responsive
            if (i > 0 && i % chunkSize === 0) {
                // Add current chunk to map
                const currentChunk = districtMarkers.splice(0);
                const visibleChunk = speciesState.selected.size === 0
                    ? currentChunk
                    : currentChunk.filter(marker => speciesState.selected.has(marker.speciesId));
                if (visibleChunk.length > 0) markers.addLayers(visibleChunk);
                scheduleSpeciesUiRefresh();
                await yieldToMain();
            }
        }
        
        // Add remaining markers
        if (districtMarkers.length > 0) {
            const visibleMarkers = speciesState.selected.size === 0
                ? districtMarkers
                : districtMarkers.filter(marker => speciesState.selected.has(marker.speciesId));
            if (visibleMarkers.length > 0) markers.addLayers(visibleMarkers);
            scheduleSpeciesUiRefresh();
        }
        
        districtState.districtLayers[districtCode] = true; // Just track loaded state
        districtState.loadedDistricts.add(districtCode);
        
        console.log(`✅ Distrito ${districtCode} cargado: ${data.features.length.toLocaleString()} árboles`);
        
    } catch (error) {
        console.error(`Error al cargar distrito ${districtCode}:`, error);
    }
}

/**
 * Get the list of districts that should be loaded based on current map view.
 * Currently returns all districts regardless of zoom level or bounds.
 * 
 * Future enhancement: Could filter districts based on map bounds for better performance.
 * 
 * @returns {Array} Array of district objects from the index, or empty array if index not loaded
 */
function getVisibleDistricts() {
    if (!districtState.index) return [];
    
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    
    if (zoom < 11) {
        return districtState.index.districts;
    }
    
    return districtState.index.districts;
}

/**
 * Load all visible districts one at a time to keep UI responsive.
 * Updates loading progress indicator as districts are loaded.
 * 
 * Prevents concurrent loading operations using the isLoading flag.
 * Skips districts that have already been loaded.
 * 
 * @returns {Promise<void>} Resolves when all visible districts have been processed
 */
async function loadVisibleDistricts() {
    if (districtState.isLoading) return;
    
    districtState.isLoading = true;
    const visibleDistricts = getVisibleDistricts();
    
    // Load one district at a time to keep UI responsive
    for (let i = 0; i < visibleDistricts.length; i++) {
        const district = visibleDistricts[i];
        
        if (!districtState.loadedDistricts.has(district.code)) {
            await loadDistrict(district);
            
            const loaded = districtState.loadedDistricts.size;
            const total = districtState.index.districts.length;
            const percentage = Math.round((loaded / total) * 100);
            loadingProgress.textContent = `Distritos: ${loaded} / ${total} (${percentage}%)`;
            
            // Yield to browser between districts
            await yieldToMain();
        }
    }
    
    districtState.isLoading = false;
}

/**
 * Set up performance monitoring to display visible marker count.
 * Updates the performance indicator when map is moved or zoomed.
 * 
 * The indicator shows the number of visible markers and automatically hides
 * after 2 seconds of inactivity.
 */
function setupPerformanceMonitoring() {
    if (!performanceIndicator) return;
    
    let hideTimeout;
    
    function updatePerformanceIndicator() {
        const visibleMarkers = markers.getVisibleParent ? 
            Object.keys(markers._featureGroup._layers).length : 0;
        
        if (fpsElement) {
            fpsElement.textContent = visibleMarkers.toLocaleString();
        }
        
        performanceIndicator.classList.add('show');
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => {
            performanceIndicator.classList.remove('show');
        }, 2000);
    }
    
    map.on('moveend zoomend', updatePerformanceIndicator);
    setTimeout(updatePerformanceIndicator, 1000);
}

/**
 * Initialize the map application.
 * 
 * This is the main initialization function that:
 * 1. Adds the marker cluster group to the map
 * 2. Loads the district index JSON file
 * 3. Starts loading visible districts in the background
 * 4. Sets up event handlers for lazy loading on map movement/zoom
 * 5. Initializes performance monitoring
 * 
 * The map remains interactive during loading, allowing users to pan and zoom
 * while trees are loaded progressively.
 * 
 * @returns {Promise<void>} Resolves when initialization is complete
 */
async function initialize() {
    // Initialize map layer immediately
    map.addLayer(markers);
    setupSpeciesSearch();
    
    // Load district index in background
    loadingText.textContent = 'Cargando árboles...';
    loadingProgress.textContent = 'Preparando datos...';
    
    const success = await loadDistrictIndex();
    if (!success) {
        showError('No se pudo inicializar el mapa');
        hideLoading();
        return;
    }
    
    // Load trees in background while map is interactive
    loadVisibleDistricts().then(() => {
        hideLoading();
        console.log(`✅ Carga inicial completa`);
        console.log(`📊 ${districtState.loadedDistricts.size} distritos cargados`);
    });
    
    // Set up event handlers for lazy loading
    map.on('moveend zoomend', () => {
        loadVisibleDistricts();
    });
    
    setupPerformanceMonitoring();
    
    console.log(`✅ Mapa inicializado y listo para interacción`);
}

// Info button toggle
const infoButton = document.getElementById('info-button');
const infoPopup = document.getElementById('info-popup');

if (infoButton && infoPopup) {
    infoButton.addEventListener('click', (e) => {
        e.stopPropagation();
        infoPopup.classList.toggle('show');
    });

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (!infoButton.contains(e.target) && !infoPopup.contains(e.target)) {
            infoPopup.classList.remove('show');
        }
    });
}

// Location button functionality
const locationButton = document.getElementById('location-button');
let locateControl = null;
let userLocationMarker = null;
let isTracking = false;
let firstLocation = true;

if (locationButton) {
    // Handle location found event
    map.on('locationfound', function(e) {
        // Update or create marker
        if (userLocationMarker) {
            // Update existing marker position smoothly
            userLocationMarker.setLatLng(e.latlng);
        } else {
            // Create a simple blue circle marker
            userLocationMarker = L.circleMarker(e.latlng, {
                radius: 8,
                fillColor: '#2196F3',
                color: 'white',
                weight: 3,
                opacity: 1,
                fillOpacity: 1,
                className: 'user-location-marker'
            }).addTo(map);
        }

        // Center the map on user location only on first location
        if (firstLocation) {
            map.setView(e.latlng, 19, {
                animate: true,
                duration: 1
            });
            firstLocation = false;
        }
    });

    // Handle location error
    map.on('locationerror', function(e) {
        console.error('Location error:', e.message);
        alert('No se pudo obtener tu ubicación. Por favor, verifica los permisos de ubicación de tu navegador.');
        isTracking = false;
        firstLocation = true;
    });

    // Location button click handler
    locationButton.addEventListener('click', function() {
        if (!isTracking) {
            // Reset first location flag to trigger zoom
            firstLocation = true;
            
            // Start tracking user location continuously
            map.locate({
                setView: false,
                maxZoom: 19,
                enableHighAccuracy: true,
                watch: true,  // Enable continuous tracking
                maximumAge: 10000,  // Accept cached position up to 10 seconds old
                timeout: 30000  // 30 second timeout
            });
            isTracking = true;
            locationButton.style.backgroundColor = '#e3f2fd';  // Light blue to indicate active
            console.log('📍 Location tracking started');
        } else {
            // Stop tracking
            map.stopLocate();
            isTracking = false;
            firstLocation = true;
            locationButton.style.backgroundColor = 'white';
            
            // Remove marker
            if (userLocationMarker) {
                map.removeLayer(userLocationMarker);
                userLocationMarker = null;
            }
            console.log('❌ Location tracking stopped');
        }
    });
}

initialize();
