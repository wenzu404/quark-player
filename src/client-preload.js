/*
This script is run during the loading of a webpage.
It pulls all the required node apis for the menu
without injecting them into external websites,
this is done for obvious security benefits.

It also dynamically gets versions of stuff
to inject into the about page.
*/

const Os = require('os');
const remote = require('@electron/remote');
global.ipc = require('electron').ipcRenderer;

// Globally export what OS we are on
const isLinux = process.platform === 'linux';
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// Prevent Injecting To Another Websites
if (window.location.protocol === 'file:') {
  global.services = remote.getGlobal('services');
}

// Show version numbers of bundled Electron.
window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text
  };
  for (const dependency of ['electron', 'chrome', 'node', 'v8']) {
    replaceText(`${dependency}-version`, process.versions[dependency]);
  }
  replaceText('electron2-version', process.versions.electron);
});

// Get app version from package.json
const appVersion = remote.app.getVersion();

let osType;
if (isLinux) {
  osType = 'Linux';
} else if (isWin) {
  osType = 'Win';
} else if (isMac) {
  osType = 'MacOS';
} else {
  osType = 'BSD';
}
const archType = Os.arch();

// Show app version in about.html
window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text
  };
  replaceText('quark-version', appVersion);
  replaceText('os-type', osType);
  replaceText('arch-type', archType);
});

// Spoof a modern user agent for Netflix to bypass E109 checks
const netflixUA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

if (location.hostname.endsWith('netflix.com')) {
  try {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => netflixUA
    });

    if ('userAgentData' in navigator) {
      const uaData = {
        brands: [
          { brand: 'Chromium', version: '126' },
          { brand: 'Not:A-Brand', version: '99' }
        ],
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: async hints => {
          const high = {};
          if (hints.includes('architecture')) high.architecture = 'x86';
          if (hints.includes('bitness')) high.bitness = '64';
          if (hints.includes('model')) high.model = '';
          if (hints.includes('platformVersion')) high.platformVersion = '15.0.0';
          if (hints.includes('fullVersion')) high.fullVersion = '126.0.0.0';
          return high;
        }
      };

      Object.defineProperty(navigator, 'userAgentData', {
        get: () => uaData
      });
    }
  } catch (e) {
    console.error('Failed to spoof Netflix user agent', e);
  }
}
