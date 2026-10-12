'use strict';

importScripts('./district-data.js?v=20261012-worker-cache');

const CACHE_PREFIX = 'madtrees-districts-';
const DATABASE_NAME = 'madtrees-processed-districts';
const DATABASE_VERSION = 1;
const STORE_NAME = 'districts';
const PROCESSED_FORMAT_VERSION = 1;

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function readProcessedDistrict(filename, dataVersion) {
    if (!('indexedDB' in self)) return null;
    const database = await openDatabase();

    try {
        return await new Promise((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, 'readonly');
            const request = transaction.objectStore(STORE_NAME).get(filename);
            request.onsuccess = () => {
                const record = request.result;
                resolve(record
                    && record.dataVersion === dataVersion
                    && record.formatVersion === PROCESSED_FORMAT_VERSION
                    ? record.data
                    : null);
            };
            request.onerror = () => reject(request.error);
        });
    } finally {
        database.close();
    }
}

async function saveProcessedDistrict(filename, dataVersion, data) {
    if (!('indexedDB' in self)) return;
    const database = await openDatabase();

    try {
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, 'readwrite');
            transaction.objectStore(STORE_NAME).put({
                dataVersion,
                formatVersion: PROCESSED_FORMAT_VERSION,
                data
            }, filename);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    } finally {
        database.close();
    }
}

async function fetchFeatureCollection(url, filename, dataVersion) {
    let response = null;
    let source = 'network';
    let cache = null;

    if ('caches' in self) {
        cache = await caches.open(`${CACHE_PREFIX}${dataVersion}`);
        response = await cache.match(url);
        if (response) source = 'cache-storage';
    }

    if (!response) {
        response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} al cargar ${filename}`);
        if (cache) await cache.put(url, response.clone());
    }

    return { featureCollection: await response.json(), source };
}

self.onmessage = async event => {
    const { districtInfo, url, dataVersion } = event.data;

    try {
        let data = await readProcessedDistrict(districtInfo.filename, dataVersion);
        let source = 'indexeddb';

        if (!data) {
            const fetched = await fetchFeatureCollection(url, districtInfo.filename, dataVersion);
            data = DistrictData.prepare(fetched.featureCollection, districtInfo);
            source = fetched.source;
            await saveProcessedDistrict(districtInfo.filename, dataVersion, data);
        }

        self.postMessage({ ok: true, data, source }, DistrictData.transferables(data));
    } catch (error) {
        self.postMessage({ ok: false, error: error.message || String(error) });
    }
};
