(function() {
  'use strict';

  // ==================== CONSTANTS ====================
  const SCRIPT_VERSION = '4.2.0'; // FIXED: Low fill rates + performance issues
  const CONSENT_TIMEOUT = 1000; // 1 second timeout for CMP detection
  const GPT_LIBRARY_URL = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
  const GA_LIBRARY_URL = 'https://www.googletagmanager.com/gtag/js?id=G-Z0B4ZBF7XH';
  const GAM_NETWORK_ID = '23272458704'; // Hardcoded for all publishers
  const DEFAULT_REFRESH_INTERVAL = 30000; // 30 seconds - Google minimum recommendation
  const MIN_VIEWABLE_TIME = 1000; // 1 second - IAB/MRC viewability standard
  
  // ==================== GLOBAL STATE ====================
  window.nasrevAds = window.nasrevAds || {
    version: SCRIPT_VERSION,
    initialized: false,
    privacy: {
      hasConsent: false,
      npa: false, // Non-Personalized Ads (TCF)
      rdp: false, // Restricted Data Processing (US Privacy)
      gppSid: [], // GPP Section IDs
      gppString: '' // GPP String
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
    viewabilityTimers: new Map(), // Track cumulative viewable time
    errors: []
  };

  // ==================== UTILITY FUNCTIONS ====================
  
  /**
   * Debug logger - only logs when debugMode is enabled via URL parameter
   */
  function log(message, data) {
    // Check for ?debug=1 in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('debug') === '1') {
      console.log(`[Nasrev Ads v${SCRIPT_VERSION}]`, message, data || '');
    }
  }

  /**
   * Error logger - always logs errors
   */
  function logError(message, error) {
    console.error(`[Nasrev Ads v${SCRIPT_VERSION}] ERROR:`, message, error || '');
    window.nasrevAds.errors.push({
      timestamp: new Date().toISOString(),
      message: message,
      error: error ? error.toString() : null
    });
  }

  /**
   * Load external script asynchronously
   */
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
  
  /**
   * Initialize Google Analytics for page view tracking
   */
  function initGoogleAnalytics() {
    try {
      // Initialize dataLayer
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      window.gtag = gtag;
      
      // Configure GA
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
      
      // Load GA script
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
  
  /**
   * Check for GPP (Global Privacy Platform) - Latest IAB Standard
   */
  function checkGPP() {
    log('Checking for GPP consent framework');
    
    if (typeof window.__gpp === 'function') {
      try {
        window.__gpp('ping', function(pingData, success) {
          if (success && pingData) {
            log('GPP detected', pingData);
            
            // Get GPP string and section IDs
            window.__gpp('getGPPData', function(gppData, success) {
              if (success && gppData) {
                window.nasrevAds.privacy.gppString = gppData.gppString || '';
                window.nasrevAds.privacy.gppSid = gppData.applicableSections || [];
                
                log('GPP data retrieved', gppData);
                
                // Check for US Privacy opt-outs
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

  /**
   * Check for TCF v2.2 (EU/EEA)
   */
  function checkTCF() {
    log('Checking for TCF consent framework');
    
    if (typeof window.__tcfapi === 'function') {
      window.__tcfapi('addEventListener', 2, function(tcData, success) {
        if (success && tcData) {
          log('TCF detected', tcData);
          
          if (tcData.eventStatus === 'tcloaded' || tcData.eventStatus === 'useractioncomplete') {
            // Check for Google (Vendor ID 755) consent
            const googleConsent = tcData.vendor && tcData.vendor.consents && tcData.vendor.consents[755];
            
            // Check for required purposes (1: Storage, 3: Personalized Ads, 4: Content Selection)
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

  /**
   * Check for legacy US Privacy String (CCPA/CPRA)
   */
  function checkUSPrivacy() {
    log('Checking for US Privacy String');
    
    if (typeof window.__uspapi === 'function') {
      window.__uspapi('getUSPData', 1, function(uspData, success) {
        if (success && uspData && uspData.uspString) {
          log('US Privacy detected', uspData);
          
          // Parse string (e.g., "1YYN" = version 1, explicit yes, explicit yes, notice given)
          const uspString = uspData.uspString;
          if (uspString.charAt(2) === 'Y') { // User opted out
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

  /**
   * Main consent detection function
   */
  function detectConsent() {
    log('Starting consent detection');
    
    // Priority order: GPP > TCF > US Privacy > Fallback
    if (checkGPP()) return;
    if (checkTCF()) return;
    if (checkUSPrivacy()) return;
    
    // No CMP detected - set timeout fallback
    setTimeout(function() {
      if (!window.nasrevAds.initialized) {
        log('No CMP detected after timeout - proceeding with default consent');
        
        // Proceed assuming consent (non-regulated geo or publisher's responsibility)
        window.nasrevAds.privacy.hasConsent = true;
        initAdLogic();
      }
    }, CONSENT_TIMEOUT);
  }

  /**
   * Generate automatic PPID if publisher doesn't provide one
   */
  function getOrGeneratePPID() {
    const config = window.universalAdConfig || {};
    
    // Check if publisher provided PPID
    if (config.ppid && typeof config.ppid === 'string' && config.ppid.length > 0) {
      log('Using publisher-provided PPID', config.ppid);
      return config.ppid;
    }
    
    // Auto-generate browser-based PPID
    try {
      let ppid = localStorage.getItem('nasrev_ppid');
      
      if (!ppid) {
        // Generate new PPID: domain + random + timestamp
        const domain = window.location.hostname.replace(/[^a-z0-9]/gi, '_');
        const random = Math.random().toString(36).substr(2, 12);
        const timestamp = Date.now().toString(36);
        ppid = domain + '_' + random + '_' + timestamp;
        
        // Store for future visits
        localStorage.setItem('nasrev_ppid', ppid);
        log('Auto-generated PPID (new user)', ppid);
      } else {
        log('Auto-generated PPID (returning user)', ppid);
      }
      
      return ppid;
      
    } catch (e) {
      // Fallback if localStorage blocked
      logError('localStorage blocked, using session-only PPID', e);
      const fallback = 'session_' + Math.random().toString(36).substr(2, 15);
      return fallback;
    }
  }

  // ==================== PHASE 1: PUBLISHER VALIDATION ====================
  
  /**
   * Check session cache for validation status
   */
  function checkValidationCache() {
    try {
      // Allow cache bypass with ?nocache=1
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
        
        // Cache for 24 hours
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

  /**
   * Save validation status to cache
   */
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

  /**
   * Validate publisher domain against approved list (NON-BLOCKING)
   */
  function validatePublisherAsync() {
    const currentDomain = window.location.hostname;
    
    log('Validating publisher domain (async)', currentDomain);
    
    // Embedded fallback list (updated: 2025-10-31)
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
      
      // Check if current domain is in approved list
      const isApproved = data.domains.some(function(domain) {
        // Support both exact match and wildcard subdomain
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
      
      // CORS ERROR or network failure - use embedded fallback list
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
        console.warn('Fix CORS on https://raw.githubusercontent.com/Tipblogg/nasrev-cdn/refs/heads/main/pubs.json for live updates');
        saveValidationCache(true);
      } else {
        logError('Domain not in fallback list', currentDomain);
        saveValidationCache(false);
      }
    });
  }

  /**
   * Initialize ad logic after consent is determined
   */
  function initAdLogic() {
    if (window.nasrevAds.initialized) {
      log('Already initialized - skipping');
      return;
    }
    
    log('Initializing ad logic');
    
    try {
      // FIX #8: Check validation cache (non-blocking)
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
      
      // Mark as initialized IMMEDIATELY
      window.nasrevAds.initialized = true;
      
      // Initialize Google Analytics
      initGoogleAnalytics();
      
      // FIX #8: Start ads immediately, validate in background
      proceedWithAds();
      
      // Run validation asynchronously (won't block ads)
      if (cachedStatus !== true) {
        validatePublisherAsync();
      }
      
    } catch (error) {
      logError('Initialization failed', error);
    }
  }

  // ==================== PHASE 2: AD SETUP ====================
  
  /**
   * Inject per-ad branding (centered below each ad)
   */
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

  /**
   * Main ad setup function
   */
  function proceedWithAds() {
    log('Proceeding with ad setup');
    
    // Initialize googletag
    window.googletag = window.googletag || {cmd: []};
    
    // Load GPT library
    loadScript(GPT_LIBRARY_URL, function() {
      log('GPT library loaded');
    }, function() {
      logError('Failed to load GPT library');
    });
    
    // Push all setup logic to GPT command queue
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
  
  /**
   * Setup all ad slots - hardcoded configuration
   */
  function setupAdSlots() {
    log('Setting up ad slots with optimized configuration');
    
    // FIX #1: UNIQUE ad unit paths per placement
    // FIX #2: OPTIMIZED size arrays (removed low-demand 320x100, 300x100)
    const adUnits = [
      {
        id: 'ua-placement-1',
        path: '/23272458704/Nasrev.com/Display', // Display (main)
        sizes: [[300, 250], [336, 280], [320, 50]],
        refresh: true
      },
      {
        id: 'ua-placement-2',
        path: '/23272458704/Nasrev.com/Display2', // Display2
        sizes: [[300, 250], [336, 280], [300, 600], [320, 50]],
        refresh: false
      },
      {
        id: 'ua-placement-3',
        path: '/23272458704/Nasrev.com/Display3', // Display3
        sizes: [[300, 250], [336, 280], [300, 600], [320, 50]],
        refresh: true
      },
      {
        id: 'ua-placement-4',
        path: '/23272458704/Nasrev.com/Display4', // Display4
        sizes: [[300, 250], [336, 280], [300, 600], [320, 50]],
        refresh: false
      }
    ];
    
    // Define in-page slots
    adUnits.forEach(function(unit) {
      const slotDiv = document.getElementById(unit.id);
      
      if (slotDiv) {
        // Create wrapper container for centering everything
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          margin: 0 auto;
        `;
        
        // Inject "Advertisement" label (BOLD) - TOP
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
        
        // Move slotDiv into wrapper
        slotDiv.parentNode.insertBefore(wrapper, slotDiv);
        wrapper.appendChild(slotDiv);
        
        // Style the slotDiv itself
        slotDiv.style.cssText = `
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        `;
        
        // Inject placeholder
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
          border: 1px dashed #ddd;
          border-radius: 4px;
        `;
        placeholder.textContent = 'Loading ad...';
        slotDiv.appendChild(placeholder);
        
        // Inject "ads by nasrev.com" branding - BOTTOM (in wrapper, not slotDiv!)
        injectAdBranding(wrapper);
        
        // Define slot
        const slot = googletag.defineSlot(unit.path, unit.sizes, unit.id);
        
        if (slot) {
          slot.addService(googletag.pubads());
          slot.customRefresh = unit.refresh;
          window.nasrevAds.slots.inPage.push(slot);
          log('In-page slot defined', unit.id);
        }
      }
    });
    
    // ==================== SIDE RAIL ADS ====================
    // FIX #7: Display both side rails separately
    log('Setting up side rail ads');
    
    const leftSideRail = googletag.defineOutOfPageSlot(
      '/23272458704/Nasrev.com/Siderail',
      googletag.enums.OutOfPageFormat.LEFT_SIDE_RAIL
    );
    
    const rightSideRail = googletag.defineOutOfPageSlot(
      '/23272458704/Nasrev.com/Siderail',
      googletag.enums.OutOfPageFormat.RIGHT_SIDE_RAIL
    );
    
    // Side rail slots return null if the page or device does not support side rails
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
    
    // Log side rail support status
    if (leftSideRail && rightSideRail) {
      log('Side rail ads: Both left and right initialized');
    } else if (leftSideRail || rightSideRail) {
      log('Side rail ads: Only ' + (leftSideRail ? 'left' : 'right') + ' initialized');
    } else {
      log('Side rail ads: Not supported on this page/device');
    }
    
    // Define anchor ad (if div exists)
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
    
    // ==================== INTERSTITIAL WITH TRIGGERS ====================
    // FIX #10: Store interstitial separately for explicit display
    const interstitialSlot = googletag.defineOutOfPageSlot(
      '/23272458704/Nasrev.com/Interstitial',
      googletag.enums.OutOfPageFormat.INTERSTITIAL
    );
    
    if (interstitialSlot) {
      // Enable optional interstitial triggers for better fill rate
      const enableTriggers = true;
      
      interstitialSlot.setConfig({
        interstitial: {
          triggers: {
            navBar: enableTriggers,      // Desktop: clicks on browser nav bar
            unhideWindow: enableTriggers  // Tab/window unhide or maximize
          }
        }
      });
      
      interstitialSlot.addService(googletag.pubads());
      window.nasrevAds.slots.oop.push(interstitialSlot);
      window.nasrevAds.slots.interstitial = interstitialSlot; // Store separately
      log('Interstitial slot defined with triggers enabled', {
        navBar: enableTriggers,
        unhideWindow: enableTriggers
      });
    }
  }

  // ==================== PHASE 4: CONFIGURE PUBADS ====================
  
  /**
   * Configure publisher ads service
   */
  function configurePublisherAds() {
    const pubads = googletag.pubads();
    const config = window.universalAdConfig || {};
    
    log('Configuring publisher ads service');
    
    // Get or auto-generate PPID (always available now!)
    const ppid = getOrGeneratePPID();
    
    // FIX #3: Enable Single Request Architecture properly
    pubads.enableSingleRequest();
    
    // Collapse empty divs
    pubads.collapseEmptyDivs(true);
    
    // Apply privacy settings from Phase 0
    const privacy = window.nasrevAds.privacy;
    
    if (privacy.rdp === true) {
      pubads.setPrivacySettings({
        restrictedDataProcessing: true
      });
      log('Privacy: RDP enabled');
    }
    
    if (privacy.npa === true) {
      pubads.setPrivacySettings({
        nonPersonalizedAds: true
      });
      log('Privacy: NPA enabled');
    }
    
    // Set PPID (auto-generated or publisher-provided)
    pubads.setPublisherProvidedId(ppid);
    log('PPID set for better targeting', ppid);
    
    // FIX #5: OPTIMIZED lazy loading settings
    pubads.enableLazyLoad({
      fetchMarginPercent: 100,    // Fetch 1 viewport ahead (reduced from 200)
      renderMarginPercent: 50,    // Render 0.5 viewport ahead (reduced from 100)
      mobileScaling: 2.0          // 2x on mobile
    });
    log('Lazy loading optimized for performance');
    
    // FIX #9: ENHANCED key-value targeting with contextual signals
    pubads.setTargeting('ua-script', 'v' + SCRIPT_VERSION);
    pubads.setTargeting('domain', window.location.hostname);
    pubads.setTargeting('page_url', window.location.pathname);
    pubads.setTargeting('has-ppid', 'true');
    pubads.setTargeting('ppid-type', config.ppid ? 'custom' : 'auto');
    pubads.setTargeting('side-rails', 
      (window.nasrevAds.slots.sideRails.left || window.nasrevAds.slots.sideRails.right) ? 'enabled' : 'disabled'
    );
    
    // Add referrer if available
    if (document.referrer) {
      try {
        const referrerHost = new URL(document.referrer).hostname;
        pubads.setTargeting('referrer', referrerHost);
      } catch (e) {
        // Invalid URL, skip
      }
    }
    
    if (privacy.gppString) {
      pubads.setTargeting('gpp', 'enabled');
    }
    
    log('Enhanced targeting configured with contextual signals');
    
    // FIX #4: Setup IMPROVED refresh listeners (start on render + viewability)
    setupAdRefreshListeners();
    
    // Remove placeholder on render
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
        size: event.size
      });
      
      // FIX #4: Start refresh timer immediately on render (if refresh enabled)
      if (!event.isEmpty && slot.customRefresh) {
        startRefreshTimer(slot);
      }
    });
    
    // Enable services
    googletag.enableServices();
    log('GPT services enabled');
  }

  // ==================== PHASE 5: AD REFRESH LOGIC (FIXED) ====================
  
  /**
   * FIX #4: Start refresh timer for a slot (checks viewability first)
   */
  function startRefreshTimer(slot) {
    const config = window.universalAdConfig || {};
    const refreshInterval = Math.max(config.refreshInterval || DEFAULT_REFRESH_INTERVAL, 30000);
    const slotId = slot.getSlotElementId();
    
    // Clear any existing timer
    if (window.nasrevAds.refreshTimers.has(slotId)) {
      clearTimeout(window.nasrevAds.refreshTimers.get(slotId));
    }
    
    log('Starting refresh timer for slot', { slotId: slotId, interval: refreshInterval + 'ms' });
    
    // Wait for refresh interval
    const timer = setTimeout(function() {
      // Check if slot is viewable before refreshing
      if (isSlotInViewport(slotId)) {
        log('Refreshing slot (viewable)', slotId);
        googletag.pubads().refresh([slot]);
        // Restart timer after refresh (creates continuous refresh cycle)
        startRefreshTimer(slot);
      } else {
        log('Slot not viewable, waiting for viewability', slotId);
        // Don't restart timer - will be restarted when slot becomes viewable
      }
    }, refreshInterval);
    
    window.nasrevAds.refreshTimers.set(slotId, timer);
  }

  /**
   * Setup IMPROVED viewability-based refresh listeners
   */
  function setupAdRefreshListeners() {
    const config = window.universalAdConfig || {};
    const refreshInterval = Math.max(config.refreshInterval || DEFAULT_REFRESH_INTERVAL, 30000);
    
    log('Setting up viewability-based ad refresh', { 
      interval: refreshInterval + 'ms (' + (refreshInterval/1000) + 's)',
      minViewableTime: MIN_VIEWABLE_TIME + 'ms',
      googleMinimum: '30s'
    });
    
    // FIX #4: Restart timer when slot becomes viewable (for below-fold ads)
    googletag.pubads().addEventListener('impressionViewable', function(event) {
      const slot = event.slot;
      
      // Skip if refresh not enabled for this slot
      if (!slot.customRefresh) {
        return;
      }
      
      const slotId = slot.getSlotElementId();
      
      log('Impression viewable - restarting refresh timer', slotId);
      
      // Restart refresh cycle (will check viewability before each refresh)
      startRefreshTimer(slot);
    });
    
    // Cleanup timers on page unload
    window.addEventListener('beforeunload', function() {
      window.nasrevAds.refreshTimers.forEach(function(timer) {
        clearTimeout(timer);
      });
    });
  }

  /**
   * Check if slot is in viewport (for refresh validation)
   */
  function isSlotInViewport(slotId) {
    const element = document.getElementById(slotId);
    if (!element) return false;
    
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;
    
    // Check if at least 50% of ad is visible (IAB/MRC standard)
    const verticalVisible = Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0);
    const horizontalVisible = Math.min(rect.right, windowWidth) - Math.max(rect.left, 0);
    const visibleArea = Math.max(0, verticalVisible) * Math.max(0, horizontalVisible);
    const totalArea = rect.height * rect.width;
    const visibilityRatio = totalArea > 0 ? visibleArea / totalArea : 0;
    
    return visibilityRatio >= 0.5; // 50% viewability threshold
  }

  // ==================== PHASE 6: DISPLAY ADS ====================
  
  /**
   * Display all defined ads
   */
  function displayAds() {
    log('Displaying ads');
    
    // Display in-page slots FIRST (before OOP slots per Google best practice)
    window.nasrevAds.slots.inPage.forEach(function(slot) {
      googletag.display(slot.getSlotElementId());
    });
    
    log('In-page slots displayed', window.nasrevAds.slots.inPage.length);
    
    // FIX #7: Display BOTH side rails separately
    const sideRails = window.nasrevAds.slots.sideRails;
    if (sideRails.left) {
      googletag.display(sideRails.left);
      log('Left side rail displayed');
    }
    if (sideRails.right) {
      googletag.display(sideRails.right);
      log('Right side rail displayed');
    }
    
    // FIX #10: Display interstitial explicitly
    if (window.nasrevAds.slots.interstitial) {
      googletag.display(window.nasrevAds.slots.interstitial);
      log('Interstitial displayed');
    }
    
    // Display other OOP slots (anchor)
    window.nasrevAds.slots.oop.forEach(function(slot) {
      // Skip side rails and interstitial as they're already displayed above
      if (slot !== sideRails.left && slot !== sideRails.right && slot !== window.nasrevAds.slots.interstitial) {
        googletag.display(slot);
      }
    });
    
    log('All ads displayed', {
      inPage: window.nasrevAds.slots.inPage.length,
      oop: window.nasrevAds.slots.oop.length,
      sideRails: {
        left: !!sideRails.left,
        right: !!sideRails.right
      },
      interstitial: !!window.nasrevAds.slots.interstitial
    });
  }

  // ==================== ENTRY POINT ====================
  
  /**
   * Main initialization
   */
  function init() {
    try {
      log('Script loaded', { 
        version: SCRIPT_VERSION, 
        url: window.location.href,
        userAgent: navigator.userAgent
      });
      
      // Wait for DOM to be ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', detectConsent);
      } else {
        detectConsent();
      }
      
    } catch (error) {
      logError('Initialization error', error);
    }
  }

  // Start the script
  init();

})();
