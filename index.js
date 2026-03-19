/**
 * ==========================================
 * APPLICATION STATE
 * ==========================================
 */
let currentChapter = 1;
let unlockedChapters = [1];
let myUUID = null;
let receivedSources = [];

const LOCAL_STORAGE_KEY = `proximitetext_${CONFIG.bookName}`;
const UUID_KEY = `proximitetext_uuid_${CONFIG.bookName}`;
const SOURCES_KEY = `proximitetext_sources_${CONFIG.bookName}`;
console.log(LOCAL_STORAGE_KEY);
console.log(UUID_KEY);
console.log(SOURCES_KEY);

const generateUUID = () => {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
};

const loadState = () => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            unlockedChapters = Array.isArray(parsed) ? parsed : [1];
            if (!unlockedChapters.includes(1)) unlockedChapters.push(1);
        } catch (e) {
            unlockedChapters = [1];
        }
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
        } catch (e) {
            receivedSources = [];
        }
    }
};

const saveState = () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([...new Set(unlockedChapters)]));
    localStorage.setItem(SOURCES_KEY, JSON.stringify([...new Set(receivedSources)]));
};

/**
 * ==========================================
 * DOM ELEMENTS
 * ==========================================
 */
const els = {
    bookTitle: document.getElementById('book-title'),
    chapterNav: document.getElementById('chapter-nav'),
    storyContainer: document.getElementById('story-container'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    success: document.getElementById('success'),
    messages: document.getElementById('messages'),
    actions: document.getElementById('actions'),
    transmitBtn: document.getElementById('transmit-btn'),
    qrWrapper: document.getElementById('qr-wrapper'),
    qrcode: document.getElementById('qrcode'),
    closeQrBtn: document.getElementById('close-qr-btn')
};

/**
 * ==========================================
 * INITIALIZATION
 * ==========================================
 */
const init = async () => {
    // Setup title
    els.bookTitle.innerText = CONFIG.bookName.replace(/_/g, ' ');

    // Restore progress
    loadState();

    // Setup events
    els.transmitBtn.addEventListener('click', handleTransmit);
    els.closeQrBtn.addEventListener('click', () => {
        els.qrWrapper.classList.add('hidden');
        els.qrWrapper.classList.remove('flex');
        els.transmitBtn.classList.remove('hidden');
    });

    // Request geolocation permission upfront so the browser prompts the user
    // before we need it, rather than deep inside the receive flow.
    await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(resolve, resolve, { maximumAge: 60000, timeout: 10000 });
    });

    // Check if page loaded via QR Scan (checking URL params)
    const urlParams = new URLSearchParams(window.location.search);
    const lat = urlParams.get('lat');
    const lng = urlParams.get('lng');
    const unlock = parseInt(urlParams.get('unlock'));
    const uuid = urlParams.get('uuid');

    // Explicit null check is safer for query params
    if (lat !== null && lng !== null && !isNaN(unlock) && uuid !== null) {
        await handleReceive(parseFloat(lat), parseFloat(lng), unlock, uuid);
    } else {
        renderNav();
        await loadChapter(Math.max(...unlockedChapters));
    }
};

/**
 * ==========================================
 * UI RENDERING
 * ==========================================
 */
