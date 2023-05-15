/*
This script is run during the loading of a webpage.
It pulls all the required node apis for the menu
without injecting them into external websites,
this is done for obvious security benefits.
*/

const remote = require('@electron/remote');

global.ipc = require('electron').ipcRenderer;

// Prevent Injecting To Another Websites
if (window.location.protocol === 'file:') {
  global.services = remote.getGlobal('services');
}

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }
  // Show version numbers of bundled Electron.
  for (const dependency of ['electron', 'chrome', 'node', 'v8']) {
    replaceText(`${dependency}-version`, process.versions[dependency])
  }
});
