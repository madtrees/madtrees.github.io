(function(globalScope) {
    'use strict';

    const MISSING_STRING_ID = 65535;

    function calculateRadius(diameter, height) {
        let size = 0;
        let hasData = false;

        if (diameter > 0) {
            size += diameter * 0.4;
            hasData = true;
        }
        if (height > 0) {
            size += height * 6;
            hasData = true;
        }
        if (!hasData || size <= 0) return 4;

        let radius;
        if (size < 20) radius = 4 + size * 0.1;
        else if (size < 50) radius = 6 + (size - 20) * 0.133333;
        else if (size < 100) radius = 10 + (size - 50) * 0.12;
        else radius = size - 100 > 200 ? 26 : 16 + Math.sqrt((size - 100) * 0.005) * 10;

        return height >= 20 ? Math.min(radius + 2, 28) : radius;
    }

    function createDictionary() {
        return { values: [], ids: new Map() };
    }

    function dictionaryId(dictionary, value) {
        const text = String(value || '').trim();
        if (!text) return MISSING_STRING_ID;

        let id = dictionary.ids.get(text);
        if (id !== undefined) return id;
        if (dictionary.values.length >= MISSING_STRING_ID) {
            throw new Error('Demasiados valores únicos para el formato de distritos');
        }

        id = dictionary.values.length;
        dictionary.ids.set(text, id);
        dictionary.values.push(text);
        return id;
    }

    function compactArray(array, count) {
        return count === array.length ? array : array.slice(0, count);
    }

    function prepare(featureCollection, districtInfo) {
        const features = featureCollection.features || [];
        const capacity = features.length;
        const coordinates = new Float64Array(capacity * 2);
        const radii = new Float32Array(capacity);
        const styleIds = new Uint8Array(capacity);
        const diameters = new Float32Array(capacity);
        const heights = new Float32Array(capacity);
        const scientificNameIds = new Uint16Array(capacity);
        const commonNameIds = new Uint16Array(capacity);
        const neighborhoodIds = new Uint16Array(capacity);
        const scientificNames = createDictionary();
        const commonNames = createDictionary();
        const neighborhoods = createDictionary();
        let count = 0;

        scientificNameIds.fill(MISSING_STRING_ID);
        commonNameIds.fill(MISSING_STRING_ID);
        neighborhoodIds.fill(MISSING_STRING_ID);
        diameters.fill(Number.NaN);
        heights.fill(Number.NaN);

        for (const feature of features) {
            const rawCoordinates = feature.geometry && feature.geometry.coordinates;
            if (!rawCoordinates || rawCoordinates.length < 2) continue;

            const longitude = Number(rawCoordinates[0]);
            const latitude = Number(rawCoordinates[1]);
            if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;

            const props = feature.properties || {};
            const diameter = Number(props.d || props.diameter);
            const height = Number(props.h || props.height);
            const validDiameter = Number.isFinite(diameter) && diameter > 0 ? diameter : Number.NaN;
            const validHeight = Number.isFinite(height) && height > 0 ? height : Number.NaN;

            coordinates[count * 2] = latitude;
            coordinates[count * 2 + 1] = longitude;
            diameters[count] = validDiameter;
            heights[count] = validHeight;
            radii[count] = districtInfo.code === '22'
                ? 8
                : calculateRadius(validDiameter, validHeight);
            styleIds[count] = districtInfo.code === '22'
                ? 3
                : validHeight >= 19 ? 2 : validHeight >= 16 ? 1 : 0;
            scientificNameIds[count] = dictionaryId(
                scientificNames,
                props.sn || props.species || props['Nombre científico']
            );
            commonNameIds[count] = dictionaryId(
                commonNames,
                props.cn || props.common_name || props.CODIGO_ESP
            );
            neighborhoodIds[count] = dictionaryId(
                neighborhoods,
                props.nb || props.NBRE_BARRI
            );
            count++;
        }

        return {
            code: districtInfo.code,
            districtName: (featureCollection.properties && featureCollection.properties.district_name)
                || districtInfo.name
                || '',
            count,
            coordinates: compactArray(coordinates, count * 2),
            radii: compactArray(radii, count),
            styleIds: compactArray(styleIds, count),
            diameters: compactArray(diameters, count),
            heights: compactArray(heights, count),
            scientificNameIds: compactArray(scientificNameIds, count),
            commonNameIds: compactArray(commonNameIds, count),
            neighborhoodIds: compactArray(neighborhoodIds, count),
            scientificNames: scientificNames.values,
            commonNames: commonNames.values,
            neighborhoods: neighborhoods.values
        };
    }

    function transferables(data) {
        return [
            data.coordinates.buffer,
            data.radii.buffer,
            data.styleIds.buffer,
            data.diameters.buffer,
            data.heights.buffer,
            data.scientificNameIds.buffer,
            data.commonNameIds.buffer,
            data.neighborhoodIds.buffer
        ];
    }

    globalScope.DistrictData = { MISSING_STRING_ID, prepare, transferables };
})(typeof self !== 'undefined' ? self : window);
