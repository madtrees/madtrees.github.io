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
        const response = await fetch('./data/districts/districts_index.json');
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
        const response = await fetch(`./data/districts/${districtInfo.filename}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
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
                
                marker.on('click', function() {
                    const species = props.sn || props.species || props["Nombre científico"] || "Especie desconocida";
                    const commonName = props.cn || props.common_name || props.CODIGO_ESP || "";
                    const diameter = props.d || props.diameter ? `${props.d || props.diameter} cm` : "N/A";
                    const height = props.h || props.height ? `${props.h || props.height} m` : "N/A";
                    const district = props.dt || props.NBRE_DTO || "";
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
                    popupContent += `<a href="${streetViewUrl}" target="_blank" rel="noopener noreferrer" class="street-view-button">🗺️</br> Street View</a>`;
                    popupContent += `<a href="${imagesSearchUrl}" target="_blank" rel="noopener noreferrer" class="images-button">🖼️</br> Imágenes</a>`;
                    popupContent += `</div>`;
                    popupContent += `</div>`;
                    
                    marker.bindPopup(popupContent).openPopup();
                });
                
                districtMarkers.push(marker);
            }
            
            // Yield to browser periodically to keep UI responsive
            if (i > 0 && i % chunkSize === 0) {
                // Add current chunk to map
                const currentChunk = districtMarkers.splice(0);
                markers.addLayers(currentChunk);
                await yieldToMain();
            }
        }
        
        // Add remaining markers
        if (districtMarkers.length > 0) {
            markers.addLayers(districtMarkers);
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
