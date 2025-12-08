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
        
        data.features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
                const [lng, lat] = feature.geometry.coordinates;
                const props = feature.properties || {};
                
                const marker = L.circleMarker([lat, lng], {
                    renderer: canvasRenderer,
                    radius: 4,
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
                    
                    let popupContent = `<div class="tree-info">`;
                    popupContent += `<strong>🌳 ${species}</strong><br>`;
                    if (commonName && commonName !== species) {
                        popupContent += `<em>${commonName}</em><br>`;
                    }
                    popupContent += `<br>`;
                    popupContent += `<strong>Diámetro:</strong> ${diameter}<br>`;
                    popupContent += `<strong>Altura:</strong> ${height}`;
                    if (district) {
                        popupContent += `<br><br><strong>Distrito:</strong> ${district}`;
                    }
                    if (neighborhood) {
                        popupContent += `<br><strong>Barrio:</strong> ${neighborhood}`;
                    }
                    popupContent += `</div>`;
                    
                    marker.bindPopup(popupContent).openPopup();
                });
                
                districtMarkers.push(marker);
            }
        });
        
        districtMarkers.forEach(marker => markers.addLayer(marker));
        
        districtState.districtLayers[districtCode] = districtMarkers;
        districtState.loadedDistricts.add(districtCode);
        
        console.log(`✅ Distrito ${districtCode} cargado: ${districtMarkers.length.toLocaleString()} árboles`);
        
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
    
    const batchSize = 3;
    for (let i = 0; i < visibleDistricts.length; i += batchSize) {
        const batch = visibleDistricts.slice(i, i + batchSize);
        const promises = batch
            .filter(d => !districtState.loadedDistricts.has(d.code))
            .map(d => loadDistrict(d));
        
        if (promises.length > 0) {
            await Promise.all(promises);
            
            const loaded = districtState.loadedDistricts.size;
            const total = districtState.index.districts.length;
            const percentage = Math.round((loaded / total) * 100);
            loadingProgress.textContent = `Distritos cargados: ${loaded} / ${total} (${percentage}%)`;
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
    loadingText.textContent = 'Cargando índice de distritos...';
    loadingProgress.textContent = 'Preparando mapa...';
    
    const success = await loadDistrictIndex();
    if (!success) {
        showError('No se pudo inicializar el mapa');
        return;
    }
    
    map.addLayer(markers);
    
    loadingText.textContent = 'Cargando árboles...';
    await loadVisibleDistricts();
    
    map.on('moveend zoomend', () => {
        loadVisibleDistricts();
    });
    
    hideLoading();
    setupPerformanceMonitoring();
    
    console.log(`✅ Mapa inicializado correctamente`);
    console.log(`📊 ${districtState.loadedDistricts.size} distritos cargados`);
}

initialize();
