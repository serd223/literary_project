/**
 * ==========================================
 * APPLICATION STATE
 * ==========================================
 */
let currentChapter = 1;
let selectedBook = null;
let unlockedChapters = {}; 
let myUUID = null;
let receivedSources = {};
let sessionLocation = null;

const DATA_KEY = `proximitetext_data_v2`;
const UUID_KEY = `proximitetext_uuid`;
const SOURCES_KEY = `proximitetext_sources_v2`;

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
            unlockedChapters = JSON.parse(saved);
        } catch (e) {
            unlockedChapters = {};
        }
    } else {
        unlockedChapters = {};
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
            receivedSources = {};
        }
    } else {
        receivedSources = {};
    }
};

const saveState = () => {
    localStorage.setItem(DATA_KEY, JSON.stringify(unlockedChapters));
    localStorage.setItem(SOURCES_KEY, JSON.stringify(receivedSources));
};

const initBookStorage = (bookName) => {
    if (!unlockedChapters[bookName]) unlockedChapters[bookName] = [1];
    if (!unlockedChapters[bookName].includes(1)) unlockedChapters[bookName].push(1);
    
    if (!receivedSources[bookName]) receivedSources[bookName] = [];
    
    saveState();
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
    closeQrBtn: document.getElementById('close-qr-btn'),
    locationOverlay: document.getElementById('location-overlay'),
    grantLocationBtn: document.getElementById('grant-location-btn'),
    dismissLocationBtn: document.getElementById('dismiss-location-btn'),
    locationErrorText: document.getElementById('location-error-text')
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
const selectBook = async (bookConfig) => {
    selectedBook = bookConfig;
    initBookStorage(selectedBook.bookName);
    
    els.bookTitle.innerText = selectedBook.bookDisplayName;
    els.bookSelectorView.classList.add('hidden');
    els.bookSelectorView.classList.remove('flex');
    els.readingView.classList.remove('hidden');
    els.readingView.classList.add('flex');
    
    renderNav();
    await loadChapter(Math.max(...unlockedChapters[selectedBook.bookName]));
};

const renderBookSelector = () => {
    els.bookList.innerHTML = '';
    CONFIG.forEach(bookConfig => {
        const btn = document.createElement('button');
        btn.innerHTML = `${bookConfig.bookDisplayName}, <em class="font-serif ml-4 text-sm text-gray-400 font-normal">${bookConfig.totalChapters} chap.</em>`;
        btn.className = `px-6 py-4 font-bold text-base md:text-lg w-full app-button tracking-wider text-left flex justify-between items-center`;
        btn.onclick = () => selectBook(bookConfig);
        els.bookList.appendChild(btn);
    });
};

const init = async () => {
    // Restore progress
    loadState();

    // Setup events
    els.transmitBtn.addEventListener('click', handleTransmit);
    els.closeQrBtn.addEventListener('click', () => {
        els.qrWrapper.classList.add('hidden');
        els.qrWrapper.classList.remove('flex');
        els.transmitBtn.classList.remove('hidden');
    });
    els.backToBooksBtn.addEventListener('click', () => {
        els.readingView.classList.add('hidden');
        els.readingView.classList.remove('flex');
        els.bookSelectorView.classList.remove('hidden');
        els.bookSelectorView.classList.add('flex');
        selectedBook = null;
    });

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
    const bookNameParam = urlParams.get('book');

    const targetBook = CONFIG.find(c => c.bookName === bookNameParam);

    // If QR code is scanned and points to valid book
    if (lat !== null && lng !== null && !isNaN(unlock) && uuid !== null && targetBook) {
        initBookStorage(targetBook.bookName);
        selectedBook = targetBook;
        
        els.bookTitle.innerText = selectedBook.bookDisplayName;
        els.bookSelectorView.classList.add('hidden');
        els.bookSelectorView.classList.remove('flex');
        els.readingView.classList.remove('hidden');
        els.readingView.classList.add('flex');
        
        await handleReceive(parseFloat(lat), parseFloat(lng), unlock, uuid);
    } else {
        renderBookSelector();
    }
};

/**
 * ==========================================
 * UI RENDERING
 * ==========================================
 */
const renderNav = () => {
    els.chapterNav.innerHTML = '';
    for (let i = 1; i <= selectedBook.totalChapters; i++) {
        const btn = document.createElement('button');
        btn.innerText = `[ CHAPTER ${i} ]`;

        if (unlockedChapters[selectedBook.bookName].includes(i)) {
            btn.className = `px-3 py-2 font-bold app-button text-xs md:text-sm`;
            if (i === currentChapter) {
                btn.classList.add('app-button-active');
            }
            btn.onclick = () => loadChapter(i);
        } else {
            btn.className = `px-3 py-2 app-border text-xs md:text-sm text-gray-500 border-gray-700 bg-transparent cursor-not-allowed uppercase`;
            btn.disabled = true;
        }
        els.chapterNav.appendChild(btn);
    }

    // Share mechanics
    if (currentChapter < selectedBook.totalChapters) {
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
        const filepath = `resources/books/${selectedBook.bookName}/chapter${chapterNum}.txt`;
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

        if (chapterNum < selectedBook.totalChapters) {
            els.actions.classList.remove('hidden');
        }
    } catch (err) {
        showMessage('error', `Data extraction failed. The requested sequence could not be located in the void. \n\n[ ${err.message} ]`);
        els.storyContainer.innerHTML = '<p class="opacity-50 text-center font-mono mt-20">[ STATIC NOISE ]</p>';
        if (chapterNum < selectedBook.totalChapters) {
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
    if (nextChapter > selectedBook.totalChapters) return;

    els.transmitBtn.innerText = "Acquiring Coordinates...";
    els.transmitBtn.disabled = true;

    if (!navigator.geolocation || !sessionLocation) {
        showMessage('error', "Your interface lacks spatial awareness capabilities. Transmission failed.");
        resetTransmitBtn(nextChapter);
        return;
    }

    const lat = sessionLocation.coords.latitude;
    const lng = sessionLocation.coords.longitude;
    generateQR(lat, lng, nextChapter);
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
    url.searchParams.set('book', selectedBook.bookName);

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

    const bookName = selectedBook.bookName;
    const unlocked = unlockedChapters[bookName];
    const sources = receivedSources[bookName];

    // Already unlocked? Just load it and clean URL.
    if (unlocked.includes(targetChapter)) {
        cleanUrlParams();
        renderNav();
        await loadChapter(targetChapter);
        return;
    }

    if (targetUuid === myUUID) {
        showMessage('error', "Signal rejected. You cannot scan your own carrier signal.");
        cleanUrlParams();
        renderNav();
        await loadChapter(Math.max(...unlocked));
        return;
    }

    if (sources.includes(targetUuid)) {
        showMessage('error', "Signal rejected. You have already extracted data from this specific carrier. Seek a new source.");
        cleanUrlParams();
        renderNav();
        await loadChapter(Math.max(...unlocked));
        return;
    }

    // Ask for location to verify proximity
    if (!navigator.geolocation || !sessionLocation) {
        showMessage('error', "Your interface lacks spatial awareness capabilities. Cannot confirm proximity. You must reveal your location.");
        cleanUrlParams();
        renderNav();
        await loadChapter(Math.max(...unlocked));
        return;
    }

    const currentLat = sessionLocation.coords.latitude;
    const currentLng = sessionLocation.coords.longitude;

    const distance = calculateDistance(currentLat, currentLng, targetLat, targetLng);

    if (distance <= 100) {
        unlockedChapters[bookName].push(targetChapter);
        receivedSources[bookName].push(targetUuid);
        saveState();
        showMessage('success', "Proximity confirmed. Decryption sequence initiated. New chapter acquired.");
    } else {
        showMessage('error', `You are too far from the source (${Math.round(distance)}m). The text requires physical proximity (within 100m) to a carrier.`);
    }

    cleanUrlParams();
    renderNav();

    // Load the newly unlocked chapter, or highest fallback
    const chapterToLoad = unlockedChapters[bookName].includes(targetChapter) ? targetChapter : Math.max(...unlockedChapters[bookName]);
    await loadChapter(chapterToLoad);
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
