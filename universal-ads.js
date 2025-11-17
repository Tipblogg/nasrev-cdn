(function () {
    'use strict';
    const SCRIPT_VERSION = '5.0.0-minimal';
    const GPT_LIBRARY_URL = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
    const GA_LIBRARY_URL = 'https://www.googletagmanager.com/gtag/js?id=G-Z0B4ZBF7XH';

    window.nasrevAds = window.nasrevAds || {
        version: SCRIPT_VERSION,
        initialized: false,
        slots: {
            inPage: [],
            oop: []
        },
        scriptStartTime: Date.now()
    };

    function log(message, data) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === '1') {
            console.log(`[Nasrev Ads v${SCRIPT_VERSION}]`, message, data || '');
        }
    }

    // Add preconnect and DNS prefetch for faster ad loading
    function addPreconnectLinks() {
        const links = [
            { rel: 'preconnect', href: 'https://securepubads.g.doubleclick.net', crossorigin: true },
            { rel: 'dns-prefetch', href: 'https://securepubads.g.doubleclick.net' },
            { rel: 'preconnect', href: 'https://pagead2.googlesyndication.com' },
            { rel: 'preconnect', href: 'https://tpc.googlesyndication.com', crossorigin: true }
        ];

        links.forEach(function(linkConfig) {
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
                sizeMappingConfig: [
                    {
                        viewport: [1024, 768],
                        sizes: [[728, 90], [970, 250], [970, 90], [300, 250], [336, 280], [300, 600], [160, 600], [120, 600], [250, 250], [200, 200]]
                    },
                    {
                        viewport: [768, 768],
                        sizes: [[728, 90], [468, 60], [300, 250], [336, 280], [300, 600], [250, 250]]
                    },
                    {
                        viewport: [0, 0],
                        sizes: [[320, 50], [320, 100], [300, 250], [336, 280], [250, 250]]
                    }
                ]
            },
            {
                id: 'ua-placement-2',
                path: '/23272458704/Nasrev.com/Display2',
                sizeMappingConfig: [
                    {
                        viewport: [1024, 768],
                        sizes: [[300, 600], [160, 600], [120, 600], [300, 250], [336, 280], [250, 250], [200, 200]]
                    },
                    {
                        viewport: [768, 768],
                        sizes: [[300, 600], [300, 250], [336, 280], [250, 250]]
                    },
                    {
                        viewport: [0, 0],
                        sizes: [[300, 250], [336, 280], [320, 100], [250, 250]]
                    }
                ]
            },
            {
                id: 'ua-placement-3',
                path: '/23272458704/Nasrev.com/Display3',
                sizeMappingConfig: [
                    {
                        viewport: [1024, 768],
                        sizes: [[970, 250], [970, 90], [728, 90], [468, 60], [300, 250], [336, 280], [250, 250], [200, 200]]
                    },
                    {
                        viewport: [768, 768],
                        sizes: [[728, 90], [468, 60], [300, 250], [336, 280], [250, 250]]
                    },
                    {
                        viewport: [0, 0],
                        sizes: [[320, 50], [320, 100], [300, 250], [250, 250]]
                    }
                ]
            },
            {
                id: 'ua-placement-4',
                path: '/23272458704/Nasrev.com/Display4',
                sizeMappingConfig: [
                    {
                        viewport: [1024, 768],
                        sizes: [[300, 600], [300, 250], [336, 280], [160, 600], [120, 600], [728, 90], [250, 250], [200, 200]]
                    },
                    {
                        viewport: [768, 768],
                        sizes: [[300, 600], [300, 250], [336, 280], [728, 90], [250, 250]]
                    },
                    {
                        viewport: [0, 0],
                        sizes: [[300, 250], [320, 100], [320, 50], [250, 250]]
                    }
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

            // Define slot
            const mapping = googletag.sizeMapping();
            unit.sizeMappingConfig.forEach(function (config) {
                mapping.addSize(config.viewport, config.sizes);
            });

            const slot = googletag.defineSlot(unit.path, unit.sizeMappingConfig[0].sizes, unit.id);
            if (slot) {
                slot.defineSizeMapping(mapping.build());
                slot.addService(googletag.pubads());
                window.nasrevAds.slots.inPage.push(slot);
            }
        });

        // Side Rails
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

    function configureAds() {
        const pubads = googletag.pubads();

        // Minimal configuration - let Google handle optimization
        pubads.enableSingleRequest();
        pubads.collapseEmptyDivs(true);
        pubads.setCentering(true);

        // Track renders
        pubads.addEventListener('slotRenderEnded', function (event) {
            log('Ad rendered', {
                slot: event.slot.getSlotElementId(),
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
        });

        googletag.enableServices();
        log('Services enabled');
    }

    function displayAds() {
        window.nasrevAds.slots.inPage.forEach(function (slot) {
            googletag.display(slot.getSlotElementId());
        });

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
