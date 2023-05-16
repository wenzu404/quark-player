/*
This script is run during the loading of a webpage.
It pulls all the required node apis for the menu
without injecting them into external websites,
this is done for obvious security benefits.
*/

//const { app } = require('electron');

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
//var appVersion = remote.app.getVersion();

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }
  // Show app version in about.html
  replaceText(`quark-version`, `3.1.3`)
});
