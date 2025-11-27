(function () {
    'use strict';
    const SCRIPT_VERSION = '4.6.0';
    const CONSENT_TIMEOUT = 1000;
    const GPT_LIBRARY_URL = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
    const GA_LIBRARY_URL = 'https://www.googletagmanager.com/gtag/js?id=G-Z0B4ZBF7XH';
    const GAM_NETWORK_ID = '23272458704';
    const DEFAULT_REFRESH_INTERVAL = 30000;
    const MIN_VIEWABLE_PERCENTAGE = 50;
    const VIEWABILITY_CHECK_INTERVAL = 1000;
    const MAX_REFRESHES_PER_SLOT = 3;

    window.nasrevAds = window.nasrevAds || {
        version: SCRIPT_VERSION,
        initialized: false,
        blocked: false,
        privacy: {
            hasConsent: false,
            npa: false,
            rdp: false,
            gppSid: [],
            gppString: '',
            isEURegion: false
        },
        slots: {
            inPage: [],
            oop: [],
            sideRails: {
                left: null,
                right: null
            }
        },
        refreshTimers: new Map(),
        viewabilityMonitors: new Map(),
        refreshCounts: new Map(),
        errors: [],
        scriptStartTime: Date.now()
    };


    function log(message, data) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === '1') {
            console.log(`[Nasrev Ads v${SCRIPT_VERSION}]`, message, data || '');
        }
    }

    function logError(message, error) {
        console.error(`[Nasrev Ads v${SCRIPT_VERSION}] ERROR:`, message, error || '');
        window.nasrevAds.errors.push({
            timestamp: new Date().toISOString(),
            message: message,
            error: error ? error.toString() : null
        });
    }

    function loadScript(url, onLoad, onError) {
        const script = document.createElement('script');
        script.async = true;
        script.src = url;
        script.crossOrigin = 'anonymous';

        if (onLoad) script.onload = onLoad;
        if (onError) script.onerror = onError;

        document.head.appendChild(script);
        log('Loading script', url);
    }


    function initGoogleAnalytics() {
        try {
            window.dataLayer = window.dataLayer || [];
            function gtag() { dataLayer.push(arguments); }
            window.gtag = gtag;

            gtag('js', new Date());
            gtag('config', 'G-Z0B4ZBF7XH', {
                'page_title': document.title,
                'page_location': window.location.href,
                'page_path': window.location.pathname,
                'custom_map': {
                    'dimension1': 'publisher_domain',
                    'dimension2': 'script_version'
                },
                'publisher_domain': window.location.hostname,
                'script_version': SCRIPT_VERSION
            });

            const loadGA = function () {
                if (window.nasrevAds.gaLoaded) return;
                window.nasrevAds.gaLoaded = true;

                loadScript(GA_LIBRARY_URL, function () {
                    log('Google Analytics loaded successfully');
                }, function () {
                    logError('Failed to load Google Analytics');
                });
            };

            let loaded = false;
            const events = ['scroll', 'mousemove', 'click', 'touchstart'];

            events.forEach(function (event) {
                window.addEventListener(event, function () {
                    if (!loaded) {
                        loaded = true;
                        loadGA();
                    }
                }, { once: true, passive: true });
            });

            setTimeout(function () {
                if (!loaded) {
                    loaded = true;
                    loadGA();
                }
            }, 5000);

            log('Google Analytics initialized (lazy load)');
        } catch (e) {
            logError('Google Analytics initialization failed', e);
        }
    }


    function initGoogleConsentMode() {
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        window.gtag = window.gtag || gtag;

        // Set default consent to denied (will be updated based on region/CMP)
        gtag('consent', 'default', {
            'ad_storage': 'denied',
            'ad_user_data': 'denied',
            'ad_personalization': 'denied',
            'analytics_storage': 'denied',
            'wait_for_update': 500
        });

        log('Google Consent Mode v2 initialized (default: denied)');
    }


    function checkIfEURegion() {
        // Method 1: Timezone heuristic (most reliable)
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const euTimezones = [
                'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
                'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Vienna',
                'Europe/Stockholm', 'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Dublin',
                'Europe/Prague', 'Europe/Warsaw', 'Europe/Budapest', 'Europe/Bucharest',
                'Europe/Athens', 'Europe/Lisbon', 'Europe/Sofia', 'Europe/Zagreb',
                'Europe/Vilnius', 'Europe/Tallinn', 'Europe/Riga', 'Europe/Ljubljana',
                'Europe/Bratislava', 'Europe/Luxembourg', 'Europe/Malta', 'Europe/Nicosia'
            ];
            if (euTimezones.includes(tz)) {
                log('EU region detected via timezone', tz);
                return true;
            }
        } catch (e) {
            log('Timezone check failed', e);
        }

        // Method 2: Check if CMP exists (strong EU indicator)
        if (typeof window.__tcfapi === 'function' || typeof window.__cmp === 'function') {
            log('CMP detected - assuming EU region');
            return true;
        }

        // Method 3: Language check (weak signal, use with caution)
        const lang = navigator.language || navigator.userLanguage || '';
        const euLanguages = ['de', 'fr', 'it', 'es', 'nl', 'pl', 'ro', 'el', 'cs', 'pt', 'hu', 'sv', 'da', 'fi', 'sk', 'bg', 'hr', 'lt', 'lv', 'et', 'sl', 'mt'];
        if (euLanguages.includes(lang.substring(0, 2))) {
            log('Possible EU user via language (weak signal)', lang);
            return true;
        }

        log('Non-EU region detected');
        return false;
    }

    function enableAutoConsent() {
        log('🚀 AUTO-CONSENT: Enabling full consent for maximum fill rate');

        window.nasrevAds.privacy.hasConsent = true;
        window.nasrevAds.privacy.npa = false; // Enable personalized ads
        window.nasrevAds.privacy.rdp = false; // Enable full data processing

        // Update Google Consent Mode to GRANTED
        if (window.gtag) {
            window.gtag('consent', 'update', {
                'ad_storage': 'granted',
                'ad_user_data': 'granted',
                'ad_personalization': 'granted',
                'analytics_storage': 'granted'
            });
            log('Google Consent Mode updated to GRANTED');
        }

        // Track auto-consent in analytics
        if (window.gtag) {
            window.gtag('event', 'auto_consent_enabled', {
                'region': 'non_eu',
                'consent_type': 'automatic'
            });
        }
    }

    function checkGPP() {
        log('Checking for GPP consent framework');

        if (typeof window.__gpp === 'function') {
            try {
                window.__gpp('ping', function (pingData, success) {
                    if (success && pingData) {
                        log('GPP detected', pingData);

                        window.__gpp('getGPPData', function (gppData, success) {
                            if (success && gppData) {
                                window.nasrevAds.privacy.gppString = gppData.gppString || '';
                                window.nasrevAds.privacy.gppSid = gppData.applicableSections || [];

                                log('GPP data retrieved', gppData);

                                if (gppData.parsedSections && gppData.parsedSections.usnat) {
                                    const usnat = gppData.parsedSections.usnat;
                                    if (usnat.SaleOptOut === 1 || usnat.SharingOptOut === 1 || usnat.TargetedAdvertisingOptOut === 1) {
                                        window.nasrevAds.privacy.rdp = true;
                                        log('US Privacy: RDP enabled due to opt-out');
                                    }
                                }

                                window.nasrevAds.privacy.hasConsent = true;
                                initAdLogic();
                            }
                        });
                    }
                });
                return true;
            } catch (e) {
                logError('GPP check failed', e);
            }
        }

        return false;
    }

    function checkTCF() {
        log('Checking for TCF consent framework');

        if (typeof window.__tcfapi === 'function') {
            window.__tcfapi('addEventListener', 2, function (tcData, success) {
                if (success && tcData) {
                    log('TCF detected', tcData);

                    if (tcData.eventStatus === 'tcloaded' || tcData.eventStatus === 'useractioncomplete') {
                        const googleConsent = tcData.vendor && tcData.vendor.consents && tcData.vendor.consents[755];
                        const purpose1 = tcData.purpose && tcData.purpose.consents && tcData.purpose.consents[1];
                        const purpose3 = tcData.purpose && tcData.purpose.consents && tcData.purpose.consents[3];
                        const purpose4 = tcData.purpose && tcData.purpose.consents && tcData.purpose.consents[4];

                        if (googleConsent && purpose1 && purpose3 && purpose4) {
                            window.nasrevAds.privacy.hasConsent = true;
                            log('TCF: Full consent granted');

                            // Update Consent Mode
                            if (window.gtag) {
                                window.gtag('consent', 'update', {
                                    'ad_storage': 'granted',
                                    'ad_user_data': 'granted',
                                    'ad_personalization': 'granted',
                                    'analytics_storage': 'granted'
                                });
                            }
                        } else {
                            window.nasrevAds.privacy.npa = true;
                            log('TCF: Limited consent - enabling NPA mode');

                            // Update Consent Mode (limited)
                            if (window.gtag) {
                                window.gtag('consent', 'update', {
                                    'ad_storage': 'granted',
                                    'ad_user_data': 'denied',
                                    'ad_personalization': 'denied',
                                    'analytics_storage': 'granted'
                                });
                            }
                        }

                        initAdLogic();
                    }
                }
            });
            return true;
        }

        return false;
    }

    function checkUSPrivacy() {
        log('Checking for US Privacy String');

        if (typeof window.__uspapi === 'function') {
            window.__uspapi('getUSPData', 1, function (uspData, success) {
                if (success && uspData && uspData.uspString) {
                    log('US Privacy detected', uspData);

                    const uspString = uspData.uspString;
                    if (uspString.charAt(2) === 'Y') {
                        window.nasrevAds.privacy.rdp = true;
                        log('US Privacy: RDP enabled due to opt-out');
                    }

                    window.nasrevAds.privacy.hasConsent = true;
                    initAdLogic();
                    return true;
                }
            });
            return true;
        }

        return false;
    }

    function detectConsent() {
        log('Starting consent detection');

        // Check if user is in EU/EEA region
        const isEURegion = checkIfEURegion();
        window.nasrevAds.privacy.isEURegion = isEURegion;

        if (!isEURegion) {
            // 🚀 AUTO-CONSENT for non-EU users (MAXIMUM FILL RATE)
            enableAutoConsent();
            initAdLogic();
            return;
        }

        // EU users - check CMP frameworks
        log('EU user detected - checking for CMP frameworks');
        if (checkGPP()) return;
        if (checkTCF()) return;
        if (checkUSPrivacy()) return;

        // EU fallback after timeout
        setTimeout(function () {
            if (!window.nasrevAds.initialized) {
                log('EU user - no CMP detected after timeout, using restricted mode');
                window.nasrevAds.privacy.hasConsent = true;
                window.nasrevAds.privacy.npa = true; // Non-personalized ads only

                // Update Consent Mode (limited)
                if (window.gtag) {
                    window.gtag('consent', 'update', {
                        'ad_storage': 'granted',
                        'ad_user_data': 'denied',
                        'ad_personalization': 'denied',
                        'analytics_storage': 'granted'
                    });
                }

                initAdLogic();
            }
        }, CONSENT_TIMEOUT);
    }

    function getOrGeneratePPID() {
        const config = window.universalAdConfig || {};

        if (config.ppid && typeof config.ppid === 'string' && config.ppid.length > 0) {
            log('Using publisher-provided PPID', config.ppid);
            return config.ppid;
        }

        try {
            let ppid = localStorage.getItem('nasrev_ppid');

            if (!ppid) {
                const domain = window.location.hostname.replace(/[^a-z0-9]/gi, '_');
                const random = Math.random().toString(36).substr(2, 16);
                ppid = domain + '_' + random;

                localStorage.setItem('nasrev_ppid', ppid);
                log('Auto-generated PPID (new user)', ppid);
            } else {
                log('Auto-generated PPID (returning user)', ppid);
            }

            return ppid;

        } catch (e) {
            logError('localStorage blocked, using session-only PPID', e);

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


    // ==================== BLACKLIST VALIDATION ====================

    function checkValidationCache() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('nocache') === '1') {
                log('Cache bypassed via ?nocache=1');
                sessionStorage.removeItem('ua-domain-blocked');
                return null;
            }

            const cached = sessionStorage.getItem('ua-domain-blocked');
            if (cached) {
                const data = JSON.parse(cached);
                const now = Date.now();

                // 5 minute cache
                if (now - data.timestamp < 300000) {
                    log('Using cached validation', data.blocked ? 'BLOCKED' : 'ALLOWED');
                    return data.blocked;
                } else {
                    sessionStorage.removeItem('ua-domain-blocked');
                }
            }
        } catch (e) {
            logError('Cache check failed', e);
        }
        return null;
    }

    function saveValidationCache(isBlocked) {
        try {
            sessionStorage.setItem('ua-domain-blocked', JSON.stringify({
                blocked: isBlocked,
                timestamp: Date.now()
            }));
            log('Validation cached for 5 minutes', isBlocked ? 'BLOCKED' : 'ALLOWED');
        } catch (e) {
            logError('Cache save failed', e);
        }
    }

    // Function to check if domain matches a blacklist pattern
    function isDomainBlacklisted(currentDomain, blacklistDomains) {
        return blacklistDomains.some(function (domain) {
            // Handle wildcard domains (*.example.com)
            if (domain.startsWith('*.')) {
                const baseDomain = domain.substring(2);
                // Match subdomains and the base domain itself
                return currentDomain.endsWith('.' + baseDomain) || currentDomain === baseDomain;
            }

            // Exact match (with www handling)
            const normalizedCurrent = currentDomain.replace(/^www\./, '');
            const normalizedBlacklist = domain.replace(/^www\./, '');

            return normalizedCurrent === normalizedBlacklist ||
                currentDomain === domain ||
                currentDomain === 'www.' + domain ||
                'www.' + currentDomain === domain;
        });
    }

    // Function to stop/destroy all ads when domain is blacklisted
    function stopAllAds() {
        log('🛑 STOPPING ALL ADS - Domain is blacklisted');

        // Mark as blocked immediately
        window.nasrevAds.blocked = true;

        // Clear all refresh timers
        window.nasrevAds.refreshTimers.forEach(function (timer) {
            clearTimeout(timer);
        });
        window.nasrevAds.refreshTimers.clear();

        // Destroy all slots
        if (window.googletag && googletag.destroySlots) {
            googletag.cmd.push(function () {
                try {
                    googletag.destroySlots();
                    log('All ad slots destroyed');
                } catch (e) {
                    logError('Failed to destroy slots', e);
                }
            });
        }

        // Remove ad containers from DOM
        const adContainers = document.querySelectorAll('[id^="ua-placement"], [id^="ua-anchor"]');
        adContainers.forEach(function (container) {
            const wrapper = container.closest('.ua-ad-wrapper');
            if (wrapper) {
                wrapper.remove();
            } else {
                container.remove();
            }
        });

        // Remove any injected styles
        const styles = document.getElementById('nasrev-ads-styles');
        if (styles) {
            styles.remove();
        }

        // Track blocking event
        if (window.gtag) {
            window.gtag('event', 'domain_blocked', {
                'domain': window.location.hostname,
                'reason': 'blacklist'
            });
        }

        console.error('%c[Nasrev Ads] Domain Blacklisted - Ads Disabled', 'color: red; font-weight: bold;');
        console.error('Domain:', window.location.hostname);
        console.error('Contact Nasrev to remove your domain from the blacklist.');
    }

    function validatePublisherAsync() {
        const currentDomain = window.location.hostname;

        log('Checking if domain is blacklisted', currentDomain);

        // Fallback blacklist (embedded in case fetch fails)
        // Add critical blocked domains here as fallback
        const fallbackBlacklist = [
            // Example: 'spam-site.com', '*.malicious-network.com'
        ];

        fetch('https://raw.githubusercontent.com/Tipblogg/nasrev-cdn/refs/heads/main/pubs.json', {
            method: 'GET',
            cache: 'no-cache'
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Failed to fetch pubs.json: ' + response.status);
                }
                return response.json();
            })
            .then(function (data) {
                if (!data.domains || !Array.isArray(data.domains)) {
                    throw new Error('Invalid pubs.json format');
                }

                // Check if domain is in BLACKLIST
                const isBlocked = isDomainBlacklisted(currentDomain, data.domains);

                if (isBlocked) {
                    logError('Domain is BLACKLISTED - ads will be blocked', currentDomain);
                    saveValidationCache(true); // true = blocked

                    // Stop all ads immediately
                    stopAllAds();
                } else {
                    log('✅ Domain is ALLOWED (not in blacklist)', currentDomain);
                    saveValidationCache(false); // false = not blocked
                }
            })
            .catch(function (error) {
                logError('Validation error (falling back to embedded list)', error);

                // Check fallback blacklist
                const isBlockedFallback = isDomainBlacklisted(currentDomain, fallbackBlacklist);

                if (isBlockedFallback) {
                    logError('Domain is BLACKLISTED (fallback)', currentDomain);
                    saveValidationCache(true);
                    stopAllAds();
                } else {
                    log('✅ Domain is ALLOWED (fallback - not in blacklist)', currentDomain);
                    saveValidationCache(false);
                }
            });
    }

    function initAdLogic() {
        if (window.nasrevAds.initialized) {
            log('Already initialized - skipping');
            return;
        }

        if (window.nasrevAds.blocked) {
            log('Domain is blocked - skipping ad initialization');
            return;
        }

        log('Initializing ad logic');

        try {
            const cachedStatus = checkValidationCache();

            // If cached as BLOCKED, don't show ads
            if (cachedStatus === true) {
                logError('Domain blocked by cache. To retry: Add ?nocache=1 to URL or clear browser cache.');
                console.error('%c[Nasrev Ads] Domain Blacklisted', 'color: red; font-weight: bold;');
                console.error('Your domain is in the blocked list.');
                console.error('Solutions:');
                console.error('  1. Add ?nocache=1 to URL to retry validation');
                console.error('  2. Contact Nasrev to remove your domain from blacklist');
                console.error('  3. Current domain:', window.location.hostname);
                window.nasrevAds.blocked = true;
                return;
            }

            window.nasrevAds.initialized = true;

            initGoogleAnalytics();
            proceedWithAds();

            // Always validate async (will stop ads if blacklisted)
            validatePublisherAsync();

        } catch (error) {
            logError('Initialization failed', error);
        }
    }


    function injectStyles() {
        if (document.getElementById('nasrev-ads-styles')) return;

        const style = document.createElement('style');
        style.id = 'nasrev-ads-styles';
        style.textContent = `
            .ua-branding {
                font-size: 10px;
                color: #999;
                text-align: center;
                margin-top: 8px;
                font-family: Arial, sans-serif;
                letter-spacing: 0.3px;
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
                font-weight: bold;
                min-height: 50px;
                width: 100%;
                border: 1px dashed #ddd;
                border-radius: 4px;
            }
            .ua-ad-wrapper {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                width: 100%;
                margin: 0 auto;
            }
            .ua-ad-label {
                font-size: 11px;
                color: #666;
                text-align: center;
                margin-bottom: 8px;
                font-family: Arial, sans-serif;
                font-weight: bold;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .ua-ad-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 50px;
            }
        `;
        document.head.appendChild(style);
        log('Styles injected (CSP-friendly)');
    }


    function injectAdBranding(slotDiv) {
        try {
            const branding = document.createElement('div');
            branding.className = 'ua-branding';
            branding.innerHTML = 'ads by <a href="https://nasrev.com" target="_blank" rel="noopener">nasrev.com</a>';
            slotDiv.appendChild(branding);
        } catch (e) {
            logError('Failed to inject ad branding', e);
        }
    }

    function proceedWithAds() {
        // Check if blocked before proceeding
        if (window.nasrevAds.blocked) {
            log('Domain is blocked - not proceeding with ads');
            return;
        }

        log('Proceeding with ad setup');

        injectStyles();

        window.googletag = window.googletag || { cmd: [] };

        loadScript(GPT_LIBRARY_URL, function () {
            log('GPT library loaded');
        }, function () {
            logError('Failed to load GPT library');
        });

        googletag.cmd.push(function () {
            try {
                // Double-check blocked status
                if (window.nasrevAds.blocked) {
                    log('Domain blocked - aborting ad setup');
                    return;
                }
                setupAdSlots();
                configurePublisherAds();
                displayAds();
            } catch (e) {
                logError('Ad setup failed', e);
            }
        });
    }

    function setupAdSlots() {
        // Check if blocked
        if (window.nasrevAds.blocked) {
            log('Domain is blocked - not setting up ad slots');
            return;
        }

        log('Setting up ad slots with MAXIMUM fill rate configuration');

        const adUnits = [
            {
                id: 'ua-placement-1',
                path: '/23272458704/Nasrev.com/Display',
                sizeMappingConfig: [
                    {
                        viewport: [1024, 768],
                        sizes: [
                            [728, 90],
                            [970, 250],
                            [970, 90],
                            [300, 250],
                            [336, 280],
                            [300, 600],
                            [160, 600],
                            [120, 600],
                            [250, 250],
                            [200, 200]
                        ]
                    },
                    {
                        viewport: [768, 768],
                        sizes: [
                            [728, 90],
                            [468, 60],
                            [300, 250],
                            [336, 280],
                            [300, 600],
                            [250, 250]
                        ]
                    },
                    {
                        viewport: [0, 0],
                        sizes: [
                            [320, 50],
                            [320, 100],
                            [300, 250],
                            [336, 280],
                            [250, 250]
                        ]
                    }
                ],
                refresh: true
            },
            {
                id: 'ua-placement-2',
                path: '/23272458704/Nasrev.com/Display2',
                sizeMappingConfig: [
                    {
                        viewport: [1024, 768],
                        sizes: [
                            [300, 600],
                            [160, 600],
                            [120, 600],
                            [300, 250],
                            [336, 280],
                            [250, 250],
                            [200, 200]
                        ]
                    },
                    {
                        viewport: [768, 768],
                        sizes: [
                            [300, 600],
                            [300, 250],
                            [336, 280],
                            [250, 250]
                        ]
                    },
                    {
                        viewport: [0, 0],
                        sizes: [
                            [300, 250],
                            [336, 280],
                            [320, 100],
                            [250, 250]
                        ]
                    }
                ],
                refresh: true
            },
            {
                id: 'ua-placement-3',
                path: '/23272458704/Nasrev.com/Display3',
                sizeMappingConfig: [
                    {
                        viewport: [1024, 768],
                        sizes: [
                            [970, 250],
                            [970, 90],
                            [728, 90],
                            [468, 60],
                            [300, 250],
                            [336, 280],
                            [250, 250],
                            [200, 200]
                        ]
                    },
                    {
                        viewport: [768, 768],
                        sizes: [
                            [728, 90],
                            [468, 60],
                            [300, 250],
                            [336, 280],
                            [250, 250]
                        ]
                    },
                    {
                        viewport: [0, 0],
                        sizes: [
                            [320, 50],
                            [320, 100],
                            [300, 250],
                            [250, 250]
                        ]
                    }
                ],
                refresh: true
            },
            {
                id: 'ua-placement-4',
                path: '/23272458704/Nasrev.com/Display4',
                sizeMappingConfig: [
                    {
                        viewport: [1024, 768],
                        sizes: [
                            [300, 600],
                            [300, 250],
                            [336, 280],
                            [160, 600],
                            [120, 600],
                            [728, 90],
                            [250, 250],
                            [200, 200]
                        ]
                    },
                    {
                        viewport: [768, 768],
                        sizes: [
                            [300, 600],
                            [300, 250],
                            [336, 280],
                            [728, 90],
                            [250, 250]
                        ]
                    },
                    {
                        viewport: [0, 0],
                        sizes: [
                            [300, 250],
                            [320, 100],
                            [320, 50],
                            [250, 250]
                        ]
                    }
                ],
                refresh: true
            }
        ];

        adUnits.forEach(function (unit) {
            const slotDiv = document.getElementById(unit.id);

            if (slotDiv) {
                const wrapper = document.createElement('div');
                wrapper.className = 'ua-ad-wrapper';

                const label = document.createElement('div');
                label.className = 'ua-ad-label';
                label.textContent = 'Advertisement';
                wrapper.appendChild(label);

                slotDiv.parentNode.insertBefore(wrapper, slotDiv);
                wrapper.appendChild(slotDiv);

                slotDiv.className = 'ua-ad-container';

                const placeholder = document.createElement('div');
                placeholder.className = 'ua-placeholder';
                placeholder.textContent = 'Loading ad...';
                slotDiv.appendChild(placeholder);

                injectAdBranding(wrapper);

                const mapping = googletag.sizeMapping();
                unit.sizeMappingConfig.forEach(function (config) {
                    mapping.addSize(config.viewport, config.sizes);
                });

                const slot = googletag.defineSlot(
                    unit.path,
                    unit.sizeMappingConfig[0].sizes,
                    unit.id
                );

                if (slot) {
                    slot.defineSizeMapping(mapping.build());
                    slot.addService(googletag.pubads());
                    slot.customRefresh = unit.refresh;
                    window.nasrevAds.slots.inPage.push(slot);
                    window.nasrevAds.refreshCounts.set(unit.id, 0);

                    log('Slot defined with optimized sizes', {
                        id: unit.id,
                        refresh: unit.refresh,
                        desktopSizes: unit.sizeMappingConfig[0].sizes.length,
                        tabletSizes: unit.sizeMappingConfig[1].sizes.length,
                        mobileSizes: unit.sizeMappingConfig[2].sizes.length
                    });
                }
            }
        });

        // ==================== SIDE RAILS ====================
        log('Setting up side rail ads');

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
            window.nasrevAds.slots.sideRails.left = leftSideRail;
            window.nasrevAds.slots.oop.push(leftSideRail);
            log('Left side rail defined');
        }

        if (rightSideRail) {
            rightSideRail.addService(googletag.pubads());
            window.nasrevAds.slots.sideRails.right = rightSideRail;
            window.nasrevAds.slots.oop.push(rightSideRail);
            log('Right side rail defined');
        }

        // ==================== ANCHOR AD ====================
        const anchorDiv = document.getElementById('ua-anchor');
        if (anchorDiv) {
            const anchorSlot = googletag.defineOutOfPageSlot(
                '/23272458704/Nasrev.com/Anchor',
                googletag.enums.OutOfPageFormat.BOTTOM_ANCHOR
            );

            if (anchorSlot) {
                anchorSlot.addService(googletag.pubads());
                window.nasrevAds.slots.oop.push(anchorSlot);
                log('Anchor slot defined');
            }
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
            window.nasrevAds.slots.interstitial = interstitialSlot;
            log('Interstitial defined with triggers');
        }

        log('Total slots configured', {
            inPage: window.nasrevAds.slots.inPage.length,
            oop: window.nasrevAds.slots.oop.length,
            allRefreshEnabled: true
        });
    }

    // ==================== PHASE 4: CONFIGURE PUBADS ====================

    function applyPublisherContext() {
        const pubContext = window.myPublisherContext || {};
        const pubads = googletag.pubads();

        log('Checking for publisher context', pubContext);

        // Category detection with generic keyword filter
        const GENERIC_CATEGORIES = ['home', 'about', 'contact', 'blog', 'news', 'page', 'post', 'index', 'main', 'category', 'uncategorized'];

        // CATEGORY (critical for Safari monetization)
        if (pubContext.category && typeof pubContext.category === 'string') {
            pubads.setTargeting('category', pubContext.category);
            pubads.setTargeting('category_source', 'publisher');
            log('✅ Category from publisher context', pubContext.category);
        } else {
            // UNIVERSAL CATEGORY DETECTION - Works on ANY website
            let category = null;
            let categorySource = 'none';

            // Method 1: Meta tags (Yoast SEO, RankMath, etc)
            const categoryMeta = document.querySelector('meta[property="article:section"]') ||
                document.querySelector('meta[property="article:tag"]') ||
                document.querySelector('meta[name="category"]') ||
                document.querySelector('meta[name="categories"]') ||
                document.querySelector('meta[name="news_keywords"]') ||
                document.querySelector('meta[name="article:section"]');

            if (categoryMeta && categoryMeta.content) {
                category = categoryMeta.content;
                categorySource = 'meta';
                log('✅ Category from meta tag', category);
            }

            // Method 2: WordPress default structure
            if (!category) {
                const wpCategory = document.querySelector('.cat-links a[rel="category"]') ||
                    document.querySelector('.category a') ||
                    document.querySelector('.post-categories a') ||
                    document.querySelector('.entry-category a') ||
                    document.querySelector('[class*="category"] a[href*="/category/"]') ||
                    document.querySelector('a[rel="category tag"]');

                if (wpCategory) {
                    category = wpCategory.textContent.trim();
                    categorySource = 'html_wp';
                    log('✅ Category from WordPress HTML', category);
                }
            }

            // Method 3: Schema.org markup
            if (!category) {
                const schemaScript = document.querySelector('script[type="application/ld+json"]');
                if (schemaScript) {
                    try {
                        const schema = JSON.parse(schemaScript.textContent);
                        if (schema.articleSection) {
                            category = schema.articleSection;
                            categorySource = 'schema';
                            log('✅ Category from Schema.org', category);
                        } else if (schema['@graph']) {
                            for (let item of schema['@graph']) {
                                if (item.articleSection) {
                                    category = item.articleSection;
                                    categorySource = 'schema';
                                    log('✅ Category from Schema.org graph', category);
                                    break;
                                }
                            }
                        }
                    } catch (e) { }
                }
            }

            // Method 4: Common CMS patterns (Joomla, Drupal, Ghost, etc)
            if (!category) {
                const cmsCategory = document.querySelector('.tags a') ||
                    document.querySelector('.post-tag a') ||
                    document.querySelector('.article-category') ||
                    document.querySelector('.blog-category') ||
                    document.querySelector('[class*="cat-"] a') ||
                    document.querySelector('.breadcrumb a:last-of-type') ||
                    document.querySelector('.breadcrumbs a:nth-last-child(2)');

                if (cmsCategory) {
                    category = cmsCategory.textContent.trim();
                    categorySource = 'html_cms';
                    log('✅ Category from CMS pattern', category);
                }
            }

            // Method 5: URL path extraction (last resort)
            if (!category) {
                const urlPath = window.location.pathname;
                const categoryMatch = urlPath.match(/\/category\/([^\/]+)/) ||
                    urlPath.match(/\/cat\/([^\/]+)/) ||
                    urlPath.match(/\/topic\/([^\/]+)/) ||
                    urlPath.match(/\/section\/([^\/]+)/) ||
                    urlPath.match(/\/([^\/]+)\/\d{4}\//) ||
                    urlPath.match(/\/blog\/([^\/]+)\//);

                if (categoryMatch && categoryMatch[1]) {
                    category = categoryMatch[1];
                    categorySource = 'url';
                    log('✅ Category from URL path', category);
                }
            }

            // Clean and validate category
            if (category) {
                // Clean and normalize category
                category = category
                    .toLowerCase()
                    .trim()
                    .replace(/\s+/g, '_')
                    .replace(/[^a-z0-9_,]/g, '')
                    .substring(0, 50);

                // Filter out generic categories
                if (GENERIC_CATEGORIES.includes(category)) {
                    log('⚠️ Generic category detected, not using', category);
                    category = null;
                    categorySource = 'none';
                }
            }

            // Apply category if found
            if (category) {
                pubads.setTargeting('category', category);
                pubads.setTargeting('category_source', categorySource);
                log('✅ Final category applied', { category: category, source: categorySource });
            } else {
                pubads.setTargeting('category_source', 'none');
                log('⚠️ No category detected - using generic targeting');
            }
        }

        // CONTENT TYPE - Universal detection
        if (pubContext.content_type && typeof pubContext.content_type === 'string') {
            pubads.setTargeting('content_type', pubContext.content_type);
            log('Content type from publisher', pubContext.content_type);
        } else {
            // Universal content type detection
            let contentType = 'page'; // default

            // Method 1: Schema.org
            const schemaScript = document.querySelector('script[type="application/ld+json"]');
            if (schemaScript) {
                try {
                    const schema = JSON.parse(schemaScript.textContent);
                    if (schema['@type'] === 'Article' || schema['@type'] === 'NewsArticle' || schema['@type'] === 'BlogPosting') {
                        contentType = 'article';
                    } else if (schema['@type'] === 'VideoObject') {
                        contentType = 'video';
                    } else if (schema['@graph']) {
                        for (let item of schema['@graph']) {
                            if (item['@type'] === 'Article' || item['@type'] === 'NewsArticle' || item['@type'] === 'BlogPosting') {
                                contentType = 'article';
                                break;
                            } else if (item['@type'] === 'VideoObject') {
                                contentType = 'video';
                                break;
                            }
                        }
                    }
                } catch (e) { }
            }

            // Method 2: HTML5 semantic tags
            if (contentType === 'page') {
                if (document.querySelector('article')) {
                    contentType = 'article';
                } else if (document.querySelector('video, .video-player, [class*="video"]')) {
                    contentType = 'video';
                }
            }

            // Method 3: Meta tags
            if (contentType === 'page') {
                const typeMeta = document.querySelector('meta[property="og:type"]');
                if (typeMeta) {
                    const ogType = typeMeta.content.toLowerCase();
                    if (ogType.includes('article')) contentType = 'article';
                    else if (ogType.includes('video')) contentType = 'video';
                }
            }

            pubads.setTargeting('content_type', contentType);
            log('Content type detected', contentType);
        }

        // FIRST-PARTY AUDIENCE DATA (High-value for Safari)
        if (pubContext.login_status) {
            pubads.setTargeting('login_status', pubContext.login_status);
            log('✅ Login status', pubContext.login_status);
        }
        if (pubContext.sub_status) {
            pubads.setTargeting('sub_status', pubContext.sub_status);
            log('✅ Subscription status', pubContext.sub_status);
        }
        if (pubContext.engagement_level) {
            pubads.setTargeting('engagement', pubContext.engagement_level);
            log('✅ Engagement level', pubContext.engagement_level);
        }

        // AUTHOR (valuable for news sites)
        if (pubContext.author) {
            pubads.setTargeting('author', pubContext.author.toLowerCase().replace(/[^a-z0-9]/g, '_'));
        }

        // ARTICLE AGE (fresh content = higher CPM)
        if (pubContext.publish_date) {
            const publishDate = new Date(pubContext.publish_date);
            const ageHours = Math.floor((Date.now() - publishDate.getTime()) / 3600000);
            pubads.setTargeting('content_age',
                ageHours < 1 ? 'fresh' :
                    ageHours < 24 ? 'today' :
                        ageHours < 168 ? 'week' : 'old'
            );
        }

        // TAGS/KEYWORDS
        if (pubContext.tags && Array.isArray(pubContext.tags)) {
            pubads.setTargeting('tags', pubContext.tags.slice(0, 5));
        }

        log('Publisher context applied', {
            category: pubads.getTargeting('category')[0],
            categorySource: pubads.getTargeting('category_source')[0],
            login: pubContext.login_status,
            subscription: pubContext.sub_status
        });
    }

    function addRevenueOptimizationSignals() {
        const pubads = googletag.pubads();

        // 1. Page Value Score
        let pageValue = 0;

        if (document.querySelector('article')) pageValue += 2;
        if (document.querySelector('.premium, .subscriber-only, .paywall')) pageValue += 3;
        if (document.querySelector('video')) pageValue += 2;

        const wordCount = (document.body.innerText || '').split(/\s+/).length;
        if (wordCount > 1000) pageValue += 1;
        if (wordCount > 2000) pageValue += 1;

        pubads.setTargeting('page_value',
            pageValue >= 5 ? 'premium' :
                pageValue >= 3 ? 'standard' : 'basic'
        );

        // 2. Ad Density
        const adCount = window.nasrevAds.slots.inPage.length;
        const contentHeight = document.body.scrollHeight;
        const adsPerScreen = adCount / (contentHeight / window.innerHeight);

        pubads.setTargeting('ad_density',
            adsPerScreen < 0.5 ? 'low' :
                adsPerScreen < 1 ? 'medium' : 'high'
        );

        // 3. Brand Safety Score
        const bodyText = (document.body.innerText || '').toLowerCase();
        const riskyKeywords = ['violence', 'death', 'crime', 'tragedy', 'disaster', 'scandal'];
        const riskyCount = riskyKeywords.filter(function (kw) { return bodyText.includes(kw); }).length;

        pubads.setTargeting('brand_safety',
            riskyCount === 0 ? 'safe' :
                riskyCount <= 2 ? 'moderate' : 'sensitive'
        );

        log('Revenue optimization signals', {
            pageValue: pubads.getTargeting('page_value')[0],
            adDensity: pubads.getTargeting('ad_density')[0],
            brandSafety: pubads.getTargeting('brand_safety')[0]
        });
    }

    function configurePublisherAds() {
        // Check if blocked
        if (window.nasrevAds.blocked) {
            log('Domain is blocked - not configuring publisher ads');
            return;
        }

        const pubads = googletag.pubads();
        const config = window.universalAdConfig || {};

        log('Configuring publisher ads with ALL Google features enabled');

        const ppid = getOrGeneratePPID();

        pubads.enableSingleRequest();
        pubads.collapseEmptyDivs(true);

        const privacy = window.nasrevAds.privacy;
        if (privacy.rdp === true) {
            pubads.setPrivacySettings({ restrictedDataProcessing: true });
            log('Privacy: RDP enabled');
        }
        if (privacy.npa === true) {
            pubads.setPrivacySettings({ nonPersonalizedAds: true });
            log('Privacy: NPA enabled');
        }

        pubads.setPublisherProvidedId(ppid);

        // More aggressive lazy loading on mobile
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        pubads.enableLazyLoad({
            fetchMarginPercent: isMobile ? 300 : 500,
            renderMarginPercent: isMobile ? 100 : 200,
            mobileScaling: 2.0
        });
        log('Lazy loading enabled', { mobile: isMobile });

        pubads.enableVideoAds();
        log('Video ads enabled');

        pubads.setSafeFrameConfig({
            allowOverlayExpansion: true,
            allowPushExpansion: true,
            sandbox: true
        });
        log('SafeFrame enabled');

        pubads.setCentering(true);
        log('Ad centering enabled');

        applyPublisherContext();

        addRevenueOptimizationSignals();


        const isTablet = /iPad|Android(?!.*Mobile)/i.test(navigator.userAgent);
        const deviceType = isMobile ? 'mobile' : (isTablet ? 'tablet' : 'desktop');
        pubads.setTargeting('device', deviceType);

        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        pubads.setTargeting('screen_w', (Math.floor(screenWidth / 100) * 100).toString());
        pubads.setTargeting('screen_h', (Math.floor(screenHeight / 100) * 100).toString());

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        pubads.setTargeting('viewport_w', (Math.floor(viewportWidth / 100) * 100).toString());
        pubads.setTargeting('viewport_h', (Math.floor(viewportHeight / 100) * 100).toString());

        const dpr = window.devicePixelRatio || 1;
        pubads.setTargeting('dpr', dpr >= 2 ? 'high' : 'standard');

        const orientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
        pubads.setTargeting('orientation', orientation);

        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay();
        const month = now.getMonth() + 1;

        pubads.setTargeting('hour', hour.toString());
        pubads.setTargeting('day', day.toString());
        pubads.setTargeting('month', month.toString());
        pubads.setTargeting('is_weekend', (day === 0 || day === 6) ? '1' : '0');
        pubads.setTargeting('daypart',
            hour >= 6 && hour < 12 ? 'morning' :
                hour >= 12 && hour < 17 ? 'afternoon' :
                    hour >= 17 && hour < 21 ? 'evening' : 'night'
        );

        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (timezone) {
                pubads.setTargeting('timezone', timezone.replace(/\//g, '_'));
            }
        } catch (e) { }

        try {
            let visits = parseInt(localStorage.getItem('nasrev_visits') || '0') + 1;
            localStorage.setItem('nasrev_visits', visits);
            pubads.setTargeting('visit_count',
                visits === 1 ? '1' :
                    visits <= 3 ? '2-3' :
                        visits <= 5 ? '4-5' :
                            visits <= 10 ? '6-10' : '11+'
            );

            let pageDepth = parseInt(sessionStorage.getItem('nasrev_page_depth') || '0') + 1;
            sessionStorage.setItem('nasrev_page_depth', pageDepth);
            pubads.setTargeting('page_depth', Math.min(pageDepth, 10).toString());

            const sessionStart = parseInt(sessionStorage.getItem('nasrev_session_start') || Date.now());
            sessionStorage.setItem('nasrev_session_start', sessionStart);
            const sessionAge = Math.floor((Date.now() - sessionStart) / 1000);
            pubads.setTargeting('session_age',
                sessionAge < 30 ? '0-30s' :
                    sessionAge < 60 ? '30-60s' :
                        sessionAge < 180 ? '1-3m' :
                            sessionAge < 300 ? '3-5m' : '5m+'
            );
        } catch (e) {
            log('Storage blocked, skipping engagement signals');
        }

        if (document.referrer) {
            try {
                const referrerUrl = new URL(document.referrer);
                const referrerHost = referrerUrl.hostname;

                pubads.setTargeting('referrer', referrerHost.replace(/^www\./, ''));

                if (/google\.(com|co\.|[a-z]{2})/.test(referrerHost)) {
                    pubads.setTargeting('source', 'google');
                    pubads.setTargeting('source_type', 'search');
                } else if (/bing\.(com|co\.|[a-z]{2})/.test(referrerHost)) {
                    pubads.setTargeting('source', 'bing');
                    pubads.setTargeting('source_type', 'search');
                } else if (/yahoo\.(com|co\.|[a-z]{2})/.test(referrerHost)) {
                    pubads.setTargeting('source', 'yahoo');
                    pubads.setTargeting('source_type', 'search');
                } else if (/facebook\.com|fb\.com|instagram\.com/.test(referrerHost)) {
                    pubads.setTargeting('source', 'facebook');
                    pubads.setTargeting('source_type', 'social');
                } else if (/twitter\.com|t\.co|x\.com/.test(referrerHost)) {
                    pubads.setTargeting('source', 'twitter');
                    pubads.setTargeting('source_type', 'social');
                } else if (/linkedin\.com/.test(referrerHost)) {
                    pubads.setTargeting('source', 'linkedin');
                    pubads.setTargeting('source_type', 'social');
                } else if (/reddit\.com/.test(referrerHost)) {
                    pubads.setTargeting('source', 'reddit');
                    pubads.setTargeting('source_type', 'social');
                } else if (/pinterest\.com/.test(referrerHost)) {
                    pubads.setTargeting('source', 'pinterest');
                    pubads.setTargeting('source_type', 'social');
                } else if (/youtube\.com|youtu\.be/.test(referrerHost)) {
                    pubads.setTargeting('source', 'youtube');
                    pubads.setTargeting('source_type', 'video');
                } else {
                    pubads.setTargeting('source', 'referral');
                    pubads.setTargeting('source_type', 'referral');
                }
            } catch (e) {
                log('Invalid referrer URL');
            }
        } else {
            pubads.setTargeting('source', 'direct');
            pubads.setTargeting('source_type', 'direct');
        }

        if ('connection' in navigator && navigator.connection) {
            const conn = navigator.connection;
            if (conn.effectiveType) {
                pubads.setTargeting('connection', conn.effectiveType);
            }
            if (conn.saveData) {
                pubads.setTargeting('data_saver', '1');
            }
        }

        const lang = navigator.language || navigator.userLanguage || 'en';
        pubads.setTargeting('lang', lang.substring(0, 2).toLowerCase());

        const pageLang = document.documentElement.lang;
        if (pageLang && pageLang !== lang) {
            pubads.setTargeting('page_lang', pageLang.substring(0, 2).toLowerCase());
        }

        let maxScrollPercent = 0;
        window.addEventListener('scroll', function () {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scrollPercent = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;

            if (scrollPercent > maxScrollPercent) {
                maxScrollPercent = scrollPercent;

                if (scrollPercent >= 25 && maxScrollPercent < 50) {
                    pubads.setTargeting('scroll_depth', '25');
                } else if (scrollPercent >= 50 && maxScrollPercent < 75) {
                    pubads.setTargeting('scroll_depth', '50');
                } else if (scrollPercent >= 75 && maxScrollPercent < 100) {
                    pubads.setTargeting('scroll_depth', '75');
                } else if (scrollPercent >= 100) {
                    pubads.setTargeting('scroll_depth', '100');
                }
            }
        });

        pubads.setTargeting('script_version', SCRIPT_VERSION);
        pubads.setTargeting('domain', window.location.hostname);
        pubads.setTargeting('ppid_enabled', '1');
        pubads.setTargeting('ad_count', window.nasrevAds.slots.inPage.length.toString());
        pubads.setTargeting('consent_region', window.nasrevAds.privacy.isEURegion ? 'eu' : 'non_eu');

        log('Enhanced targeting configured', {
            device: deviceType,
            viewport: viewportWidth + 'x' + viewportHeight,
            hour: hour,
            source: pubads.getTargeting('source')[0],
            consentRegion: pubads.getTargeting('consent_region')[0]
        });

        setupAdRefreshListeners();
        setupAdvancedViewability();

        // Render event listener with proper refresh initiation
        pubads.addEventListener('slotRenderEnded', function (event) {
            // Check if blocked
            if (window.nasrevAds.blocked) {
                return;
            }

            const slot = event.slot;
            const divId = slot.getSlotElementId();
            const div = document.getElementById(divId);

            if (div) {
                const placeholder = div.querySelector('.ua-placeholder');
                if (placeholder) {
                    placeholder.remove();
                }
            }

            log('Slot rendered', {
                divId: divId,
                isEmpty: event.isEmpty,
                size: event.size,
                advertiserId: event.advertiserId,
                creativeId: event.creativeId
            });

            // Track performance
            if (!window.nasrevAds.firstAdRendered) {
                window.nasrevAds.firstAdRendered = true;
                const timeToFirstAd = Date.now() - window.nasrevAds.scriptStartTime;

                if (window.gtag) {
                    window.gtag('event', 'timing_complete', {
                        'name': 'first_ad_render',
                        'value': timeToFirstAd
                    });
                }

                log('⏱️ Time to first ad:', timeToFirstAd + 'ms');
            }

            // Start refresh cycle immediately after render
            if (slot.customRefresh && !event.isEmpty) {
                const slotId = slot.getSlotElementId();
                log('🔄 Starting refresh cycle for', slotId);
                startRefreshCycle(slot);
            }
        });

        pubads.addEventListener('impressionViewable', function (event) {
            log('Impression viewable', {
                slot: event.slot.getSlotElementId()
            });

            // Track in GA
            if (window.gtag) {
                window.gtag('event', 'ad_viewable', {
                    'slot_id': event.slot.getSlotElementId()
                });
            }
        });

        googletag.enableServices();
        log('GPT services enabled with ALL features');
    }


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

    function startRefreshCycle(slot) {
        // Check if blocked
        if (window.nasrevAds.blocked) {
            return;
        }

        const config = window.universalAdConfig || {};
        const refreshInterval = Math.max(config.refreshInterval || DEFAULT_REFRESH_INTERVAL, 30000);
        const slotId = slot.getSlotElementId();

        // Clear any existing timers
        if (window.nasrevAds.refreshTimers.has(slotId)) {
            clearTimeout(window.nasrevAds.refreshTimers.get(slotId));
        }

        log('🔄 Refresh cycle started', {
            slotId: slotId,
            interval: refreshInterval + 'ms',
            maxRefreshes: MAX_REFRESHES_PER_SLOT
        });

        function scheduleNextRefresh() {
            // Check if blocked
            if (window.nasrevAds.blocked) {
                return;
            }

            const currentCount = window.nasrevAds.refreshCounts.get(slotId) || 0;

            // Check max refresh limit
            if (currentCount >= MAX_REFRESHES_PER_SLOT) {
                log('🛑 Max refresh limit reached', {
                    slotId: slotId,
                    totalRefreshes: currentCount
                });
                return;
            }

            const timer = setTimeout(function () {
                // Check if blocked
                if (window.nasrevAds.blocked) {
                    return;
                }

                if (isSlotInViewport(slotId)) {
                    refreshSlot(slot);
                    scheduleNextRefresh(); // Reschedule after successful refresh
                } else {
                    log('⏸️ Slot not viewable, checking again in 1s', slotId);
                    // Check again in 1 second
                    setTimeout(function () {
                        if (window.nasrevAds.blocked) return;

                        if (isSlotInViewport(slotId)) {
                            refreshSlot(slot);
                            scheduleNextRefresh();
                        } else {
                            // Still not viewable, reschedule full interval
                            scheduleNextRefresh();
                        }
                    }, VIEWABILITY_CHECK_INTERVAL);
                }
            }, refreshInterval);

            window.nasrevAds.refreshTimers.set(slotId, timer);
        }

        scheduleNextRefresh();
    }

    // Refresh with error handling and retry logic
    function refreshSlot(slot, retryCount) {
        // Check if blocked
        if (window.nasrevAds.blocked) {
            return;
        }

        retryCount = retryCount || 0;
        const MAX_RETRIES = 2;
        const slotId = slot.getSlotElementId();

        // Double-check viewability
        if (!isSlotInViewport(slotId)) {
            log('⏸️ Refresh cancelled - slot not viewable', slotId);
            return;
        }

        // Check max refresh limit
        const currentCount = window.nasrevAds.refreshCounts.get(slotId) || 0;
        if (currentCount >= MAX_REFRESHES_PER_SLOT) {
            log('🛑 Max refresh limit reached during refresh attempt', slotId);
            return;
        }

        try {
            // Increment refresh count
            window.nasrevAds.refreshCounts.set(slotId, currentCount + 1);

            log('🔄 REFRESHING SLOT', {
                slotId: slotId,
                refreshCount: currentCount + 1,
                attempt: retryCount + 1
            });

            // Update correlator for new ads
            googletag.pubads().updateCorrelator();

            // Refresh the slot
            googletag.pubads().refresh([slot]);

            // Track in GA
            if (window.gtag) {
                window.gtag('event', 'ad_refresh', {
                    'slot_id': slotId,
                    'refresh_count': currentCount + 1
                });
            }

        } catch (error) {
            logError('Refresh failed', error);

            // Retry logic
            if (retryCount < MAX_RETRIES) {
                log('⚠️ Retrying refresh', {
                    slotId: slotId,
                    attempt: retryCount + 2
                });

                setTimeout(function () {
                    if (!window.nasrevAds.blocked) {
                        refreshSlot(slot, retryCount + 1);
                    }
                }, 5000); // Retry after 5 seconds
            } else {
                logError('Max retry attempts reached', slotId);

                if (window.gtag) {
                    window.gtag('event', 'ad_refresh_failed', {
                        'slot_id': slotId,
                        'error': error.toString()
                    });
                }
            }
        }
    }

    function setupAdRefreshListeners() {
        const config = window.universalAdConfig || {};
        const refreshInterval = Math.max(config.refreshInterval || DEFAULT_REFRESH_INTERVAL, 30000);

        log('🔄 Ad refresh system initialized (viewability-based)', {
            interval: refreshInterval + 'ms',
            minViewability: MIN_VIEWABLE_PERCENTAGE + '%',
            maxRefreshes: MAX_REFRESHES_PER_SLOT
        });

        // Clean up on page unload
        window.addEventListener('beforeunload', function () {
            window.nasrevAds.refreshTimers.forEach(function (timer) {
                clearTimeout(timer);
            });
        });

        // Pause refresh when page is hidden
        document.addEventListener('visibilitychange', function () {
            if (window.nasrevAds.blocked) return;

            if (document.hidden) {
                log('⏸️ Page hidden - pausing all refresh cycles');
                window.nasrevAds.refreshTimers.forEach(function (timer, slotId) {
                    if (slotId.indexOf('_last') === -1) {
                        clearTimeout(timer);
                    }
                });
            } else {
                log('▶️ Page visible - resuming refresh cycles');
                window.nasrevAds.slots.inPage.forEach(function (slot) {
                    if (slot.customRefresh) {
                        const currentCount = window.nasrevAds.refreshCounts.get(slot.getSlotElementId()) || 0;
                        if (currentCount < MAX_REFRESHES_PER_SLOT) {
                            startRefreshCycle(slot);
                        }
                    }
                });
            }
        });
    }

    function setupAdvancedViewability() {
        const pubads = googletag.pubads();

        // Track viewability changes
        pubads.addEventListener('slotVisibilityChanged', function (event) {
            if (window.nasrevAds.blocked) return;

            const inViewPercentage = event.inViewPercentage;
            const slotId = event.slot.getSlotElementId();

            log('Viewability changed', {
                slot: slotId,
                visible: inViewPercentage + '%'
            });

            // Track 50% viewability threshold
            if (inViewPercentage >= 50) {
                if (window.gtag) {
                    window.gtag('event', 'ad_50_percent_viewable', {
                        'slot_id': slotId,
                        'viewability': inViewPercentage
                    });
                }
            }
        });

        // Track slot load times
        pubads.addEventListener('slotOnload', function (event) {
            if (window.nasrevAds.blocked) return;

            const slotId = event.slot.getSlotElementId();
            log('Slot loaded', slotId);

            if (window.gtag) {
                window.gtag('event', 'ad_loaded', {
                    'slot_id': slotId
                });
            }
        });

        log('Advanced viewability tracking enabled');
    }


    function displayAds() {
        // Check if blocked
        if (window.nasrevAds.blocked) {
            log('Domain is blocked - not displaying ads');
            return;
        }

        log('Displaying ads');

        window.nasrevAds.slots.inPage.forEach(function (slot) {
            googletag.display(slot.getSlotElementId());
        });

        log('In-page slots displayed', window.nasrevAds.slots.inPage.length);

        const sideRails = window.nasrevAds.slots.sideRails;
        if (sideRails.left) {
            googletag.display(sideRails.left);
            log('Left side rail displayed');
        }
        if (sideRails.right) {
            googletag.display(sideRails.right);
            log('Right side rail displayed');
        }

        if (window.nasrevAds.slots.interstitial) {
            googletag.display(window.nasrevAds.slots.interstitial);
            log('Interstitial displayed');
        }

        window.nasrevAds.slots.oop.forEach(function (slot) {
            if (slot !== sideRails.left && slot !== sideRails.right && slot !== window.nasrevAds.slots.interstitial) {
                googletag.display(slot);
            }
        });

        log('✅ All ads displayed', {
            inPage: window.nasrevAds.slots.inPage.length,
            oop: window.nasrevAds.slots.oop.length,
            refreshEnabled: true,
            maxRefreshPerSlot: MAX_REFRESHES_PER_SLOT
        });
    }

    function init() {
        try {
            log('Script loaded', {
                version: SCRIPT_VERSION,
                url: window.location.href,
                userAgent: navigator.userAgent
            });

            // Initialize Google Consent Mode FIRST
            initGoogleConsentMode();

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', detectConsent);
            } else {
                detectConsent();
            }

        } catch (error) {
            logError('Initialization error', error);
        }
    }

    init();

})();
