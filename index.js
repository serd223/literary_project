/**
 * ==========================================
 * APPLICATION STATE
 * ==========================================
 */

// index in CONFIG.subtexts array
let currentSubtext = 0;
let unlockedSubtexts = [0];
let myUUID = null;
let receivedSources = [];
let sessionLocation = null;

const DATA_KEY = `ake_project_storage_data`;
const UUID_KEY = `ake_project_uuid`;
const SOURCES_KEY = `ake_project_storage_sources_data`;

const generateUUID = () => {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
};

const loadState = () => {
    const saved = localStorage.getItem(DATA_KEY);
    if (saved) {
        try {
            unlockedSubtexts = JSON.parse(saved);
            if (!Array.isArray(unlockedSubtexts)) unlockedSubtexts = [0];
        } catch (e) {
            unlockedSubtexts = [0];
        }
    } else {
        unlockedSubtexts = [0];
    }

    myUUID = localStorage.getItem(UUID_KEY);
    if (!myUUID) {
        myUUID = generateUUID();
        localStorage.setItem(UUID_KEY, myUUID);
    }

    const savedSources = localStorage.getItem(SOURCES_KEY);
    if (savedSources) {
        try {
            receivedSources = JSON.parse(savedSources);
            // Fallback for transition
            if (!Array.isArray(receivedSources)) receivedSources = [];
        } catch (e) {
            // receivedSources = {};
            receivedSources = [];
        }
    } else {
        // receivedSources = {};
        receivedSources = [];
    }
};

const saveState = () => {
    localStorage.setItem(DATA_KEY, JSON.stringify(unlockedSubtexts));
    localStorage.setItem(SOURCES_KEY, JSON.stringify(receivedSources));
};

/**
 * ==========================================
 * DOM ELEMENTS
 * ==========================================
 */
const els = {
    textTitle: document.getElementById('text-title'),
    subtextNav: document.getElementById('subtext-nav'),
    storyContainer: document.getElementById('story-container'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    success: document.getElementById('success'),
    messages: document.getElementById('messages'),
    actions: document.getElementById('actions'),
    transmitBtn: document.getElementById('transmit-btn'),
    qrWrapper: document.getElementById('qr-wrapper'),
    qrcode: document.getElementById('qrcode'),
    closeQrBtn: document.getElementById('close-qr-btn'),
    locationOverlay: document.getElementById('location-overlay'),
    grantLocationBtn: document.getElementById('grant-location-btn'),
    dismissLocationBtn: document.getElementById('dismiss-location-btn'),
    locationErrorText: document.getElementById('location-error-text'),
    welcomeView: document.getElementById('welcome-view'),
    continueBtn: document.getElementById('continue-btn'),
    readingView: document.getElementById('reading-view'),
    subtextTitle: document.getElementById('subtext-title')
};

/**
 * ==========================================
 * INITIALIZATION
 * ==========================================
 */
const requestLocationWithOverlay = async () => {
    return new Promise((resolve) => {
        els.locationOverlay.classList.remove('hidden');
        els.locationOverlay.classList.add('flex');

        function cleanup() {
            els.grantLocationBtn.removeEventListener('click', onGrantLocation);
            els.dismissLocationBtn.removeEventListener('click', onDismiss);
        }

        function onGrantLocation() {
            els.grantLocationBtn.innerText = "Acquiring...";
            els.grantLocationBtn.disabled = true;
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    sessionLocation = position;
                    els.locationOverlay.classList.add('hidden');
                    els.locationOverlay.classList.remove('flex');
                    cleanup();
                    resolve();
                },
                (err) => {
                    els.locationErrorText.innerText = "Error: " + err.message + " - Check your browser site settings.";
                    els.locationErrorText.classList.remove('hidden');
                    els.grantLocationBtn.innerText = "Grant Location";
                    els.grantLocationBtn.disabled = false;
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        }

        function onDismiss() {
            els.locationOverlay.classList.add('hidden');
            els.locationOverlay.classList.remove('flex');
            cleanup();
            resolve();
        }

        els.grantLocationBtn.addEventListener('click', onGrantLocation);
        els.dismissLocationBtn.addEventListener('click', onDismiss);
    });
};
const showReadingView = async () => {
    els.subtextTitle.innerText = CONFIG.subtexts[Math.max(...unlockedSubtexts)].subtextTitle;
    els.welcomeView.classList.add('hidden');
    els.welcomeView.classList.remove('flex');
    els.readingView.classList.remove('hidden');
    els.readingView.classList.add('flex');

    renderNav();
    await loadSubtext(Math.max(...unlockedSubtexts));
};

const init = async () => {
    // Restore progress
    loadState();

    document.getElementById('project-title-intro').innerText = CONFIG.projectTitle;

    if (CONFIG.main_colors) {
        applyTheme(CONFIG.main_colors);
    }

    // Setup events
    els.transmitBtn.addEventListener('click', handleTransmit);
    els.closeQrBtn.addEventListener('click', () => {
        els.qrWrapper.classList.add('hidden');
        els.qrWrapper.classList.remove('flex');
        els.transmitBtn.classList.remove('hidden');
    });

    els.continueBtn.addEventListener('click', showReadingView);

    const urlParams = new URLSearchParams(window.location.search);
    const lat = urlParams.get('lat');
    const lng = urlParams.get('lng');
    const unlock = parseInt(urlParams.get('unlock'));
    const uuid = urlParams.get('uuid');
    // TODO: remove
    const debugUnlockAll = urlParams.get('debugunlockall');
    const debugClearState = urlParams.get('debugclearstate');

    handleDebugParams(debugUnlockAll, debugClearState);

    const isReceiving = lat !== null && lng !== null && !isNaN(unlock) && uuid !== null;

    if (isReceiving) {
        els.welcomeView.classList.add('hidden');
        els.welcomeView.classList.remove('flex');
        els.readingView.classList.remove('hidden');
        els.readingView.classList.add('flex');
        els.storyContainer.innerHTML = '';
        els.subtextNav.innerHTML = '';
        els.subtextTitle.innerText = 'Loading chapter...';
        els.loading.innerText = 'Acquiring geolocation information...';
        showMessage('loading');
    }

    // Request geolocation permission upfront so the browser prompts the user
    // before we need it, rather than deep inside the receive flow.
    await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                sessionLocation = position;
                resolve();
            },
            async (err) => {
                console.warn("Geolocation failed on init", err);
                await requestLocationWithOverlay();
                resolve();
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
        );
    });

    // If QR code is scanned and points to valid target
    if (isReceiving) {
        await handleReceive(parseFloat(lat), parseFloat(lng), unlock, uuid);
    }

};

