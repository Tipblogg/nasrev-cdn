(function () {
    "use strict";

    // ========== FULL-FEATURED CONFIGURATION ==========
    const CONFIG = {
        VAST_TAG: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/23272458704/Nasrev.com/Video&description_url=[placeholder]&tfcd=0&npa=0&sz=400x300%7C640x480&gdfp_req=1&unviewed_position_start=1&output=vast&env=vp&impl=s&plcmt=2&correlator=&vpmute=1&cust_params=[cust_params_placeholder]',
        SELLER_JSON_URL: 'https://nasrev.com/sellers.json',
        MAX_REDIRECTS: 10, VAST_LOAD_TIMEOUT: 8000, VIDEO_LOAD_TIMEOUT: 15000,
        MAX_RETRIES: 3, INITIAL_BACKOFF: 5000, MAX_BACKOFF: 30000,
        MIN_REFRESH_INTERVAL: 30000, MAX_REFRESHES: 50,
        FLOATING_WIDTH: 300, FLOATING_HEIGHT: 169,
        BG_VIDEOS: ['https://github.com/Tipblogg/nasrev-cdn/raw/refs/heads/main/nas.mp4'],
        ENABLE_DEBUG_LOGGING: true,
        VISIBILITY_CHECK_INTERVAL: 1000,
    };

    // ========== UTILITIES ==========
    function domReady(fn) { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn(); }
    function loadScript(src) { return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); }); }
    function log(level, ...args) { if (CONFIG.ENABLE_DEBUG_LOGGING) { console[level]('NasVideo:', ...args); } }

    // ========== DOMAIN AUTHORIZATION & SUPPLY CHAIN MANAGER ==========
    class SchainManager {
        static sellerDataCache = null;
        static async getSchainObject(currentDomain) {
            if (!CONFIG.SELLER_JSON_URL) return null;
            try {
                if (!this.sellerDataCache) {
                    const response = await fetch(CONFIG.SELLER_JSON_URL);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    this.sellerDataCache = await response.json();
                }
                const authorizedSeller = this.sellerDataCache.sellers.find(s => s.domain.toLowerCase() === currentDomain.toLowerCase());
                if (authorizedSeller) {
                    log('info', `✅ Domain '${currentDomain}' is AUTHORIZED.`);
                    return { ver: '1.0', complete: 1, nodes: [{ sid: authorizedSeller.seller_id, name: authorizedSeller.name, domain: authorizedSeller.domain, hp: 1 }] };
                } else {
                    log('error', `🛑 Domain '${currentDomain}' NOT in sellers.json. Ad requests will be blocked.`);
                    return null;
                }
            } catch (e) { log('error', '✗ Could not fetch or parse sellers.json', e); return null; }
        }
    }

    // ========== AUTOMATIC PUBLISHER DATA DETECTOR ==========
    class PublisherDetector {
        static getInfo() { return { domain: window.location.hostname, url: window.location.href, title: document.title || '', keywords: this.getMetaContent('keywords'), category: this.getMetaContent('article:section') || this.getMetaContent('category'), contentId: this.getCanonicalUrl() }; }
        static getMetaContent(name) { const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`); return meta ? meta.content : ''; }
        static getCanonicalUrl() { const link = document.querySelector('link[rel="canonical"]'); return link ? link.href : window.location.href; }
    }

    // ========== VAST URL BUILDER ==========
    class VastUrlBuilder {
        static async build(baseTag, publisher) {
            let url = baseTag.replace('[placeholder]', encodeURIComponent(publisher.url)).replace('correlator=', 'correlator=' + Date.now());
            const consentParams = await this.getConsentParams();
            const schainObject = await SchainManager.getSchainObject(publisher.domain);
            if (!schainObject) return null;
            const allParams = { title: publisher.title, keywords: publisher.keywords, category: publisher.category, content_id: publisher.contentId, domain: publisher.domain, ...consentParams, schain: JSON.stringify(schainObject) };
            const encodedParams = Object.entries(allParams).filter(([_, v]) => v).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
            return url.replace('[cust_params_placeholder]', encodedParams);
        }
        static async getConsentParams() {
            const params = {
                gdpr: 0,
                gdpr_consent: '',
                us_privacy: '',
                ltd: '0'
            };

            try {
                if (typeof window.__tcfapi === 'function') {
                    const tcData = await new Promise(r => window.__tcfapi('getTCData', 2, (d, s) => r(s ? d : null)));
                    if (tcData) {
                        params.gdpr = tcData.gdprApplies ? 1 : 0;
                        params.gdpr_consent = tcData.tcString || '';

                        const hasPersonalizationConsent =
                            tcData.purpose?.consents?.[1] &&
                            tcData.purpose?.consents?.[3] &&
                            tcData.purpose?.consents?.[4];

                        if (params.gdpr === 1 && !hasPersonalizationConsent) {
                            params.npa = 1;
                            params.ltd = '1';
                        }
                    }
                }

                if (typeof window.__gpp === 'function') {
                    params.rdp = '1';
                }

            } catch (e) {
                log('warn', 'Consent API error:', e);
            }

            return params;
        }
    }

    // ========== MAIN VIDEO PLAYER CLASS ==========
    class NasVideoPlayer {
        constructor(container) {
            this.container = container;
            this.publisher = PublisherDetector.getInfo();
            this.isInitialized = false; this.isFloating = false; this.isAdPlaying = false; this.isDestroyed = false;
            this.adsLoader = null; this.adsManager = null; this.adsPaused = false;
            this.retryCount = 0; this.backoffMs = CONFIG.INITIAL_BACKOFF; this.refreshCount = 0;
            this.resizeObserver = null;
            this.isInViewport = false;
            this.resizeTimeout = null;
            this.refreshTimeout = null;
            this.visibilityCheckInterval = null;
            this.init();
        }

        init() {
            log('log', 'Initializing player for', this.publisher.domain);
            this.setupDOM(); this.setupStyles(); this.setupEventListeners();
            this.loadBackgroundVideo(); this.loadIMA();
        }

        setupDOM() {
            this.container.classList.add('nasvideo-player');

            const rect = this.container.getBoundingClientRect();
            if (rect.width > 0) {
                this.container.setAttribute('width', Math.floor(rect.width));
                this.container.setAttribute('height', Math.floor(rect.height));
            }

            this.wrapper = document.createElement('div');
            this.wrapper.className = 'nv-wrapper';
            this.container.parentNode.insertBefore(this.wrapper, this.container);
            this.wrapper.appendChild(this.container);

            this.spacer = document.createElement('div');
            this.spacer.className = 'nv-spacer';
            this.wrapper.appendChild(this.spacer);

            this.video = document.createElement('video');
            this.video.className = 'nv-video';
            this.video.setAttribute('playsinline', '');
            this.video.muted = true;
            this.video.autoplay = true;
            this.video.loop = true;
            this.container.appendChild(this.video);

            this.adContainer = document.createElement('div');
            this.adContainer.className = 'nv-ad-container';
            this.container.appendChild(this.adContainer);

            this.createControls();
            this.createBadge();

            this.closeBtn = document.createElement('button');
            this.closeBtn.className = 'nv-close';
            this.closeBtn.innerHTML = '✕';
            this.closeBtn.addEventListener('click', () => this.destroy());
            this.container.appendChild(this.closeBtn);
        }

        createBadge() {
            this.badge = document.createElement('a');
            this.badge.className = 'nv-badge';
            this.badge.href = 'https://nasrev.com';
            this.badge.target = '_blank';
            this.badge.innerHTML = 'Powered by <strong>Nasrev</strong>';
            this.container.appendChild(this.badge);
        }

        createControls() {
            this.controlsBar = document.createElement('div');
            this.controlsBar.className = 'nv-controls';

            this.playBtn = document.createElement('button');
            this.playBtn.className = 'nv-btn nv-play';
            this.playBtn.innerHTML = '❚❚';
            this.playBtn.addEventListener('click', () => this.togglePlay());

            this.muteBtn = document.createElement('button');
            this.muteBtn.className = 'nv-btn nv-mute';
            this.muteBtn.innerHTML = '🔇';
            this.muteBtn.addEventListener('click', () => this.toggleMute());

            this.fullscreenBtn = document.createElement('button');
            this.fullscreenBtn.className = 'nv-btn nv-fullscreen';
            this.fullscreenBtn.innerHTML = '⛶';
            this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

            this.controlsBar.append(this.playBtn, this.muteBtn, this.fullscreenBtn);
            this.container.appendChild(this.controlsBar);
        }

        setupStyles() {
            if (document.getElementById('nasvideo-styles')) return;
            const styles = document.createElement('style');
            styles.id = 'nasvideo-styles';
            styles.textContent = `
                .nasvideo-player { 
                    position: relative !important; 
                    width: 100% !important; 
                    max-width: 640px; 
                    aspect-ratio: 16/9; 
                    background: #000; 
                    border-radius: 8px; 
                    overflow: hidden !important; 
                    margin: auto; 
                    cursor: pointer; 
                    transition: all 0.3s ease; 
                }
                .nv-wrapper { 
                    position: relative; 
                    width: 100%; 
                } 
                .nv-spacer { 
                    display: none; 
                }
                .nv-video, .nv-ad-container { 
                    position: absolute !important; 
                    top: 0 !important; 
                    left: 0 !important; 
                    width: 100% !important; 
                    height: 100% !important;
                    max-width: none !important;
                    max-height: none !important;
                    object-fit: cover !important;
                }
                .nv-video { 
                    pointer-events: none; 
                    z-index: 1;
                }
                .nv-ad-container { 
                    pointer-events: auto;
                    z-index: 2;
                }
                .nv-ad-container > div {
                    width: 100% !important;
                    height: 100% !important;
                }
                .nv-ad-container video {
                    width: 100% !important;
                    height: 100% !important;
                    object-fit: cover !important;
                }
                .nv-controls { 
                    position: absolute; 
                    bottom: 0; 
                    left: 0; 
                    right: 0; 
                    padding: 10px; 
                    background: linear-gradient(transparent, rgba(0,0,0,0.7)); 
                    display: flex; 
                    gap: 10px; 
                    opacity: 0; 
                    transition: opacity 0.3s; 
                    z-index: 10; 
                    pointer-events: all; 
                }
                .nasvideo-player:hover .nv-controls { 
                    opacity: 1; 
                }
                .nv-controls.hidden { 
                    display: none !important; 
                }
                .nv-btn { 
                    background: transparent; 
                    color: white; 
                    border: none; 
                    font-size: 20px; 
                    cursor: pointer; 
                    transition: transform 0.2s; 
                }
                .nv-btn:hover { 
                    transform: scale(1.1); 
                }
                .nv-badge { 
                    position: absolute; 
                    top: 10px; 
                    left: 10px; 
                    background: rgba(0,0,0,0.6); 
                    color: white; 
                    padding: 4px 8px; 
                    border-radius: 4px; 
                    font-size: 11px; 
                    text-decoration: none; 
                    z-index: 11; 
                    opacity: 0; 
                    transition: opacity 0.3s; 
                    pointer-events: all; 
                }
                .nv-badge strong { 
                    color: #4CAF50; 
                }
                .nasvideo-player:hover .nv-badge { 
                    opacity: 1; 
                }
                .nv-close { 
                    position: absolute; 
                    top: 8px; 
                    right: 8px; 
                    width: 30px; 
                    height: 30px; 
                    border-radius: 50%; 
                    background: rgba(0,0,0,0.8); 
                    color: white; 
                    border: 2px solid white;
                    cursor: pointer; 
                    font-size: 18px; 
                    display: none; 
                    z-index: 12; 
                    pointer-events: all; 
                    transition: all 0.2s;
                    line-height: 26px;
                    padding: 0;
                }
                .nv-close:hover { 
                    background: rgba(255,255,255,0.2);
                    transform: scale(1.1);
                }
                .nasvideo-player.floating { 
                    position: fixed !important; 
                    top: 50% !important; 
                    left: 20px !important; 
                    transform: translateY(-50%) !important;
                    width: ${CONFIG.FLOATING_WIDTH}px !important; 
                    height: ${CONFIG.FLOATING_HEIGHT}px !important; 
                    z-index: 999999 !important; 
                    box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important; 
                    cursor: default !important; 
                    max-width: none !important;
                    border-radius: 12px !important;
                    bottom: auto !important;
                    right: auto !important;
                }
                .nasvideo-player.floating .nv-close { 
                    display: block !important; 
                }
                .nasvideo-player.floating ~ .nv-spacer { 
                    display: block; 
                    height: var(--spacer-height, 0); 
                }
                
                @media (max-width: 768px) {
                    .nasvideo-player.floating {
                        width: 180px !important;
                        height: 101px !important;
                        top: 50% !important;
                        left: 10px !important;
                    }
                }
            `;
            document.head.appendChild(styles);
        }

        setupEventListeners() {
            this.scrollHandler = () => {
                this.checkViewport();
                this.checkFloating();
            };
            window.addEventListener('scroll', this.scrollHandler, { passive: true });

            this.resizeHandler = () => {
                if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
                this.resizeTimeout = setTimeout(() => this.handleResize(), 100);
            };
            window.addEventListener('resize', this.resizeHandler, { passive: true });

            document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());

            setTimeout(() => this.checkViewport(), 100);
        }

        checkViewport() {
            const rect = this.wrapper.getBoundingClientRect();
            const windowHeight = window.innerHeight || document.documentElement.clientHeight;
            const wasInViewport = this.isInViewport;

            this.isInViewport = (
                rect.top <= windowHeight &&
                rect.bottom >= 0
            );

            if (this.isInViewport && !wasInViewport && this.isAdPlaying && this.adsManager && this.adsPaused) {
                try {
                    this.adsManager.resume();
                    log('info', 'Ad resumed - player in viewport');
                } catch (e) {
                    log('warn', 'Error resuming ad:', e);
                }
            }
        }

        isPlayerVisible() {
            const rect = this.wrapper.getBoundingClientRect();
            const windowHeight = window.innerHeight || document.documentElement.clientHeight;
            const windowWidth = window.innerWidth || document.documentElement.clientWidth;
            
            const verticalVisible = rect.top < windowHeight && rect.bottom > 0;
            const horizontalVisible = rect.left < windowWidth && rect.right > 0;
            const hasArea = rect.width > 0 && rect.height > 0;
            
            return verticalVisible && horizontalVisible && hasArea;
        }

        handleResize() {
            if (this.isDestroyed || !this.adsManager) return;

            const viewMode = document.fullscreenElement ? google.ima.ViewMode.FULLSCREEN : google.ima.ViewMode.NORMAL;

            if (this.isFloating) {
                const floatingWidth = window.innerWidth <= 768 ? 180 : CONFIG.FLOATING_WIDTH;
                const floatingHeight = window.innerWidth <= 768 ? 101 : CONFIG.FLOATING_HEIGHT;
                this.adsManager.resize(floatingWidth, floatingHeight, viewMode);
                log('log', `Resized ad for floating mode: ${floatingWidth}x${floatingHeight}`);
            } else {
                const rect = this.container.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    this.adsManager.resize(rect.width, rect.height, viewMode);
                    log('log', `Resized ad for normal mode: ${rect.width}x${rect.height}`);
                }
            }
        }

        handleFullscreenChange() {
            if (document.fullscreenElement) {
                if (this.adsManager) {
                    this.adsManager.resize(window.screen.width, window.screen.height, google.ima.ViewMode.FULLSCREEN);
                }
            } else {
                this.handleResize();
            }
        }

        checkFloating() {
            if (this.isDestroyed || !this.isAdPlaying) return;

            const wrapperRect = this.wrapper.getBoundingClientRect();
            const windowHeight = window.innerHeight || document.documentElement.clientHeight;
            
            const isOutOfView = wrapperRect.bottom < 0 || wrapperRect.top > windowHeight;
            
            if (isOutOfView && !this.isFloating) {
                this.enterFloating();
            } else if (!isOutOfView && this.isFloating) {
                this.exitFloating();
            }
        }

        enterFloating() {
            if (this.isFloating) return;
            this.isFloating = true;

            const currentRect = this.container.getBoundingClientRect();
            this.spacer.style.setProperty('--spacer-height', `${currentRect.height}px`);
            this.container.classList.add('floating');

            log('info', 'Player entered floating mode');

            setTimeout(() => {
                if (this.adsManager && !this.isDestroyed) {
                    const floatingWidth = window.innerWidth <= 768 ? 180 : CONFIG.FLOATING_WIDTH;
                    const floatingHeight = window.innerWidth <= 768 ? 101 : CONFIG.FLOATING_HEIGHT;
                    this.adsManager.resize(floatingWidth, floatingHeight, google.ima.ViewMode.NORMAL);
                    log('log', 'Resized ad for floating mode.');
                }
            }, 350);
        }

        exitFloating() {
            if (!this.isFloating) return;
            this.isFloating = false;
            this.container.classList.remove('floating');
            this.spacer.style.setProperty('--spacer-height', '0');

            log('info', 'Player exited floating mode');

            setTimeout(() => {
                if (this.adsManager && !this.isDestroyed) {
                    const rect = this.container.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        this.adsManager.resize(rect.width, rect.height, google.ima.ViewMode.NORMAL);
                        log('log', `Resized ad for normal mode to ${rect.width}x${rect.height}`);
                    }
                }
            }, 350);
        }

        async loadBackgroundVideo() {
            this.video.src = CONFIG.BG_VIDEOS[0];
            try {
                await this.video.play();
            } catch (e) {
                log('warn', 'Background video autoplay blocked.');
            }
        }

        async loadIMA() {
            try {
                await loadScript('https://imasdk.googleapis.com/js/sdkloader/ima3.js');
                this.setupIMA();
            }
            catch (e) { log('error', 'IMA SDK failed to load', e); }
        }

        setupIMA() {
            this.adDisplayContainer = new google.ima.AdDisplayContainer(this.adContainer, this.video);
            this.adsLoader = new google.ima.AdsLoader(this.adDisplayContainer);
            this.adsLoader.getSettings().setNumRedirects(CONFIG.MAX_REDIRECTS);
            this.adsLoader.getSettings().setDisableCustomPlaybackForIOS10Plus(true);
            this.adsLoader.getSettings().setVpaidMode(google.ima.ImaSdkSettings.VpaidMode.INSECURE);
            this.adsLoader.getSettings().setAutoPlayAdBreaks(true);

            this.adsLoader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, e => this.onAdsManagerLoaded(e), false);
            this.adsLoader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, e => this.onAdError(e), false);

            log('info', 'IMA SDK ready with VPAID INSECURE mode.');
            try {
                this.adDisplayContainer.initialize();
                this.isInitialized = true;
                this.requestAds();
            } catch (e) {
                log('error', 'Failed to initialize ad container:', e);
            }
        }

        async requestAds() {
            if (this.isDestroyed || !this.isInitialized || this.retryCount >= CONFIG.MAX_RETRIES) {
                if (this.retryCount >= CONFIG.MAX_RETRIES) {
                    log('warn', `Max retries (${CONFIG.MAX_RETRIES}) reached. Will schedule refresh.`);
                }
                return;
            }
            const rect = this.container.getBoundingClientRect();
            if (rect.width < 1) { setTimeout(() => this.requestAds(), 500); return; }

            try {
                const vastUrl = await VastUrlBuilder.build(CONFIG.VAST_TAG, this.publisher);
                if (!vastUrl) {
                    log('error', 'Domain not authorized, aborting ad request.');
                    return;
                }
                log('info', '✓ Requesting VAST URL:', vastUrl);
                const adsRequest = new google.ima.AdsRequest();
                adsRequest.adTagUrl = vastUrl;
                adsRequest.linearAdSlotWidth = Math.floor(rect.width);
                adsRequest.linearAdSlotHeight = Math.floor(rect.height);
                adsRequest.nonLinearAdSlotWidth = Math.floor(rect.width);
                adsRequest.nonLinearAdSlotHeight = Math.floor(rect.height);
                adsRequest.vastLoadTimeout = CONFIG.VAST_LOAD_TIMEOUT;
                adsRequest.setAdWillAutoPlay(true);
                adsRequest.setAdWillPlayMuted(true);

                adsRequest.contentTitle = this.publisher.title;
                adsRequest.contentKeywords = this.publisher.keywords?.split(',') || [];

                this.adsLoader.requestAds(adsRequest);
            } catch (e) { this.onAdError({ getError: () => e }); }
        }

        onAdsManagerLoaded(event) {
            log('info', '✓ AdsManager loaded.');
            const settings = new google.ima.AdsRenderingSettings();
            settings.loadVideoTimeout = CONFIG.VIDEO_LOAD_TIMEOUT;
            settings.restoreCustomPlaybackStateOnAdBreakComplete = true;
            settings.enablePreloading = true;
            settings.autoAlign = false;

            this.adsManager = event.getAdsManager(this.video, settings);

            this.adsManager.addEventListener(google.ima.AdEvent.Type.LOADED, () => {
                log('info', '✓ Ad loaded successfully.');
            });

            this.adsManager.addEventListener(google.ima.AdEvent.Type.STARTED, () => {
                this.isAdPlaying = true;
                this.adsPaused = false;
                this.video.pause();
                this.controlsBar.classList.add('hidden');
                log('info', '✓ Ad started playing.');
            });

            this.adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, () => {
                log('info', '✓ Ad completed.');
            });

            this.adsManager.addEventListener(google.ima.AdEvent.Type.PAUSED, () => {
                this.adsPaused = true;
                this.playBtn.innerHTML = '▶';
            });

            this.adsManager.addEventListener(google.ima.AdEvent.Type.RESUMED, () => {
                this.adsPaused = false;
                this.playBtn.innerHTML = '❚❚';
            });

            this.adsManager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, () => this.onAllAdsCompleted());
            this.adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, e => this.onAdError(e));

            try {
                const rect = this.container.getBoundingClientRect();
                this.adsManager.init(rect.width, rect.height, google.ima.ViewMode.NORMAL);
                this.adsManager.start();
                this.retryCount = 0; this.backoffMs = CONFIG.INITIAL_BACKOFF;
                log('info', '✓ AdsManager started.');
            } catch (adError) {
                log('error', 'Failed to start AdsManager:', adError);
                this.onAdError({ getError: () => adError });
            }
        }

        onAllAdsCompleted() {
            log('info', '✓ All ads completed.');
            this.isAdPlaying = false;
            this.adsPaused = false;
            this.controlsBar.classList.remove('hidden');
            this.playBtn.innerHTML = '❚❚';

            if (this.isFloating) {
                this.exitFloating();
            }

            if (this.adsManager) {
                try {
                    this.adsManager.destroy();
                } catch (e) {
                    log('warn', 'Error destroying adsManager:', e);
                }
                this.adsManager = null;
            }

            this.video.play().catch(() => { });
            this.scheduleRefresh();
        }

        onAdError(event) {
            const error = event.getError();
            const code = error ? error.getErrorCode() : 'N/A';
            const message = error ? error.getMessage() : 'Unknown error';
            log('warn', `✗ VAST Error ${code}: ${message}`);

            this.isAdPlaying = false;
            this.controlsBar.classList.remove('hidden');

            if (this.adsManager) {
                try {
                    this.adsManager.destroy();
                } catch (e) { }
                this.adsManager = null;
            }

            this.video.play().catch(() => { });

            this.retryCount++;
            if (this.retryCount <= CONFIG.MAX_RETRIES) {
                log('log', `Retrying ad request (${this.retryCount}/${CONFIG.MAX_RETRIES}) in ${this.backoffMs}ms...`);
                setTimeout(() => this.requestAds(), this.backoffMs);
                this.backoffMs = Math.min(this.backoffMs * 2, CONFIG.MAX_BACKOFF);
            } else {
                log('error', `Max retries (${CONFIG.MAX_RETRIES}) reached. Scheduling refresh.`);
                this.scheduleRefresh();
            }
        }

        scheduleRefresh() {
            if (this.isDestroyed || this.refreshCount >= CONFIG.MAX_REFRESHES) {
                log('warn', 'Max refreshes reached or player destroyed.');
                return;
            }

            if (this.refreshTimeout) {
                clearTimeout(this.refreshTimeout);
                this.refreshTimeout = null;
            }

            if (this.visibilityCheckInterval) {
                clearInterval(this.visibilityCheckInterval);
                this.visibilityCheckInterval = null;
            }

            log('log', `Ad refresh scheduled. Waiting for player visibility check...`);

            this.visibilityCheckInterval = setInterval(() => {
                if (this.isPlayerVisible()) {
                    log('info', `✓ Player is visible. Refreshing ad in ${CONFIG.MIN_REFRESH_INTERVAL / 1000}s...`);
                    
                    if (this.visibilityCheckInterval) {
                        clearInterval(this.visibilityCheckInterval);
                        this.visibilityCheckInterval = null;
                    }

                    this.refreshTimeout = setTimeout(() => {
                        this.refreshCount++;
                        this.retryCount = 0;
                        this.backoffMs = CONFIG.INITIAL_BACKOFF;
                        log('info', `Requesting new ad (refresh ${this.refreshCount}/${CONFIG.MAX_REFRESHES})`);
                        this.requestAds();
                    }, CONFIG.MIN_REFRESH_INTERVAL);
                } else {
                    log('log', 'Player not visible, waiting...');
                }
            }, CONFIG.VISIBILITY_CHECK_INTERVAL);
        }

        togglePlay() {
            if (this.isAdPlaying && this.adsManager) {
                try {
                    if (this.adsPaused) {
                        this.adsManager.resume();
                        this.playBtn.innerHTML = '❚❚';
                    } else {
                        this.adsManager.pause();
                        this.playBtn.innerHTML = '▶';
                    }
                } catch (e) {
                    log('warn', 'Error toggling ad playback:', e);
                }
            } else {
                if (this.video.paused) {
                    this.video.play();
                    this.playBtn.innerHTML = '❚❚';
                } else {
                    this.video.pause();
                    this.playBtn.innerHTML = '▶';
                }
            }
        }

        toggleMute() {
            const isMuted = this.video.muted;
            this.video.muted = !isMuted;
            this.muteBtn.innerHTML = !isMuted ? '🔇' : '🔊';
            if (this.adsManager) {
                try {
                    this.adsManager.setVolume(isMuted ? 1 : 0);
                } catch (e) {
                    log('warn', 'Error setting ad volume:', e);
                }
            }
        }

        toggleFullscreen() {
            if (!document.fullscreenElement) {
                this.container.requestFullscreen().catch(err => log('error', `Fullscreen failed: ${err.message}`));
            } else {
                document.exitFullscreen();
            }
        }

        destroy() {
            if (this.isDestroyed) return;
            this.isDestroyed = true;

            window.removeEventListener('scroll', this.scrollHandler);
            window.removeEventListener('resize', this.resizeHandler);
            document.removeEventListener('fullscreenchange', this.handleFullscreenChange);

            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
                this.resizeObserver = null;
            }

            if (this.resizeTimeout) {
                clearTimeout(this.resizeTimeout);
            }

            if (this.refreshTimeout) {
                clearTimeout(this.refreshTimeout);
            }

            if (this.visibilityCheckInterval) {
                clearInterval(this.visibilityCheckInterval);
            }

            if (this.adsManager) {
                try {
                    this.adsManager.destroy();
                } catch (e) { }
            }

            if (this.adsLoader) {
                try {
                    this.adsLoader.destroy();
                } catch (e) { }
            }

            this.wrapper.remove();
            log('log', 'Player destroyed.');
        }
    }

    // ========== AUTO-DISCOVERY & INITIALIZATION ==========
    class NasVideoAutoLoader {
        static init() {
            if (window.__nasVideoInitialized) return;
            window.__nasVideoInitialized = true;
            document.querySelectorAll('.nasvideo').forEach(container => {
                if (!container.dataset.nasvideoInitialized) {
                    container.dataset.nasvideoInitialized = 'true';
                    new NasVideoPlayer(container);
                }
            });
        }
    }

    domReady(() => NasVideoAutoLoader.init());

})();
