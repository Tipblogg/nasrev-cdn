(function() {
  'use strict';

  // ==================== CONSTANTS ====================
  const SCRIPT_VERSION = '4.3.1'; // FIXED: GPT warnings + refresh for all slots
  const CONSENT_TIMEOUT = 1000;
  const GPT_LIBRARY_URL = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
  const GA_LIBRARY_URL = 'https://www.googletagmanager.com/gtag/js?id=G-Z0B4ZBF7XH';
  const GAM_NETWORK_ID = '23272458704';
  const DEFAULT_REFRESH_INTERVAL = 30000;
  const MIN_VIEWABLE_TIME = 1000;
  
  // ==================== GLOBAL STATE ====================
  window.nasrevAds = window.nasrevAds || {
    version: SCRIPT_VERSION,
    initialized: false,
    privacy: {
      hasConsent: false,
      npa: false,
      rdp: false,
      gppSid: [],
      gppString: ''
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
    viewabilityTimers: new Map(),
    errors: []
  };

  // ==================== UTILITY FUNCTIONS ====================
  
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

  // ==================== GOOGLE ANALYTICS INTEGRATION ====================
  
  function initGoogleAnalytics() {
    try {
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
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
      
      loadScript(GA_LIBRARY_URL, function() {
        log('Google Analytics loaded successfully');
      }, function() {
        logError('Failed to load Google Analytics');
      });
      
      log('Google Analytics initialized');
    } catch (e) {
      logError('Google Analytics initialization failed', e);
    }
  }

  // ==================== PHASE 0: CONSENT MANAGEMENT ====================
  
  function checkGPP() {
    log('Checking for GPP consent framework');
    
    if (typeof window.__gpp === 'function') {
      try {
        window.__gpp('ping', function(pingData, success) {
          if (success && pingData) {
            log('GPP detected', pingData);
            
            window.__gpp('getGPPData', function(gppData, success) {
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
      window.__tcfapi('addEventListener', 2, function(tcData, success) {
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
            } else {
              window.nasrevAds.privacy.npa = true;
              log('TCF: Limited consent - enabling NPA mode');
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
      window.__uspapi('getUSPData', 1, function(uspData, success) {
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
    
    if (checkGPP()) return;
    if (checkTCF()) return;
    if (checkUSPrivacy()) return;
    
    setTimeout(function() {
      if (!window.nasrevAds.initialized) {
        log('No CMP detected after timeout - proceeding with default consent');
        window.nasrevAds.privacy.hasConsent = true;
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
        const random = Math.random().toString(36).substr(2, 12);
        const timestamp = Date.now().toString(36);
        ppid = domain + '_' + random + '_' + timestamp;
        
        localStorage.setItem('nasrev_ppid', ppid);
        log('Auto-generated PPID (new user)', ppid);
      } else {
        log('Auto-generated PPID (returning user)', ppid);
      }
      
      return ppid;
      
    } catch (e) {
      logError('localStorage blocked, using session-only PPID', e);
      const fallback = 'session_' + Math.random().toString(36).substr(2, 15);
      return fallback;
    }
  }

  // ==================== PHASE 1: PUBLISHER VALIDATION ====================
  
  function checkValidationCache() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('nocache') === '1') {
        log('Cache bypassed via ?nocache=1');
        sessionStorage.removeItem('ua-domain-valid');
        return null;
      }
      
      const cached = sessionStorage.getItem('ua-domain-valid');
      if (cached) {
        const data = JSON.parse(cached);
        const now = Date.now();
        
        if (now - data.timestamp < 86400000) {
          log('Using cached validation', data.valid);
          return data.valid;
        } else {
          sessionStorage.removeItem('ua-domain-valid');
        }
      }
    } catch (e) {
      logError('Cache check failed', e);
    }
    return null;
  }

  function saveValidationCache(isValid) {
    try {
      sessionStorage.setItem('ua-domain-valid', JSON.stringify({
        valid: isValid,
        timestamp: Date.now()
      }));
      log('Validation cached', isValid);
    } catch (e) {
      logError('Cache save failed', e);
    }
  }

  function validatePublisherAsync() {
    const currentDomain = window.location.hostname;
    
    log('Validating publisher domain (async)', currentDomain);
    
    const fallbackDomains = [
      'apvisit.com',
      'localhost',
      '127.0.0.1'
    ];
    
    fetch('https://raw.githubusercontent.com/Tipblogg/nasrev-cdn/refs/heads/main/pubs.json', {
      method: 'GET',
      cache: 'no-cache'
    })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('Failed to fetch pubs.json: ' + response.status);
      }
      return response.json();
    })
    .then(function(data) {
      if (!data.domains || !Array.isArray(data.domains)) {
        throw new Error('Invalid pubs.json format');
      }
      
      const isApproved = data.domains.some(function(domain) {
        if (domain.startsWith('*.')) {
          const baseDomain = domain.substring(2);
          return currentDomain.endsWith(baseDomain);
        }
        return currentDomain === domain;
      });
      
      if (isApproved) {
        log('Domain approved (from pubs.json)', currentDomain);
        saveValidationCache(true);
      } else {
        logError('Domain not approved', currentDomain);
        saveValidationCache(false);
      }
    })
    .catch(function(error) {
      logError('Validation error (falling back to embedded list)', error);
      
      const isApprovedFallback = fallbackDomains.some(function(domain) {
        if (domain.startsWith('*.')) {
          const baseDomain = domain.substring(2);
          return currentDomain.endsWith(baseDomain);
        }
        return currentDomain === domain;
      });
      
      if (isApprovedFallback) {
        log('Domain approved (from embedded fallback list)', currentDomain);
        console.warn('[Nasrev Ads] Using embedded publisher list due to CORS/network error');
        saveValidationCache(true);
      } else {
        logError('Domain not in fallback list', currentDomain);
        saveValidationCache(false);
      }
    });
  }

  function initAdLogic() {
    if (window.nasrevAds.initialized) {
      log('Already initialized - skipping');
      return;
    }
    
    log('Initializing ad logic');
    
    try {
      const cachedStatus = checkValidationCache();
      
      if (cachedStatus === false) {
        logError('Domain blocked by cache. To retry: Add ?nocache=1 to URL or clear browser cache.');
        console.error('%c[Nasrev Ads] Domain Not Approved', 'color: red; font-weight: bold;');
        console.error('Your domain is not in the approved publishers list.');
        console.error('Solutions:');
        console.error('  1. Add ?nocache=1 to URL to retry validation');
        console.error('  2. Contact Nasrev to add your domain to pubs.json');
        console.error('  3. Current domain:', window.location.hostname);
        return;
      }
      
      window.nasrevAds.initialized = true;
      
      initGoogleAnalytics();
      proceedWithAds();
      
      if (cachedStatus !== true) {
        validatePublisherAsync();
      }
      
    } catch (error) {
      logError('Initialization failed', error);
    }
  }

  // ==================== PHASE 2: AD SETUP ====================
  
  function injectAdBranding(slotDiv) {
    try {
      const branding = document.createElement('div');
      branding.className = 'ua-branding';
      branding.innerHTML = 'ads by <a href="https://nasrev.com" target="_blank" rel="noopener">nasrev.com</a>';
      branding.style.cssText = `
        font-size: 10px;
        color: #999;
        text-align: center;
        margin-top: 8px;
        font-family: Arial, sans-serif;
        letter-spacing: 0.3px;
      `;
      const link = branding.querySelector('a');
      if (link) {
        link.style.cssText = `
          color: #4CAF50;
          text-decoration: none;
          font-weight: bold;
        `;
      }
      slotDiv.appendChild(branding);
    } catch (e) {
      logError('Failed to inject ad branding', e);
    }
  }

  function proceedWithAds() {
    log('Proceeding with ad setup');
    
    window.googletag = window.googletag || {cmd: []};
    
    loadScript(GPT_LIBRARY_URL, function() {
      log('GPT library loaded');
    }, function() {
      logError('Failed to load GPT library');
    });
    
    googletag.cmd.push(function() {
      try {
        setupAdSlots();
        configurePublisherAds();
        displayAds();
      } catch (e) {
        logError('Ad setup failed', e);
      }
    });
  }

  // ==================== PHASE 3: SLOT DETECTION & DEFINITION ====================
  
  function setupAdSlots() {
    log('Setting up ad slots with MAXIMUM fill rate configuration');
    
    // FIX: Enable refresh for ALL slots
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
        refresh: true // ✅ ENABLED
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
        refresh: true // ✅ CHANGED FROM FALSE TO TRUE
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
        refresh: true // ✅ ENABLED
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
        refresh: true // ✅ CHANGED FROM FALSE TO TRUE
      }
    ];
    
    adUnits.forEach(function(unit) {
      const slotDiv = document.getElementById(unit.id);
      
      if (slotDiv) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          margin: 0 auto;
        `;
        
        const label = document.createElement('div');
        label.textContent = 'Advertisement';
        label.style.cssText = `
          font-size: 11px;
          color: #666;
          text-align: center;
          margin-bottom: 8px;
          font-family: Arial, sans-serif;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        `;
        wrapper.appendChild(label);
        
        slotDiv.parentNode.insertBefore(wrapper, slotDiv);
        wrapper.appendChild(slotDiv);
        
        slotDiv.style.cssText = `
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 50px;
        `;
        
        const placeholder = document.createElement('div');
        placeholder.className = 'ua-placeholder';
        placeholder.style.cssText = `
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
        `;
        placeholder.textContent = 'Loading ad...';
        slotDiv.appendChild(placeholder);
        
        injectAdBranding(wrapper);
        
        // FIX #1: Build size mapping
        const mapping = googletag.sizeMapping();
        unit.sizeMappingConfig.forEach(function(config) {
          mapping.addSize(config.viewport, config.sizes);
        });
        
        // FIX #1: Pass FIRST size array (not empty array)
        const slot = googletag.defineSlot(
          unit.path, 
          unit.sizeMappingConfig[0].sizes, // ✅ FIXED: Pass actual sizes
          unit.id
        );
        
        if (slot) {
          slot.defineSizeMapping(mapping.build());
          slot.addService(googletag.pubads());
          slot.customRefresh = unit.refresh;
          window.nasrevAds.slots.inPage.push(slot);
          
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
      allRefreshEnabled: true // ✅ All slots now have refresh
    });
  }

  // ==================== PHASE 4: CONFIGURE PUBADS ====================
  
  function configurePublisherAds() {
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
    
    pubads.enableLazyLoad({
      fetchMarginPercent: 500,
      renderMarginPercent: 200,
      mobileScaling: 2.0
    });
    log('Aggressive lazy loading enabled');
    
    pubads.enableVideoAds();
    log('Video ads enabled');
    
    // FIX #2: Remove invalid property 'useUniqueDomain'
    pubads.setSafeFrameConfig({
      allowOverlayExpansion: true,
      allowPushExpansion: true,
      sandbox: true
      // ✅ REMOVED: useUniqueDomain (not a valid property)
    });
    log('SafeFrame enabled');
    
    pubads.setCentering(true);
    log('Ad centering enabled');
    
    // ===== ENHANCED TARGETING (ALL VALUES AS STRINGS) =====
    
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    const isTablet = /iPad|Android(?!.*Mobile)/i.test(navigator.userAgent);
    const deviceType = isMobile ? 'mobile' : (isTablet ? 'tablet' : 'desktop');
    pubads.setTargeting('device', deviceType);
    
    // FIX #3: Convert numbers to strings
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    pubads.setTargeting('screen_w', (Math.floor(screenWidth / 100) * 100).toString()); // ✅ FIXED
    pubads.setTargeting('screen_h', (Math.floor(screenHeight / 100) * 100).toString()); // ✅ FIXED
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    pubads.setTargeting('viewport_w', (Math.floor(viewportWidth / 100) * 100).toString()); // ✅ FIXED
    pubads.setTargeting('viewport_h', (Math.floor(viewportHeight / 100) * 100).toString()); // ✅ FIXED
    
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
    } catch (e) {}
    
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
    
    const categoryMeta = document.querySelector('meta[property="article:section"]') || 
                         document.querySelector('meta[name="category"]') ||
                         document.querySelector('meta[name="news_keywords"]');
    if (categoryMeta) {
      const category = categoryMeta.content.toLowerCase().replace(/[^a-z0-9,]/g, '_');
      pubads.setTargeting('category', category);
    }
    
    const articleTag = document.querySelector('article');
    const videoTag = document.querySelector('video');
    if (articleTag) {
      pubads.setTargeting('content_type', 'article');
    } else if (videoTag) {
      pubads.setTargeting('content_type', 'video');
    } else {
      pubads.setTargeting('content_type', 'page');
    }
    
    let maxScrollPercent = 0;
    window.addEventListener('scroll', function() {
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
    
    log('Enhanced targeting configured', {
      device: deviceType,
      viewport: viewportWidth + 'x' + viewportHeight,
      hour: hour,
      source: pubads.getTargeting('source')[0]
    });
    
    setupAdRefreshListeners();
    
    pubads.addEventListener('slotRenderEnded', function(event) {
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
    });
    
    pubads.addEventListener('impressionViewable', function(event) {
      log('Impression viewable', {
        slot: event.slot.getSlotElementId()
      });
    });
    
    googletag.enableServices();
    log('GPT services enabled with ALL features');
  }

  // ==================== PHASE 5: AD REFRESH ====================
  
  function startRefreshTimer(slot) {
    const config = window.universalAdConfig || {};
    const refreshInterval = Math.max(config.refreshInterval || DEFAULT_REFRESH_INTERVAL, 30000);
    const slotId = slot.getSlotElementId();
    
    if (window.nasrevAds.refreshTimers.has(slotId)) {
      clearTimeout(window.nasrevAds.refreshTimers.get(slotId));
    }
    
    log('Starting refresh timer', { slotId: slotId, interval: refreshInterval + 'ms' });
    
    const timer = setTimeout(function() {
      if (isSlotInViewport(slotId)) {
        log('Refreshing slot', slotId);
        googletag.pubads().refresh([slot]);
        startRefreshTimer(slot);
      } else {
        log('Slot not viewable, stopping refresh', slotId);
      }
    }, refreshInterval);
    
    window.nasrevAds.refreshTimers.set(slotId, timer);
  }

  function setupAdRefreshListeners() {
    const config = window.universalAdConfig || {};
    const refreshInterval = Math.max(config.refreshInterval || DEFAULT_REFRESH_INTERVAL, 30000);
    
    log('Setting up viewability-based refresh for ALL slots', { 
      interval: refreshInterval + 'ms'
    });
    
    googletag.pubads().addEventListener('impressionViewable', function(event) {
      const slot = event.slot;
      
      if (!slot.customRefresh) {
        log('Slot not eligible for refresh (should not happen)', slot.getSlotElementId());
        return;
      }
      
      const slotId = slot.getSlotElementId();
      
      log('Impression viewable - starting refresh cycle', slotId);
      startRefreshTimer(slot);
    });
    
    window.addEventListener('beforeunload', function() {
      window.nasrevAds.refreshTimers.forEach(function(timer) {
        clearTimeout(timer);
      });
    });
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
    
    return visibilityRatio >= 0.5;
  }

  // ==================== PHASE 6: DISPLAY ADS ====================
  
  function displayAds() {
    log('Displaying ads');
    
    window.nasrevAds.slots.inPage.forEach(function(slot) {
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
    
    window.nasrevAds.slots.oop.forEach(function(slot) {
      if (slot !== sideRails.left && slot !== sideRails.right && slot !== window.nasrevAds.slots.interstitial) {
        googletag.display(slot);
      }
    });
    
    log('All ads displayed', {
      inPage: window.nasrevAds.slots.inPage.length,
      oop: window.nasrevAds.slots.oop.length,
      allRefreshEnabled: true
    });
  }

  // ==================== ENTRY POINT ====================
  
  function init() {
    try {
      log('Script loaded', { 
        version: SCRIPT_VERSION, 
        url: window.location.href,
        userAgent: navigator.userAgent
      });
      
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