// TODO: remove
const handleDebugParams = (unlockAll, clearState) => {
    cleanUrlParams();
    if (unlockAll !== null) {
        unlockedSubtexts = [0, 1, 2, 3, 4, 5];
        saveState();
    }

    if (clearState !== null) {
        unlockedSubtexts = [0];
        receivedSources = [];
        saveState();
    }
}

/**
 * ==========================================
 * UI RENDERING
 * ==========================================
 */
const applyTheme = (config) => {
    if (config.bg_color) document.documentElement.style.setProperty('--bg-color', config.bg_color);
    if (config.text_color) {
        document.documentElement.style.setProperty('--text-color', config.text_color);

        let brightness = 0;
        let hex = config.text_color.replace('#', '');
        if (hex.length === 8) hex = hex.substring(0, 6);
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        if (hex.length === 6) {
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            brightness = (r * 299 + g * 587 + b * 114) / 1000;
        }

        if (brightness > 128) {
            document.documentElement.style.setProperty('--knockout-blend', 'screen');
            document.documentElement.style.setProperty('--knockout-color', '#000000');
        } else {
            document.documentElement.style.setProperty('--knockout-blend', 'multiply');
            document.documentElement.style.setProperty('--knockout-color', '#ffffff');
        }
    }

    if (config.bg_image_url) {
        document.documentElement.style.setProperty('--bg-image', `url('${config.bg_image_url}')`);
        document.documentElement.style.setProperty('--bg-blur', config.bg_image_blur || '5px');
    } else {
        document.documentElement.style.setProperty('--bg-image', 'none');
        document.documentElement.style.setProperty('--bg-blur', '0px');
    }
};

