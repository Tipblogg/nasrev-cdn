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
            { rel: 'preconnect', href: 'https://tpc.googlesyndication.com', crossorigin: true }
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

    // Minimal Analytics
    function initGA() {
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        window.gtag = gtag;

        gtag('js', new Date());
        gtag('config', 'G-Z0B4ZBF7XH', {
            'page_title': document.title,
            'page_location': window.location.href,
            'script_version': SCRIPT_VERSION
        });

        loadScript(GA_LIBRARY_URL);
        log('Analytics loaded');
    }

    // Minimal Styles
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
        `;
        document.head.appendChild(style);
    }

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

            // Add branding
            const branding = document.createElement('div');
            branding.className = 'ua-branding';
            branding.innerHTML = 'ads by <a href="https://nasrev.com" target="_blank" rel="noopener">nasrev.com</a>';
            wrapper.appendChild(branding);

            // Build size mapping properly
            const mapping = googletag.sizeMapping();
            unit.sizeMapping.forEach(function (map) {
                mapping.addSize(map.viewport, map.sizes);
            });

            // Define slot with default sizes
            const slot = googletag.defineSlot(unit.path, unit.defaultSizes, unit.id);
            if (slot) {
                slot.defineSizeMapping(mapping.build());
                slot.addService(googletag.pubads());
                slot.customRefresh = true; // Enable refresh for in-page ads
                window.nasrevAds.slots.inPage.push(slot);
            }
        });

        // ==================== TOP STICKY AD ====================
        createTopStickyAd(); // Create the sticky container first

        const topStickySlot = googletag.defineSlot(
            '/23272458704/Nasrev.com/TopSticky',
            [[970, 90], [728, 90], [320, 50], [320, 100]],
            'ua-top-sticky'
        );

        if (topStickySlot) {
            const stickyMapping = googletag.sizeMapping()
                .addSize([1024, 0], [[970, 90], [728, 90]])
                .addSize([640, 0], [[728, 90]])
                .addSize([0, 0], [[320, 100], [320, 50]])
                .build();

            topStickySlot.defineSizeMapping(stickyMapping);
            topStickySlot.addService(googletag.pubads());
            topStickySlot.customRefresh = true;
            window.nasrevAds.slots.inPage.push(topStickySlot);
            window.nasrevAds.slots.topSticky = topStickySlot;
            log('Top sticky slot defined with refresh enabled');
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
        }
        if (rightSideRail) {
            rightSideRail.addService(googletag.pubads());
            window.nasrevAds.slots.oop.push(rightSideRail);
        }

        // Anchor
        const anchorSlot = googletag.defineOutOfPageSlot(
            '/23272458704/Nasrev.com/Anchor',
            googletag.enums.OutOfPageFormat.BOTTOM_ANCHOR
        );
        if (anchorSlot) {
            anchorSlot.addService(googletag.pubads());
            window.nasrevAds.slots.oop.push(anchorSlot);
        }

        // Interstitial
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
        }

        log('Slots configured', {
            inPage: window.nasrevAds.slots.inPage.length,
            oop: window.nasrevAds.slots.oop.length
        });
    }

    // ==================== CUSTOM STICKY AD (TOP) ====================
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

    // ==================== CONFIGURE ADS ====================

    function configureAds() {
        const pubads = googletag.pubads();

        // Minimal configuration
        pubads.enableSingleRequest();
        pubads.collapseEmptyDivs(true);
        pubads.setCentering(true);

        // ✅ Enable lazy loading for better viewability metrics
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        pubads.enableLazyLoad({
            fetchMarginPercent: isMobile ? 300 : 500,
            renderMarginPercent: isMobile ? 100 : 200,
            mobileScaling: 2.0
        });
        log('Lazy loading enabled for viewability');

        // Track renders
        pubads.addEventListener('slotRenderEnded', function (event) {
            const slot = event.slot;
            const slotId = slot.getSlotElementId();

            log('Ad rendered', {
                slot: slotId,
                isEmpty: event.isEmpty,
                size: event.size
            });

            if (!window.nasrevAds.firstAdRendered) {
                window.nasrevAds.firstAdRendered = true;
                const timeToFirstAd = Date.now() - window.nasrevAds.scriptStartTime;
                log('Time to first ad:', timeToFirstAd + 'ms');

                if (window.gtag) {
                    window.gtag('event', 'timing_complete', {
                        'name': 'first_ad_render',
                        'value': timeToFirstAd
                    });
                }
            }

            // ✅ Start refresh cycle for in-page ads only
            if (!event.isEmpty && slot.customRefresh) {
                window.nasrevAds.refreshCounts.set(slotId, 0);
                startRefreshCycle(slot);
            }
        });

        googletag.enableServices();
        log('Services enabled');
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
            log('Max refresh limit reached', slotId);
            return;
        }

        if (!isSlotInViewport(slotId)) {
            log('Slot not viewable, skipping refresh', slotId);
            return;
        }

        try {
            window.nasrevAds.refreshCounts.set(slotId, currentCount + 1);
            googletag.pubads().updateCorrelator();
            googletag.pubads().refresh([slot]);

            log('Ad refreshed', {
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
            log('Refresh error', error);
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
                log('Stopping refresh cycle - max reached', slotId);
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
        log('Refresh cycle started', { slot: slotId, interval: refreshInterval });
    }

    // Pause refresh when page hidden
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            window.nasrevAds.refreshTimers.forEach(function (timer) {
                clearTimeout(timer);
            });
            log('Refresh paused - page hidden');
        } else {
            window.nasrevAds.slots.inPage.forEach(function (slot) {
                if (slot.customRefresh) {
                    const currentCount = window.nasrevAds.refreshCounts.get(slot.getSlotElementId()) || 0;
                    if (currentCount < MAX_REFRESHES_PER_SLOT) {
                        startRefreshCycle(slot);
                    }
                }
            });
            log('Refresh resumed - page visible');
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
            log('Top sticky ad displayed');
        }

        // Display in-page ads
        window.nasrevAds.slots.inPage.forEach(function (slot) {
            const slotId = slot.getSlotElementId();
            if (slotId !== 'ua-top-sticky') { // Already displayed above
                googletag.display(slotId);
            }
        });

        // Display out-of-page ads
        window.nasrevAds.slots.oop.forEach(function (slot) {
            googletag.display(slot);
        });

        log('Ads displayed', {
            total: window.nasrevAds.slots.inPage.length + window.nasrevAds.slots.oop.length
        });
    }

    function init() {
        if (window.nasrevAds.initialized) return;
        window.nasrevAds.initialized = true;

        log('Initializing minimal ad script');

        addPreconnectLinks(); // Add preconnect for faster loading
        injectStyles();
        initGA();

        window.googletag = window.googletag || { cmd: [] };

        loadScript(GPT_LIBRARY_URL, function () {
            log('GPT loaded');
            googletag.cmd.push(function () {
                setupAdSlots();
                configureAds();
                displayAds();
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
