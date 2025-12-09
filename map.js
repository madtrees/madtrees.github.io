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

function showError(message) {
    loadingOverlay.classList.add('hidden');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `<strong>Error:</strong><br>${message}`;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

function hideLoading() {
    setTimeout(() => {
        loadingOverlay.classList.add('hidden');
    }, 500);
}

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

const districtState = {
    index: null,
    loadedDistricts: new Set(),
    districtLayers: {},
    isLoading: false
};

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

// Helper to yield to browser for better responsiveness
function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

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
                
                const marker = L.circleMarker([lat, lng], {
                    renderer: canvasRenderer,
                    radius: 8,
                    fillColor: '#4CAF50',
                    color: '#2E7D32',
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
                    
                    // Google Street View URL - opens Street View camera directly
                    const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
                    
                    // Google Images search URL for the scientific name
                    const imagesSearchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(species)}`;
                    
                    let popupContent = `<div class="tree-info">`;
                    popupContent += `<span class="tree-species">🌳 ${species}</span>`;
                    if (commonName && commonName !== species) {
                        popupContent += `<span class="tree-common-name">${commonName}</span>`;
                    }
                    popupContent += `<div class="tree-details">`;
                    popupContent += `<div class="tree-details-item"><strong>Diámetro:</strong> ${diameter}</div>`;
                    popupContent += `<div class="tree-details-item"><strong>Altura:</strong> ${height}</div>`;
                    popupContent += `</div>`;
                    if (district || neighborhood) {
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

function getVisibleDistricts() {
    if (!districtState.index) return [];
    
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    
    if (zoom < 11) {
        return districtState.index.districts;
    }
    
    return districtState.index.districts;
}

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