const renderNav = () => {
    els.subtextNav.innerHTML = '';
    for (let i = 0; i < CONFIG.subtexts.length; i++) {
        const btn = document.createElement('button');
        btn.innerText = `[ ${CONFIG.subtexts[i].subtextTitle} ]`;

        if (unlockedSubtexts.includes(i)) {
            btn.className = `app-button app-nav-btn`;
            if (i === currentSubtext) {
                btn.classList.add('app-button-active');
            }
            btn.onclick = () => loadSubtext(i);
        } else {
            btn.className = `app-border app-nav-btn app-nav-btn-locked`;
            btn.disabled = true;
        }
        els.subtextNav.appendChild(btn);
    }

    // Share mechanics
    let nextSubtext = currentSubtext + 1;
    if (nextSubtext < CONFIG.subtexts.length) {
        els.actions.classList.remove('hidden');
        els.transmitBtn.classList.remove('hidden');
        els.qrWrapper.classList.add('hidden');
        els.qrWrapper.classList.remove('flex');
        els.transmitBtn.innerText = `Transmit ${CONFIG.subtexts[nextSubtext].subtextTitle}`;
    } else {
        els.actions.classList.add('hidden');
    }
};

const showMessage = (type, text = '') => {
    els.messages.classList.remove('hidden');
    els.loading.classList.add('hidden');
    els.error.classList.add('hidden');
    els.success.classList.add('hidden');

    if (type === 'loading') {
        els.loading.classList.remove('hidden');
    } else if (type === 'error') {
        els.error.innerText = text;
        els.error.classList.remove('hidden');
    } else if (type === 'success') {
        els.success.innerText = text;
        els.success.classList.remove('hidden');
        // Auto hide success
        setTimeout(() => {
            els.success.classList.add('hidden');
            if (els.loading.classList.contains('hidden') && els.error.classList.contains('hidden')) {
                els.messages.classList.add('hidden');
            }
        }, 6000);
    } else {
        els.messages.classList.add('hidden');
    }
};

/**
 * ==========================================
 * CONTENT FETCHING
 * ==========================================
 */
const loadSubtext = async (subtextNum) => {
    currentSubtext = subtextNum;
    els.subtextTitle.innerText = CONFIG.subtexts[subtextNum].subtextTitle;

    const subtextConfig = CONFIG.subtexts[subtextNum];
    applyTheme(subtextConfig);

    renderNav();
    showMessage('loading');
    els.storyContainer.innerHTML = '';
    els.actions.classList.add('hidden'); // Hide actions while loading

    try {
        const text = CONFIG.subtexts[subtextNum].textContent;

        // Parse text: Split by newlines, wrap in <p>
        const html = text
            .split(/\r?\n/)
            .filter(p => p.trim() !== '')
            .map(p => `<p>${p.trim()}</p>`)
            .join('');

        // HTML injection for author credits
        const authorHtml = `<p><i>${subtextConfig.authorName}, ${subtextConfig.authorAge} - ${subtextConfig.authorTag}</i></p>`;
        els.storyContainer.innerHTML = html + authorHtml;
        showMessage('none');

        if (subtextNum + 1 < CONFIG.subtexts.length) {
            els.actions.classList.remove('hidden');
        }
    } catch (err) {
        // showMessage('error', `Data extraction failed. The requested sequence could not be located in the void. \n\n[ ${err.message} ]`);
        // els.storyContainer.innerHTML = '<p class="app-story-error">[ STATIC NOISE ]</p>';
        if (subtextNum + 1 < CONFIG.subtexts.length) {
            els.actions.classList.remove('hidden');
        }
    }
};

/**
 * ==========================================
 * TRANSMIT (SHARE)
 * ==========================================
 */
const handleTransmit = () => {
    const nextSubtext = currentSubtext + 1;
    if (nextSubtext >= CONFIG.subtexts.length) return;

    els.transmitBtn.innerText = "Acquiring Coordinates...";
    els.transmitBtn.disabled = true;

    if (!navigator.geolocation || !sessionLocation) {
        showMessage('error', "Transmission is not available without location access.");
        resetTransmitBtn(nextSubtext);
        return;
    }

    const lat = sessionLocation.coords.latitude;
    const lng = sessionLocation.coords.longitude;
    generateQR(lat, lng, nextSubtext);
};

const resetTransmitBtn = (nextSubtext) => {
    els.transmitBtn.innerText = `Transmit ${CONFIG.subtexts[nextSubtext].subtextTitle}`;
    els.transmitBtn.disabled = false;
};

