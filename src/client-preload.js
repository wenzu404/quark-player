/*
This script is run during the loading of a webpage.
It pulls all the required node apis for the menu
without injecting them into external websites,
this is done for obvious security benefits.

It also dynamically gets versions of stuff
to inject into the about page.
*/

// const { electron } = require('electron');
const remote = require('@electron/remote');
global.ipc = require('electron').ipcRenderer;

// Prevent Injecting To Another Websites
if (window.location.protocol === 'file:') {
  global.services = remote.getGlobal('services');
}

// Show version numbers of bundled Electron.
window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }
  for (const dependency of ['electron', 'chrome', 'node', 'v8']) {
    replaceText(`${dependency}-version`, process.versions[dependency])
  }
});

// Get app version from package.json
var appVersion = remote.app.getVersion();

// Show app version in about.html
window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }
  replaceText(`quark-version`, appVersion)
});