const renderNav = () => {
    els.chapterNav.innerHTML = '';
    for (let i = 1; i <= CONFIG.totalChapters; i++) {
        const btn = document.createElement('button');
        btn.innerText = `[ CHAPTER ${i} ]`;

        if (unlockedChapters.includes(i)) {
            btn.className = `px-3 py-2 font-bold brutalist-button text-xs md:text-sm`;
            if (i === currentChapter) {
                btn.style.background = 'var(--text-color)';
                btn.style.color = 'var(--bg-color)';
                btn.style.boxShadow = 'none';
                btn.style.transform = 'translate(4px, 4px)';
            }
            btn.onclick = () => loadChapter(i);
        } else {
            btn.className = `px-3 py-2 brutalist-border text-xs md:text-sm text-gray-500 border-gray-700 bg-transparent cursor-not-allowed uppercase`;
            btn.disabled = true;
        }
        els.chapterNav.appendChild(btn);
    }

    // Share mechanics
    if (currentChapter < CONFIG.totalChapters) {
        els.actions.classList.remove('hidden');
        els.transmitBtn.classList.remove('hidden');
        els.qrWrapper.classList.add('hidden');
        els.qrWrapper.classList.remove('flex');
        els.transmitBtn.innerText = `Transmit Chapter ${currentChapter + 1}`;
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
const loadChapter = async (chapterNum) => {
    currentChapter = chapterNum;
    renderNav();
    showMessage('loading');
    els.storyContainer.innerHTML = '';
    els.actions.classList.add('hidden'); // Hide actions while loading

    try {
        // Dynamically fetch text file
        const filepath = `resources/books/${CONFIG.bookName}/chapter${chapterNum}.txt`;
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

        if (chapterNum < CONFIG.totalChapters) {
            els.actions.classList.remove('hidden');
        }
    } catch (err) {
        showMessage('error', `Data extraction failed. The requested sequence could not be located in the void. \n\n[ ${err.message} ]`);
        els.storyContainer.innerHTML = '<p class="opacity-50 text-center font-mono mt-20">[ STATIC NOISE ]</p>';
        if (chapterNum < CONFIG.totalChapters) {
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
    const nextChapter = currentChapter + 1;
    if (nextChapter > CONFIG.totalChapters) return;

    els.transmitBtn.innerText = "Acquiring Coordinates...";
    els.transmitBtn.disabled = true;

    if (!navigator.geolocation) {
        showMessage('error', "Your interface lacks spatial awareness capabilities. Transmission failed.");
        resetTransmitBtn(nextChapter);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            generateQR(lat, lng, nextChapter);
        },
        (err) => {
            showMessage('error', "Interference detected. Unable to lock geographical coordinates.");
            resetTransmitBtn(nextChapter);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
};

const resetTransmitBtn = (nextChapter) => {
    els.transmitBtn.innerText = `Transmit Chapter ${nextChapter}`;
    els.transmitBtn.disabled = false;
};

const generateQR = (lat, lng, chapter) => {
    // Reconstruct absolute URL to prevent trailing slash/hash issues on varied static hosts like GH Pages
    const baseUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    const url = new URL(baseUrl);

    // Build strictly encoded payload
    url.searchParams.set('lat', lat.toString());
    url.searchParams.set('lng', lng.toString());
    url.searchParams.set('unlock', chapter.toString());
    url.searchParams.set('uuid', myUUID);
    console.log(url.toString())
    // Render QR Code
    els.qrcode.innerHTML = '';
    new QRCode(els.qrcode, {
        text: url.toString(),
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    // UI Adjustments
    els.transmitBtn.classList.add('hidden');
    els.qrWrapper.classList.remove('hidden');
    els.qrWrapper.classList.add('flex');
    resetTransmitBtn(chapter);
};

/**
 * ==========================================
 * RECEIVE (SCAN)
 * ==========================================
 */
const handleReceive = async (targetLat, targetLng, targetChapter, targetUuid) => {
    showMessage('loading');

    // Already unlocked? Just load it and clean URL.
    if (unlockedChapters.includes(targetChapter)) {
        cleanUrlParams();
        renderNav();
        await loadChapter(targetChapter);
        return;
    }

    if (targetUuid === myUUID) {
        showMessage('error', "Signal rejected. You cannot scan your own carrier signal.");
        cleanUrlParams();
        renderNav();
        await loadChapter(Math.max(...unlockedChapters));
        return;
    }

    if (receivedSources.includes(targetUuid)) {
        showMessage('error', "Signal rejected. You have already extracted data from this specific carrier. Seek a new source.");
        cleanUrlParams();
        renderNav();
        await loadChapter(Math.max(...unlockedChapters));
        return;
    }

    // Ask for location to verify proximity
    if (!navigator.geolocation) {
        showMessage('error', "Your interface lacks spatial awareness capabilities. Cannot confirm proximity.");
        cleanUrlParams();
        renderNav();
        await loadChapter(Math.max(...unlockedChapters));
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const currentLat = position.coords.latitude;
            const currentLng = position.coords.longitude;

            const distance = calculateDistance(currentLat, currentLng, targetLat, targetLng);

            if (distance <= 50) {
                unlockedChapters.push(targetChapter);
                receivedSources.push(targetUuid);
                saveState();
                showMessage('success', "Proximity confirmed. Decryption sequence initiated. New chapter acquired.");
            } else {
                showMessage('error', `You are too far from the source (${Math.round(distance)}m). The text requires physical proximity (within 50m) to a carrier.`);
            }

            cleanUrlParams();
            renderNav();

            // Load the newly unlocked chapter, or highest fallback
            const chapterToLoad = unlockedChapters.includes(targetChapter) ? targetChapter : Math.max(...unlockedChapters);
            await loadChapter(chapterToLoad);
        },
        async (err) => {
            showMessage('error', "Carrier signal lost. You must reveal your location to receive the transmission.");
            cleanUrlParams();
            renderNav();
            await loadChapter(Math.max(...unlockedChapters));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
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
