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
