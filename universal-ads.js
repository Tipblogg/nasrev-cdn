(function () {
    'use strict';
    const SCRIPT_VERSION = '5.0.0-minimal';
    const GPT_LIBRARY_URL = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
    const GA_LIBRARY_URL = 'https://www.googletagmanager.com/gtag/js?id=G-Z0B4ZBF7XH';
    const DEFAULT_REFRESH_INTERVAL = 30000;
    const MIN_VIEWABLE_PERCENTAGE = 50;
    const MAX_REFRESHES_PER_SLOT = 3;

    window.nasrevAds = window.nasrevAds || {
        version: SCRIPT_VERSION,
        initialized: false,
        privacy: {
            hasConsent: false,
            npa: false,
            rdp: false
        },
        slots: {
            inPage: [],
            oop: [],
            topSticky: null
        },
        refreshTimers: new Map(),
        refreshCounts: new Map(),
        scriptStartTime: Date.now()
    };

    function log(message, data) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === '1') {
            console.log(`[Nasrev Ads v${SCRIPT_VERSION}]`, message, data || '');
        }
    }

    function addPreconnectLinks() {
        const links = [
            { rel: 'preconnect', href: 'https://securepubads.g.doubleclick.net', crossorigin: true },
            { rel: 'dns-prefetch', href: 'https://securepubads.g.doubleclick.net' },
            { rel: 'preconnect', href: 'https://pagead2.googlesyndication.com' },
            { rel: 'preconnect', href: 'https://tpc.googlesyndication.com', crossorigin: true },
            { rel: 'preconnect', href: 'https://adservice.google.com' },
            { rel: 'preconnect', href: 'https://www.googletagmanager.com' }
        ];

        links.forEach(function (linkConfig) {
            const link = document.createElement('link');
            link.rel = linkConfig.rel;
            link.href = linkConfig.href;
            if (linkConfig.crossorigin) {
                link.crossOrigin = 'anonymous';
            }
            document.head.appendChild(link);
        });

        log('Preconnect links added for faster ad loading');
    }

    function loadScript(url, onLoad) {
        const script = document.createElement('script');
        script.async = true;
        script.src = url;
        script.crossOrigin = 'anonymous';
        if (onLoad) script.onload = onLoad;
        document.head.appendChild(script);
    }

    // ==================== GOOGLE CONSENT MODE V2 ====================
    function initGoogleConsentMode() {
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        window.gtag = window.gtag || gtag;

        // Set default consent to denied (GAM will handle GDPR popup)
        gtag('consent', 'default', {
            'ad_storage': 'denied',
            'ad_user_data': 'denied',
            'ad_personalization': 'denied',
            'analytics_storage': 'denied',
            'wait_for_update': 500
        });

        log('Google Consent Mode v2 initialized (default: denied)');
    }

    function enableAutoConsent() {
        window.nasrevAds.privacy.hasConsent = true;
        window.nasrevAds.privacy.npa = false; // Personalized ads enabled
        window.nasrevAds.privacy.rdp = false; // Full data processing

        if (window.gtag) {
            window.gtag('consent', 'update', {
                'ad_storage': 'granted',
                'ad_user_data': 'granted',
                'ad_personalization': 'granted',
                'analytics_storage': 'granted'
            });
            log('✅ AUTO-CONSENT: Full consent granted (GDPR handled by GAM)');
        }

        // Track auto-consent event
        if (window.gtag) {
            window.gtag('event', 'auto_consent_enabled', {
                'consent_method': 'automatic',
                'gdpr_handled_by': 'gam'
            });
        }
    }

    // ==================== PPID GENERATION ====================
    function getOrGeneratePPID() {
        try {
            let ppid = localStorage.getItem('nasrev_ppid');

            if (!ppid) {
                const domain = window.location.hostname.replace(/[^a-z0-9]/gi, '_');
                const random = Math.random().toString(36).substr(2, 16);
                ppid = domain + '_' + random;
                localStorage.setItem('nasrev_ppid', ppid);
                log('Generated new PPID', ppid);
            } else {
                log('Using existing PPID', ppid);
            }

            return ppid;

        } catch (e) {
            log('localStorage blocked, using session PPID');
            try {
                let sessionPPID = sessionStorage.getItem('nasrev_ppid_session');
                if (!sessionPPID) {
                    sessionPPID = 'session_' + Math.random().toString(36).substr(2, 16);
                    sessionStorage.setItem('nasrev_ppid_session', sessionPPID);
                }
                return sessionPPID;
            } catch (e2) {
                return 'anon_' + Math.random().toString(36).substr(2, 16);
            }
        }
    }

    // ==================== ANALYTICS ====================
    function initGA() {
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        window.gtag = gtag;

        gtag('js', new Date());
        gtag('config', 'G-Z0B4ZBF7XH', {
            'page_title': document.title,
            'page_location': window.location.href,
            'script_version': SCRIPT_VERSION,
            'send_page_view': true
        });

        // Lazy load GA script on user interaction
        let loaded = false;
        const events = ['scroll', 'mousemove', 'click', 'touchstart'];

        events.forEach(function (event) {
            window.addEventListener(event, function () {
                if (!loaded) {
                    loaded = true;
                    loadScript(GA_LIBRARY_URL);
                    log('Google Analytics loaded');
                }
            }, { once: true, passive: true });
        });

        // Fallback: load after 5 seconds
        setTimeout(function () {
            if (!loaded) {
                loaded = true;
                loadScript(GA_LIBRARY_URL);
            }
        }, 5000);

        log('Google Analytics initialized (lazy load)');
    }

    // ==================== STYLES ====================
    function injectStyles() {
        if (document.getElementById('nasrev-ads-styles')) return;

        const style = document.createElement('style');
        style.id = 'nasrev-ads-styles';
        style.textContent = `
            .ua-ad-wrapper {
                display: flex;
                flex-direction: column;
                align-items: center;
                width: 100%;
                margin: 0 auto;
            }
            .ua-ad-label {
                font-size: 11px;
                color: #666;
                margin-bottom: 8px;
                font-family: Arial, sans-serif;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .ua-ad-container {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 50px;
            }
            .ua-branding {
                font-size: 10px;
                color: #999;
                text-align: center;
                margin-top: 8px;
                font-family: Arial, sans-serif;
            }
            .ua-branding a {
                color: #4CAF50;
                text-decoration: none;
                font-weight: bold;
            }
            .ua-placeholder {
                background: #f5f5f5;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #999;
                font-family: Arial, sans-serif;
                font-size: 14px;
                min-height: 50px;
                width: 100%;
                border: 1px dashed #ddd;
                border-radius: 4px;
            }
        `;
        document.head.appendChild(style);
        log('Styles injected');
    }

    // ==================== TOP STICKY AD CONTAINER ====================
    function createTopStickyAd() {
        const body = document.body;
        const adDiv = document.createElement('div');

        adDiv.innerHTML = '<div id="id-custom_banner" style="width: 100%; position: fixed; left: 0; top: 0; z-index: 999999; opacity: 1; transition: top 1.5s ease-out 0s, opacity .2s ease-out 1s, transform .2s ease-out 0s; background-color: rgba(0, 0, 0, 0.7); backdrop-filter: blur(5px); display: flex; justify-content: center; align-items: center; padding: 5px 0;"><div style="position: absolute; right: 5px; top: 5px; cursor: pointer; z-index: 10;" onclick="removeCustomBanner(this.parentNode.parentNode)"><svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" preserveAspectRatio="xMidYMid meet" viewBox="0 0 16.6 17" style="width: 20px; height: 20px; filter: drop-shadow(1px 1px 2px #333); -webkit-filter: drop-shadow(1px 1px 2px #333)"><polygon fill="#FFF" points="15.5,1.7 13.7,0 7.7,6.1 1.8,0 0,1.7 6,7.9 0,14.1 1.8,15.9 7.7,9.7 13.7,15.9 15.5,14.1 9.5,7.9 "></polygon></svg></div><div id="ua-top-sticky"></div></div>';

        adDiv.style.width = "100%";
        adDiv.style.position = "fixed";
        adDiv.style.left = "0";
        adDiv.style.top = "0";
        adDiv.style.zIndex = "999999";

        body.appendChild(adDiv);

        log('Top sticky ad container created');
    }

    // Close button function (global scope)
    window.removeCustomBanner = function (element) {
        element.remove();
        log('Custom banner removed by user');
    };

    // ==================== SETUP AD SLOTS ====================
    function setupAdSlots() {
        log('Setting up ad slots');

        const adUnits = [
            {
                id: 'ua-placement-1',
                path: '/23272458704/Nasrev.com/Display',
                defaultSizes: [[728, 90], [970, 250], [970, 90], [300, 250], [336, 280]],
                sizeMapping: [
                    { viewport: [1024, 0], sizes: [[728, 90], [970, 250], [970, 90], [300, 250], [336, 280], [300, 600], [160, 600], [120, 600]] },
                    { viewport: [640, 0], sizes: [[728, 90], [300, 250], [336, 280], [300, 600]] },
                    { viewport: [0, 0], sizes: [[320, 50], [320, 100], [300, 250], [336, 280]] }
                ]
            },
            {
                id: 'ua-placement-2',
                path: '/23272458704/Nasrev.com/Display2',
                defaultSizes: [[300, 600], [300, 250], [336, 280]],
                sizeMapping: [
                    { viewport: [1024, 0], sizes: [[300, 600], [160, 600], [120, 600], [300, 250], [336, 280]] },
                    { viewport: [640, 0], sizes: [[300, 600], [300, 250], [336, 280]] },
                    { viewport: [0, 0], sizes: [[300, 250], [336, 280], [320, 100]] }
                ]
            },
            {
                id: 'ua-placement-3',
                path: '/23272458704/Nasrev.com/Display3',
                defaultSizes: [[970, 250], [728, 90], [300, 250]],
                sizeMapping: [
                    { viewport: [1024, 0], sizes: [[970, 250], [970, 90], [728, 90], [300, 250], [336, 280]] },
                    { viewport: [640, 0], sizes: [[728, 90], [468, 60], [300, 250], [336, 280]] },
                    { viewport: [0, 0], sizes: [[320, 50], [320, 100], [300, 250]] }
                ]
            },
            {
                id: 'ua-placement-4',
                path: '/23272458704/Nasrev.com/Display4',
                defaultSizes: [[300, 600], [300, 250], [728, 90]],
                sizeMapping: [
                    { viewport: [1024, 0], sizes: [[300, 600], [300, 250], [336, 280], [160, 600], [120, 600], [728, 90]] },
                    { viewport: [640, 0], sizes: [[300, 600], [300, 250], [336, 280], [728, 90]] },
                    { viewport: [0, 0], sizes: [[300, 250], [320, 100], [320, 50]] }
                ]
            }
        ];

        adUnits.forEach(function (unit) {
            const slotDiv = document.getElementById(unit.id);
            if (!slotDiv) return;

            // Add wrapper and label
            const wrapper = document.createElement('div');
            wrapper.className = 'ua-ad-wrapper';

            const label = document.createElement('div');
            label.className = 'ua-ad-label';
            label.textContent = 'Advertisement';
            wrapper.appendChild(label);

            slotDiv.parentNode.insertBefore(wrapper, slotDiv);
            wrapper.appendChild(slotDiv);

            slotDiv.className = 'ua-ad-container';

            // Add loading placeholder
            const placeholder = document.createElement('div');
            placeholder.className = 'ua-placeholder';
            placeholder.textContent = 'Loading ad...';
            slotDiv.appendChild(placeholder);

            // Add branding
            const branding = document.createElement('div');
            branding.className = 'ua-branding';
            branding.innerHTML = 'ads by <a href="https://nasrev.com" target="_blank" rel="noopener">nasrev.com</a>';
            wrapper.appendChild(branding);

            // Build size mapping
            const mapping = googletag.sizeMapping();
            unit.sizeMapping.forEach(function (map) {
                mapping.addSize(map.viewport, map.sizes);
            });

            // Define slot
            const slot = googletag.defineSlot(unit.path, unit.defaultSizes, unit.id);
            if (slot) {
                slot.defineSizeMapping(mapping.build());
                slot.addService(googletag.pubads());
                slot.customRefresh = true; // Enable refresh
                window.nasrevAds.slots.inPage.push(slot);
                log('Slot defined with refresh enabled', unit.id);
            }
        });

        // ==================== TOP STICKY AD (SLIM BANNERS ONLY) ====================
        createTopStickyAd();

        // ✅ MINIMAL HEIGHT: Only slim banner sizes (max 100px desktop, 75px mobile)
        // Removed: 970x250 (too tall), 750x200 (too tall), 980x120 (too tall)
        const topStickySizes = [
            // Desktop Slim Leaderboards (max height: 100px)
            [970, 90],   // Large leaderboard (premium, slim)
            [970, 66],   // Billboard (ultra-slim, high CPM)
            [728, 90],   // Standard leaderboard (most common)
            [750, 100],  // Extended leaderboard
            [468, 60],   // Full banner (slim)
            [234, 60],   // Half banner (slim)
            
            // Mobile Slim Banners (max height: 75px)
            [320, 50],   // Mobile leaderboard (most common, slim)
            [300, 50],   // Small mobile banner (ultra-slim)
            [320, 100],  // Large mobile banner (fallback only)
            [300, 75]    // Mobile banner
        ];

        const topStickySlot = googletag.defineSlot(
            '/23272458704/Nasrev.com/TopSticky',
            topStickySizes, // Slim horizontal banners only
            'ua-top-sticky'
        );

        if (topStickySlot) {
            const stickyMapping = googletag.sizeMapping()
                // Desktop - Prioritize ultra-slim sizes (max 100px height)
                .addSize([1024, 0], [
                    [970, 90],   // Best desktop size (slim + high CPM)
                    [970, 66],   // Ultra-slim billboard
                    [728, 90],   // Most common
                    [750, 100],  // Extended (max 100px)
                    [468, 60]    // Fallback
                ])
                // Tablet - Slim leaderboards only
                .addSize([640, 0], [
                    [728, 90],   // Most common tablet
                    [468, 60],   // Slim fallback
                    [320, 50],   // Ultra-slim mobile
                    [300, 50]
                ])
                // Mobile - Ultra-slim mobile banners (prefer 50px height)
                .addSize([0, 0], [
                    [320, 50],   // Best mobile size (ultra-slim)
                    [300, 50],   // Alternative ultra-slim
                    [300, 75],   // Fallback
                    [320, 100]   // Last resort (taller)
                ])
                .build();

            topStickySlot.defineSizeMapping(stickyMapping);
            topStickySlot.addService(googletag.pubads());
            topStickySlot.customRefresh = true;
            window.nasrevAds.slots.inPage.push(topStickySlot);
            window.nasrevAds.slots.topSticky = topStickySlot;
            
            log('🚀 Top sticky slot defined with SLIM BANNER sizes', {
                totalSizes: topStickySizes.length,
                desktopSizes: 5,
                tabletSizes: 4,
                mobileSizes: 4,
                maxHeight: '100px (desktop), 50-75px (mobile preferred)',
                refreshEnabled: true
            });
        }

        // ==================== SIDE RAILS ====================
        const leftSideRail = googletag.defineOutOfPageSlot(
            '/23272458704/Nasrev.com/Siderail',
            googletag.enums.OutOfPageFormat.LEFT_SIDE_RAIL
        );
        const rightSideRail = googletag.defineOutOfPageSlot(
            '/23272458704/Nasrev.com/Siderail',
            googletag.enums.OutOfPageFormat.RIGHT_SIDE_RAIL
        );

        if (leftSideRail) {
            leftSideRail.addService(googletag.pubads());
            window.nasrevAds.slots.oop.push(leftSideRail);
            log('Left side rail defined');
        }
        if (rightSideRail) {
            rightSideRail.addService(googletag.pubads());
            window.nasrevAds.slots.oop.push(rightSideRail);
            log('Right side rail defined');
        }

        // ==================== ANCHOR AD ====================
        const anchorSlot = googletag.defineOutOfPageSlot(
            '/23272458704/Nasrev.com/Anchor',
            googletag.enums.OutOfPageFormat.BOTTOM_ANCHOR
        );
        if (anchorSlot) {
            anchorSlot.addService(googletag.pubads());
            window.nasrevAds.slots.oop.push(anchorSlot);
            log('Anchor slot defined');
        }

        // ==================== INTERSTITIAL ====================
        const interstitialSlot = googletag.defineOutOfPageSlot(
            '/23272458704/Nasrev.com/Interstitial',
            googletag.enums.OutOfPageFormat.INTERSTITIAL
        );
        if (interstitialSlot) {
            interstitialSlot.setConfig({
                interstitial: {
                    triggers: {
                        navBar: true,
                        unhideWindow: true
                    }
                }
            });
            interstitialSlot.addService(googletag.pubads());
            window.nasrevAds.slots.oop.push(interstitialSlot);
            log('Interstitial defined with triggers');
        }

        log('✅ All slots configured', {
            inPage: window.nasrevAds.slots.inPage.length,
            oop: window.nasrevAds.slots.oop.length,
            topStickyTotalSizes: topStickySizes.length
        });
    }

    // ==================== CONFIGURE ADS ====================
    function configureAds() {
        const pubads = googletag.pubads();

        // Set PPID (required for Offerwall)
        const ppid = getOrGeneratePPID();
        pubads.setPublisherProvidedId(ppid);
        log('✅ PPID set for Offerwall frequency capping:', ppid);

        // Apply privacy settings
        const privacy = window.nasrevAds.privacy;
        if (privacy.rdp === true) {
            pubads.setPrivacySettings({ restrictedDataProcessing: true });
            log('Privacy: RDP enabled');
        }
        if (privacy.npa === true) {
            pubads.setPrivacySettings({ nonPersonalizedAds: true });
            log('Privacy: NPA enabled');
        }

        // Core configuration
        pubads.enableSingleRequest();
        pubads.collapseEmptyDivs(true);
        pubads.setCentering(true);

        // Enable video ads
        pubads.enableVideoAds();
        log('Video ads enabled');

        // SafeFrame configuration
        pubads.setSafeFrameConfig({
            allowOverlayExpansion: true,
            allowPushExpansion: true,
            sandbox: true
        });
        log('SafeFrame enabled');

        // Lazy loading for better viewability
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        pubads.enableLazyLoad({
            fetchMarginPercent: isMobile ? 300 : 500,
            renderMarginPercent: isMobile ? 100 : 200,
            mobileScaling: 2.0
        });
        log('Lazy loading enabled', { mobile: isMobile });

        // Basic targeting
        pubads.setTargeting('script_version', SCRIPT_VERSION);
        pubads.setTargeting('domain', window.location.hostname);
        pubads.setTargeting('device', isMobile ? 'mobile' : 'desktop');

        // Track render events
        pubads.addEventListener('slotRenderEnded', function (event) {
            const slot = event.slot;
            const slotId = slot.getSlotElementId();
            const div = document.getElementById(slotId);

            // Remove loading placeholder
            if (div) {
                const placeholder = div.querySelector('.ua-placeholder');
                if (placeholder) {
                    placeholder.remove();
                }
            }

            log('Ad rendered', {
                slot: slotId,
                isEmpty: event.isEmpty,
                size: event.size
            });

            // Track first ad performance
            if (!window.nasrevAds.firstAdRendered) {
                window.nasrevAds.firstAdRendered = true;
                const timeToFirstAd = Date.now() - window.nasrevAds.scriptStartTime;
                log('⏱️ Time to first ad:', timeToFirstAd + 'ms');

                if (window.gtag) {
                    window.gtag('event', 'timing_complete', {
                        'name': 'first_ad_render',
                        'value': timeToFirstAd
                    });
                }
            }

            // Start refresh cycle for in-page ads
            if (!event.isEmpty && slot.customRefresh) {
                window.nasrevAds.refreshCounts.set(slotId, 0);
                startRefreshCycle(slot);
            }
        });

        // Track viewability
        pubads.addEventListener('impressionViewable', function (event) {
            log('Impression viewable', event.slot.getSlotElementId());

            if (window.gtag) {
                window.gtag('event', 'ad_viewable', {
                    'slot_id': event.slot.getSlotElementId()
                });
            }
        });

        googletag.enableServices();
        log('✅ GPT services enabled with Offerwall support');
    }

    // ==================== AD REFRESH SYSTEM ====================
    function isSlotInViewport(slotId) {
        const element = document.getElementById(slotId);
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        const windowHeight = window.innerHeight || document.documentElement.clientHeight;
        const windowWidth = window.innerWidth || document.documentElement.clientWidth;

        const verticalVisible = Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0);
        const horizontalVisible = Math.min(rect.right, windowWidth) - Math.max(rect.left, 0);
        const visibleArea = Math.max(0, verticalVisible) * Math.max(0, horizontalVisible);
        const totalArea = rect.height * rect.width;
        const visibilityRatio = totalArea > 0 ? visibleArea / totalArea : 0;

        return visibilityRatio >= (MIN_VIEWABLE_PERCENTAGE / 100);
    }

    function refreshSlot(slot) {
        const slotId = slot.getSlotElementId();
        const currentCount = window.nasrevAds.refreshCounts.get(slotId) || 0;

        if (currentCount >= MAX_REFRESHES_PER_SLOT) {
            log('🛑 Max refresh limit reached', slotId);
            return;
        }

        if (!isSlotInViewport(slotId)) {
            log('⏸️ Slot not viewable, skipping refresh', slotId);
            return;
        }

        try {
            window.nasrevAds.refreshCounts.set(slotId, currentCount + 1);
            googletag.pubads().updateCorrelator();
            googletag.pubads().refresh([slot]);

            log('🔄 Ad refreshed', {
                slot: slotId,
                count: currentCount + 1
            });

            if (window.gtag) {
                window.gtag('event', 'ad_refresh', {
                    'slot_id': slotId,
                    'refresh_count': currentCount + 1
                });
            }
        } catch (error) {
            log('❌ Refresh error', error);
        }
    }

    function startRefreshCycle(slot) {
        const slotId = slot.getSlotElementId();
        const refreshInterval = DEFAULT_REFRESH_INTERVAL;

        if (window.nasrevAds.refreshTimers.has(slotId)) {
            clearTimeout(window.nasrevAds.refreshTimers.get(slotId));
        }

        function scheduleNextRefresh() {
            const currentCount = window.nasrevAds.refreshCounts.get(slotId) || 0;
            if (currentCount >= MAX_REFRESHES_PER_SLOT) {
                log('🛑 Stopping refresh cycle - max reached', slotId);
                return;
            }

            const timer = setTimeout(function () {
                if (isSlotInViewport(slotId)) {
                    refreshSlot(slot);
                    scheduleNextRefresh();
                } else {
                    scheduleNextRefresh();
                }
            }, refreshInterval);

            window.nasrevAds.refreshTimers.set(slotId, timer);
        }

        scheduleNextRefresh();
        log('🔄 Refresh cycle started', { slot: slotId, interval: refreshInterval });
    }

    // Pause refresh when page hidden
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            window.nasrevAds.refreshTimers.forEach(function (timer) {
                clearTimeout(timer);
            });
            log('⏸️ Refresh paused - page hidden');
        } else {
            window.nasrevAds.slots.inPage.forEach(function (slot) {
                if (slot.customRefresh) {
                    const currentCount = window.nasrevAds.refreshCounts.get(slot.getSlotElementId()) || 0;
                    if (currentCount < MAX_REFRESHES_PER_SLOT) {
                        startRefreshCycle(slot);
                    }
                }
            });
            log('▶️ Refresh resumed - page visible');
        }
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', function () {
        window.nasrevAds.refreshTimers.forEach(function (timer) {
            clearTimeout(timer);
        });
    });

    // ==================== DISPLAY ADS ====================
    function displayAds() {
        // Display top sticky first
        if (window.nasrevAds.slots.topSticky) {
            googletag.display('ua-top-sticky');
            log('🚀 Top sticky ad displayed (with expanded sizes)');
        }

        // Display in-page ads
        window.nasrevAds.slots.inPage.forEach(function (slot) {
            const slotId = slot.getSlotElementId();
            if (slotId !== 'ua-top-sticky') {
                googletag.display(slotId);
            }
        });

        // Display out-of-page ads
        window.nasrevAds.slots.oop.forEach(function (slot) {
            googletag.display(slot);
        });

        log('✅ All ads displayed', {
            total: window.nasrevAds.slots.inPage.length + window.nasrevAds.slots.oop.length,
            refreshEnabled: true,
            maxRefreshPerSlot: MAX_REFRESHES_PER_SLOT
        });
    }

    // ==================== INITIALIZATION ====================
    function init() {
        if (window.nasrevAds.initialized) return;
        window.nasrevAds.initialized = true;

        log('🚀 Initializing Nasrev Ads v' + SCRIPT_VERSION);

        // Initialize Google Consent Mode FIRST
        initGoogleConsentMode();

        // Enable auto-consent immediately (GDPR handled by GAM)
        enableAutoConsent();

        addPreconnectLinks();
        injectStyles();
        initGA();

        window.googletag = window.googletag || { cmd: [] };

        loadScript(GPT_LIBRARY_URL, function () {
            log('✅ GPT library loaded');
            googletag.cmd.push(function () {
                setupAdSlots();
                configureAds();
                displayAds();
            });
        });
    }

    // Start initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
