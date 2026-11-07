import { init, getStorageItem, setStorageItem, updateTabTotalCount } from './scripts.js';

let isInitialized = false;

async function reinitializeExtension() {
  try {
    console.log('Reinitializing extension...');
    isInitialized = false;
    await init();
    await updateTabTotalCount();
    isInitialized = true;
  } catch (error) {
    console.error('Failed to reinitialize extension:', error);
    isInitialized = false;
  }
}

async function ping() {
  try {
    const timestamp = Date.now();
    const lastPingTime = await getStorageItem('lastPing');
    const timeSinceLastPing = timestamp - lastPingTime;

    // If more than 2 minutes passed between pings, system likely slept
    if (timeSinceLastPing > 120000 || !isInitialized) {
      console.log('System wake or uninitialized state detected, time since last ping:', Math.round(timeSinceLastPing/1000), 'seconds');
      await reinitializeExtension();
    }
    
    await setStorageItem('lastPing', timestamp);
    console.log('Service worker ping:', new Date(timestamp).toLocaleTimeString(), `(${Math.floor(timestamp/1000)}s)`);

    // Verify tab count is accurate
    await updateTabTotalCount();
  } catch (error) {
    console.error('Ping failed:', error);
    isInitialized = false;
  }
}

async function setupAlarms() {
  try {
    await chrome.alarms.clearAll();
    
    chrome.alarms.create('keepAlive', {
      periodInMinutes: 0.5,
      delayInMinutes: 0  // Start immediately
    });
    
    chrome.alarms.create('verifyCount', {
      periodInMinutes: 1,
      delayInMinutes: 0
    });
    
    await ping();
  } catch (error) {
    console.error('Failed to setup alarms:', error);
  }
}

// Listen for alarm events
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'keepAlive') {
    await ping();
  } else if (alarm.name === 'verifyCount') {
    await updateTabTotalCount();
  }
});

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await reinitializeExtension();
    await setupAlarms();
  } catch (error) {
    console.error('Failed to initialize on install:', error);
  }
});

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  try {
    console.log('Service worker startup');
    await reinitializeExtension();
    await setupAlarms();
  } catch (error) {
    console.error('Failed to initialize on startup:', error);
  }
});

// Handle system suspend/resume
chrome.runtime.onSuspend.addListener(() => {
  console.log('Service worker suspended');
  isInitialized = false;
});

// Reinitialize when receiving a connection
chrome.runtime.onConnect.addListener((port) => {
  try {
    console.log('Service worker connected');
    reinitializeExtension();
    setupAlarms();
    
    port.onDisconnect.addListener(() => {
      try {
        console.log('Service worker disconnected');
        reinitializeExtension();
      } catch (error) {
        console.error('Failed to reinitialize on port disconnect:', error);
      }
    });
  } catch (error) {
    console.error('Failed to handle connection:', error);
  }
});