const generateQR = (lat, lng, subtext) => {
    // Reconstruct absolute URL to prevent trailing slash/hash issues on varied static hosts like GH Pages
    const baseUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    const url = new URL(baseUrl);

    // Build strictly encoded payload
    url.searchParams.set('lat', lat.toString());
    url.searchParams.set('lng', lng.toString());
    url.searchParams.set('unlock', subtext.toString());
    url.searchParams.set('uuid', myUUID);

    // Render QR Code 
    els.qrcode.innerHTML = '';

    const rootStyle = getComputedStyle(document.documentElement);
    const qRThemeBg = rootStyle.getPropertyValue('--bg-color').trim() || "#ffffff";
    const qRThemeText = rootStyle.getPropertyValue('--text-color').trim() || "#000000";

    new QRCode(els.qrcode, {
        text: url.toString(),
        width: 256,
        height: 256,
        colorDark: qRThemeText,
        colorLight: qRThemeBg,
        correctLevel: QRCode.CorrectLevel.H
    });

    // UI Adjustments
    els.transmitBtn.classList.add('hidden');
    els.qrWrapper.classList.remove('hidden');
    els.qrWrapper.classList.add('flex');
    resetTransmitBtn(subtext);
};

/**
 * ==========================================
 * RECEIVE (SCAN)
 * ==========================================
 */
const handleReceive = async (targetLat, targetLng, targetSubtext, targetUuid) => {
    showMessage('loading');

    const unlocked = unlockedSubtexts;
    // const sources = receivedSources[textName];
    const sources = receivedSources;

    if (isNaN(targetSubtext) || !targetUuid) {
        cleanUrlParams();
        renderNav();
        await loadSubtext(Math.max(...unlockedSubtexts));
        showMessage('error', "Invalid transmission data. The signal was corrupted.");
        return;
    }

    // Already unlocked? Just load it and clean URL.
    if (unlocked.includes(targetSubtext)) {
        cleanUrlParams();
        renderNav();
        await loadSubtext(targetSubtext);
        return;
    }

    if (targetUuid === myUUID) {
        cleanUrlParams();
        renderNav();
        await loadSubtext(Math.max(...unlockedSubtexts));
        showMessage('error', "You can not transmit to yourself, you need to receive it from another person.");
        return;
    }

    if (sources.includes(targetUuid)) {
        cleanUrlParams();
        renderNav();
        await loadSubtext(Math.max(...unlockedSubtexts));
        showMessage('error', "You had already received a chapter from this device, please try a new one.");
        return;
    }

    // Ask for location to verify proximity
    if (!navigator.geolocation || !sessionLocation) {
        cleanUrlParams();
        renderNav();
        await loadSubtext(Math.max(...unlockedSubtexts));
        showMessage('error', "Receival is not available without location access.");
        return;
    }

    const currentLat = sessionLocation.coords.latitude;
    const currentLng = sessionLocation.coords.longitude;

    const distance = calculateDistance(currentLat, currentLng, targetLat, targetLng);

    let finalErrorMsg = null;
    let finalSuccessMsg = null;
    const maxDistanceThreshold = 50;

    // TODO: fix??
    // if (distance <= maxDistanceThreshold) {
    if (true) {
        unlockedSubtexts.push(targetSubtext);
        // receivedSources[textName].push(targetUuid);
        receivedSources.push(targetUuid);
        saveState();
        finalSuccessMsg = `${CONFIG.subtexts[targetSubtext].subtextTitle} has been unlocked.`;
    } else {
        finalErrorMsg = "You are too far away from the transmitter, you need to get closer.";
    }

    cleanUrlParams();
    renderNav();

    // Load the newly unlocked subtext, or highest fallback
    const subtextToLoad = unlockedSubtexts.includes(targetSubtext) ? targetSubtext : Math.max(...unlockedSubtexts);
    await loadSubtext(subtextToLoad);

    if (finalErrorMsg) showMessage('error', finalErrorMsg);
    if (finalSuccessMsg) showMessage('success', finalSuccessMsg);
};

/**
 * Strip sharing parameters from URL without reloading.
 */
const cleanUrlParams = () => {
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + window.location.hash;
    window.history.replaceState({ path: newUrl }, '', newUrl);
};

/**
 * ==========================================
 * MATH HELPERS
 * ==========================================
 * Haversine formula calculation.
 * Returns distance in meters.
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
};

// Bootstrap
window.addEventListener('DOMContentLoaded', init);
