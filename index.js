/**
 * ==========================================
 * APPLICATION STATE
 * ==========================================
 */
let currentSubtext = 1;
let unlockedSubtexts = [1];
let myUUID = null;
let receivedSources = [];
let sessionLocation = null;

const DATA_KEY = `ake_project_data_meta`;
const UUID_KEY = `ake_project_uuid`;
const SOURCES_KEY = `ake_project_sources_meta`;

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
            if (!Array.isArray(unlockedSubtexts)) unlockedSubtexts = [1];
        } catch (e) {
            unlockedSubtexts = [1];
        }
    } else {
        unlockedSubtexts = [1];
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
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
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
    els.subtextTitle.innerText = CONFIG.subtexts[Math.max(...unlockedSubtexts) - 1].subtextTitle;
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
        applyColors(CONFIG.main_colors.bg_color, CONFIG.main_colors.text_color);
    }

    // Setup events
    els.transmitBtn.addEventListener('click', handleTransmit);
    els.closeQrBtn.addEventListener('click', () => {
        els.qrWrapper.classList.add('hidden');
        els.qrWrapper.classList.remove('flex');
        els.transmitBtn.classList.remove('hidden');
    });

    els.continueBtn.addEventListener('click', showReadingView);

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

    // Check if page loaded via QR Scan (checking URL params)
    const urlParams = new URLSearchParams(window.location.search);
    const lat = urlParams.get('lat');
    const lng = urlParams.get('lng');
    const unlock = parseInt(urlParams.get('unlock'));
    const uuid = urlParams.get('uuid');

    // If QR code is scanned and points to valid target
    if (lat !== null && lng !== null && !isNaN(unlock) && uuid !== null) {
        await showReadingView();
        await handleReceive(parseFloat(lat), parseFloat(lng), unlock, uuid);
    }
};

/**
 * ==========================================
 * UI RENDERING
 * ==========================================
 */
const applyColors = (bgColor, textColor) => {
    if (bgColor) document.documentElement.style.setProperty('--bg-color', bgColor);
    if (textColor) document.documentElement.style.setProperty('--text-color', textColor);
};

const renderNav = () => {
    els.subtextNav.innerHTML = '';
    for (let i = 1; i <= CONFIG.subtexts.length; i++) {
        const btn = document.createElement('button');
        btn.innerText = `[ ${CONFIG.subtexts[i - 1].subtextTitle} ]`;

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
    if (currentSubtext < CONFIG.subtexts.length) {
        els.actions.classList.remove('hidden');
        els.transmitBtn.classList.remove('hidden');
        els.qrWrapper.classList.add('hidden');
        els.qrWrapper.classList.remove('flex');
        els.transmitBtn.innerText = `Transmit ${CONFIG.subtexts[currentSubtext].subtextTitle}`;
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
    els.subtextTitle.innerText = CONFIG.subtexts[subtextNum - 1].subtextTitle;
    
    const subtextConfig = CONFIG.subtexts[subtextNum - 1];
    applyColors(subtextConfig.bg_color, subtextConfig.text_color);

    renderNav();
    showMessage('loading');
    els.storyContainer.innerHTML = '';
    els.actions.classList.add('hidden'); // Hide actions while loading

    try {
        // Dynamically fetch text file
        const filepath = CONFIG.subtexts[subtextNum - 1].filepath;
        const response = await fetch(filepath);

        if (!response.ok) {
            throw new Error(`Signal lost (HTTP ${response.status}). Path: ${filepath}`);
        }

        const text = await response.text();

        // Parse text: Split by newlines, wrap in <p>
        const html = text
            .split(/\r?\n/)
            .filter(p => p.trim() !== '')
            .map(p => `<p>${p.trim()}</p>`)
            .join('');

        els.storyContainer.innerHTML = html;
        showMessage('none');

        if (subtextNum < CONFIG.subtexts.length) {
            els.actions.classList.remove('hidden');
        }
    } catch (err) {
        // showMessage('error', `Data extraction failed. The requested sequence could not be located in the void. \n\n[ ${err.message} ]`);
        // els.storyContainer.innerHTML = '<p class="app-story-error">[ STATIC NOISE ]</p>';
        if (subtextNum < CONFIG.subtexts.length) {
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
    if (nextSubtext > CONFIG.subtexts.length) return;

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
    els.transmitBtn.innerText = `Transmit ${CONFIG.subtexts[nextSubtext - 1].subtextTitle}`;
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

    // Already unlocked? Just load it and clean URL.
    if (unlocked.includes(targetSubtext)) {
        cleanUrlParams();
        renderNav();
        await loadSubtext(targetSubtext);
        return;
    }

    if (targetUuid === myUUID) {
        showMessage('error', "You can not transmit to yourself, you need to receive it from another person.");
        cleanUrlParams();
        renderNav();
        await loadSubtext(Math.max(...unlocked));
        return;
    }

    if (sources.includes(targetUuid)) {
        showMessage('error', "You had already received a chapter from this device, please try a new one.");
        cleanUrlParams();
        renderNav();
        await loadSubtext(Math.max(...unlocked));
        return;
    }

    // Ask for location to verify proximity
    if (!navigator.geolocation || !sessionLocation) {
        showMessage('error', "Receival is not available without location access.");
        cleanUrlParams();
        renderNav();
        await loadSubtext(Math.max(...unlocked));
        return;
    }

    const currentLat = sessionLocation.coords.latitude;
    const currentLng = sessionLocation.coords.longitude;

    const distance = calculateDistance(currentLat, currentLng, targetLat, targetLng);

    if (distance <= 30) {
        unlockedSubtexts.push(targetSubtext);
        // receivedSources[textName].push(targetUuid);
        receivedSources.push(targetUuid);
        saveState();
        // showMessage('success', "Proximity confirmed. Decryption sequence initiated. New subtext acquired.");
    } else {
        showMessage('error', "You are too far away from the transmitter, you need to get closer.");
    }

    cleanUrlParams();
    renderNav();

    // Load the newly unlocked subtext, or highest fallback
    const subtextToLoad = unlockedSubtexts.includes(targetSubtext) ? targetSubtext : Math.max(...unlockedSubtexts);
    await loadSubtext(subtextToLoad);
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
