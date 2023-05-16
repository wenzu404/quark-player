// Modules to control application life and create native browser window
const fs = require('fs'),
  path = require('path'),
  { app, session, components, BrowserWindow, Menu, ipcMain, dialog } = require('electron'),
  contextBridge = require('electron').contextBridge,
  contextMenu = require('electron-context-menu'),
  electronLog = require('electron-log'),
  Store = require('electron-store'),
  {
    ElectronBlocker,
    fullLists,
    Request
  } = require('@cliqz/adblocker-electron'),
  fetch = require('node-fetch');

const headerScript = fs.readFileSync(
  path.join(__dirname, 'client-header.js'),
  'utf8'
);

// Initialize Electron remote module
require('@electron/remote/main').initialize();

// Create Global Varibles
let mainWindow; // Global Windows Object
const menu = require('./menu');
const store = new Store();

// Floating UA variable
let defaultUserAgent;

// Needed for electron-context-menu
try {
  require('electron-reloader')(module);
} catch {}

async function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: 'Quark Player',
    resizable: true,
    maximizable: true,
    width: 1024,
    height: 768,
    icon: path.join(__dirname, 'icon64.png'),
    webPreferences: {
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      // Must be disabled for preload script. I am not aware of a workaround but this *shouldn't* effect security
      contextIsolation: false,
      sandbox: false,
      experimentalFeatures: true,
      webviewTag: true,
      devTools: true,
      javascript: true,
      plugins: true,
      enableRemoteModule: true,
      preload: path.join(__dirname, 'client-preload.js'),
      nativeWindowOpen: true
    },
    trafficLightPosition: {
      x: 16,
      y: 16,
    },
    // Window Styling
    // @ts-ignore
    transparent: process.platform === 'win32' ? false : true,
    autoHideMenuBar: false,
    darkTheme: true,
    vibrancy: 'ultra-dark',
    frame: store.get('options.pictureInPicture')
      ? false
      : !store.get('options.hideWindowFrame'),
    alwaysOnTop: store.get('options.alwaysOnTop'),
    backgroundColor: '#00000000',
    fullscreen: store.get('options.launchFullscreen'),
    toolbar: true
  });
  require("@electron/remote/main").enable(mainWindow.webContents);
  //mainWindow.setTitle(require('./package.json').appName);

  defaultUserAgent = mainWindow.webContents.userAgent;

  // Connect Adblocker To Window if Enabled
  if (store.get('options.adblock')) {
    let engineCachePath = path.join(
      app.getPath('userData'),
      'adblock-engine-cache.txt'
    );

    if (fs.existsSync(engineCachePath)) {
      electronLog.info('Adblock engine cache found. Loading it into main process...');
      var engine = await ElectronBlocker.deserialize(
        fs.readFileSync(engineCachePath)
      );
    } else {
      var engine = await ElectronBlocker.fromLists(fetch, fullLists);
    }
    engine.enableBlockingInSession(session.defaultSession);

    // Backup Engine Cache to Disk
    fs.writeFile(engineCachePath, engine.serialize(), err => {
      if (err) throw err;
      electronLog.info('Adblock engine file cache has been updated!');
    });
  }

  // Reset The Windows Size and Location
  let windowDetails = store.get('options.windowDetails');
  let relaunchWindowDetails = store.get('relaunch.windowDetails');
  if (relaunchWindowDetails) {
    mainWindow.setSize(
      relaunchWindowDetails.size[0],
      relaunchWindowDetails.size[1]
    );
    mainWindow.setPosition(
      relaunchWindowDetails.position[0],
      relaunchWindowDetails.position[1]
    );
    store.delete('relaunch.windowDetails');
  } else if (windowDetails) {
    mainWindow.setSize(windowDetails.size[0], windowDetails.size[1]);
    mainWindow.setPosition(
      windowDetails.position[0],
      windowDetails.position[1]
    );
  }

  // Configire Picture In Picture
  if (store.get('options.pictureInPicture') && process.platform === 'darwin') {
    app.dock.hide();
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setVisibleOnAllWorkspaces(true);
    mainWindow.setFullScreenable(false);
    app.dock.show();
  }

  // Detect and update version
  if (!store.get('version')) {
    store.set('version', app.getVersion());
    store.set('services', []);
    electronLog.info('Initialized Configuration');
  }

  // Load the services and merge the users and default services
  let userServices = store.get('services') || [];
  global.services = userServices;

  require('./default-services').forEach(dservice => {
    let service = userServices.find(service => service.name == dservice.name);
    if (service) {
      global.services[userServices.indexOf(service)] = {
        name: service.name ? service.name : dservice.name,
        logo: service.logo ? service.logo : dservice.logo,
        url: service.url ? service.url : dservice.url,
        color: service.color ? service.color : dservice.color,
        style: service.style ? service.style : dservice.style,
        userAgent: service.userAgent ? service.userAgent : dservice.userAgent,
        permissions: service.permissions
          ? service.permissions
          : dservice.permissions,
        hidden: service.hidden != undefined ? service.hidden : dservice.hidden,
      };
    } else {
      dservice._defaultService = true;
      global.services.push(dservice);
    }
  });

  // Create The Menubar
  Menu.setApplicationMenu(menu(store, global.services, mainWindow, app, defaultUserAgent));

  // Load the UI or the Default Service
  let defaultService = store.get('options.defaultService'),
    lastOpenedPage = store.get('options.lastOpenedPage'),
    relaunchToPage = store.get('relaunch.toPage');

  if (relaunchToPage !== undefined) {
    electronLog.info('Relaunching page: ' + relaunchToPage);
    mainWindow.loadURL(relaunchToPage);
    store.delete('relaunch.toPage');
  } else if (defaultService == 'lastOpenedPage' && lastOpenedPage) {
    electronLog.info('Loading the last opened page: ' + lastOpenedPage);
    mainWindow.loadURL(lastOpenedPage);
  } else if (defaultService != undefined) {
    defaultService = global.services.find(
      service => service.name == defaultService
    );
    if (defaultService.url) {
      electronLog.info('Loading the default service: ' + defaultService.url);
      mainWindow.loadURL(defaultService.url);
      mainWindow.webContents.userAgent = defaultService.userAgent ? defaultService.userAgent : defaultUserAgent;
    } else {
      electronLog.warn(
        "Error: Default service does not have a URL set. Falling back to main menu."
      );
      mainWindow.loadFile('./ui/index.html');
    }
  } else {
    electronLog.info('Loading main menu');
    mainWindow.loadFile('./ui/index.html');
  }

  contextMenu({
     showSaveImageAs: true,
     showSelectAll: true,
     showCopyImage: true,
     showCopyImageAddress: true,
     showSaveImageAs: true,
     showCopyVideoAddress: true,
     showSaveVideoAs: true,
     showCopyLink: true,
     showSaveLinkAs: true,
     showInspectElement: true,
     showLookUpSelection: true,
     showSearchWithGoogle: true,
     prepend: (defaultActions, parameters, browserWindow) => [
        {    label: 'Open Video in New Window',
        // Only show it when right-clicking video
        visible: parameters.mediaType === 'video',
        click: (linkURL) => {
            const newwin = new BrowserWindow({
              width: 1024,
              height: 768,
              webPreferences: {
                nodeIntegration: false,
                nodeIntegrationInWorker: false,
                contextIsolation: false,
                sandbox: false,
                experimentalFeatures: true,
                webviewTag: true,
                devTools: true,
                javascript: true,
                plugins: true,
                enableRemoteModule: true,
                nativeWindowOpen: true
              },
            });
            const vidURL = parameters.srcURL;
         newwin.loadURL(vidURL);
        }
     }],
     prepend: (defaultActions, parameters, browserWindow) => [
        {    label: 'Open Link in New Window',
        visible: parameters.linkURL.trim().length > 0,
        click: (linkURL) => {
            const newwin = new BrowserWindow({
              width: 1024,
              height: 768,
              webPreferences: {
                nodeIntegration: false,
                nodeIntegrationInWorker: false,
                contextIsolation: false,
                sandbox: false,
                experimentalFeatures: true,
                webviewTag: true,
                devTools: true,
                javascript: true,
                plugins: true,
                enableRemoteModule: true,
                nativeWindowOpen: true
              },
            });
            const toURL = parameters.linkURL;
         newwin.loadURL(toURL);
        }
     }]
  });

  // Emitted when the window is closing
  mainWindow.on('close', e => {
    // Save open service if lastOpenedPage is the default service
    if (store.get('options.defaultService') == 'lastOpenedPage') {
      store.set('options.lastOpenedPage', mainWindow.getURL());
    }

    // If enabled store the window details so they can be restored upon restart
    if (store.get('options.windowDetails')) {
      if (mainWindow) {
        store.set('options.windowDetails', {
          position: mainWindow.getPosition(),
          size: mainWindow.getSize()
        });
      } else {
        console.error(
          'Error window was not defined while trying to save windowDetails'
        );
        return;
      }
    }
  });

  // Inject Header Script On Page Load If In Frameless Window
  mainWindow.webContents.on('dom-ready', broswerWindowDomReady);

  // Emitted when the window is closed.
  mainWindow.on('closed', mainWindowClosed);

  // Emitted when website requests permissions - Electron default allows any permission this restricts websites
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      let websiteOrigin = new URL(webContents.getURL()).origin;
      let service = global.services.find(
        service => new URL(service.url).origin == websiteOrigin
      );

      if (
        (service &&
          service.permissions &&
          service.permissions.includes(permission)) ||
        permission == 'fullscreen'
      ) {
        electronLog.info(
          `Note: Allowed requested browser permission '${permission}' for site: '${websiteOrigin}'`
        );
        return callback(true);
      }

      electronLog.warn(
        `Note: Rejected requested browser permission '${permission}' for site: '${websiteOrigin}'`
      );
      return callback(false);
    }
  );
}

// This method is called when the broswer window's dom is ready
// it is used to inject the header if pictureInPicture mode and
// hideWindowFrame are enabled.
function broswerWindowDomReady() {
  if (
    store.get('options.pictureInPicture') ||
    store.get('options.hideWindowFrame')
  ) {
    // TODO: This is a temp fix and a propper fix should be developed
    if (mainWindow != null) {
      mainWindow.webContents.executeJavaScript(headerScript);
    }
  }
}

// Run when window is closed. This cleans up the mainWindow object to save resources.
function mainWindowClosed() {
  mainWindow = null;
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  await components.whenReady();
  console.log('WidevineCDM component ready!\n Info:', components.status());
  // The timeout fixes the trasparent background on Linux ???? why
  //setTimeout(createWindow, 500);
  createWindow();
});

//app.commandLine.appendSwitch('no-sandbox');
// Enable experimental web features
//app.commandLine.appendSwitch('enable-experimental-web-platform-features');
// Including new Canvas2D APIs
app.commandLine.appendSwitch('new-canvas-2d-api');
// These two allow easier local web development
// Allow file:// URIs to read other file:// URIs
app.commandLine.appendSwitch('allow-file-access-from-files');
// Enable local DOM to access all resources in a tree
app.commandLine.appendSwitch('enable-local-file-accesses');
// Enable QUIC for faster handshakes
app.commandLine.appendSwitch('enable-quic');
// Enable inspecting ALL layers
app.commandLine.appendSwitch('enable-ui-devtools');
// Force enable GPU acceleration
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Force enable GPU rasterization
app.commandLine.appendSwitch('enable-gpu-rasterization');
// Enable Zero Copy for GPU memory associated with Tiles
app.commandLine.appendSwitch('enable-zero-copy');
// Inform GPU process that GPU context will not be lost in power saving modes
// Useful for fixing blank or pink screens/videos upon system resume, etc
app.commandLine.appendSwitch('gpu-no-context-lost');
// Enable all WebGL Features
app.commandLine.appendSwitch('enable-webgl-draft-extensions');
// Transparent overlays for Promethium UI
app.commandLine.appendSwitch('enable-transparent-visuals');

// Enable native CPU-mappable GPU memory buffer support on Linux
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
}

// Enable useful features
if (process.platform === 'linux') {
  app.commandLine.appendSwitch(
  'enable-features','CanvasOopRasterization,CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL,VaapiVideoDecoder,VaapiVideoEncoder',
  );
}
// VAAPI is only applicable on linux so copy above without vaapi flags
if (process.platform === 'win32' || process.platform === 'darwin') {
  app.commandLine.appendSwitch(
  'enable-features','CanvasOopRasterization,CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL',
  );
}

if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

// This is a custom event that is used to relaunch the application.
// It destroys and recreates the browser window. This is used to apply
// settings that Electron doesn't allow to be changed in an active
// browser window.
app.on('relaunch', () => {

  // Store details to remeber when relaunched
  if (mainWindow.getURL() != '') {
    store.set('relaunch.toPage', mainWindow.getURL());
  }
  store.set('relaunch.windowDetails', {
    position: mainWindow.getPosition(),
    size: mainWindow.getSize()
  });

  // Destory The BroswerWindow
  mainWindow.webContents.removeListener('dom-ready', broswerWindowDomReady);

  // Remove App Close Listener
  mainWindow.removeListener('closed', mainWindowClosed);

  // Close App
  mainWindow.close();
  mainWindow = undefined;

  // Create a New BroswerWindow
  createWindow();
  console.log('Electron restarted! [ Loading main.js ]');
});

// Chnage the windows url when told to by the ui
ipcMain.on('open-url', (e, service) => {
  electronLog.info('Opening service: ' + service.name);
  mainWindow.webContents.userAgent = service.userAgent ? service.userAgent : defaultUserAgent;
  mainWindow.loadURL(service.url);
});

// Disable fullscreen when button pressed
ipcMain.on('exit-fullscreen', e => {
  if (store.get('options.pictureInPicture')) {
    store.delete('options.pictureInPicture');
  } else if (store.get('options.hideWindowFrame')) {
    store.delete('options.hideWindowFrame');
  }

  // Relaunch
  app.emit('relaunch');
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS it's common to re-create a window in the app when the
// dock icon is clicked and there are no other windows open.
app.on('activate', () => {
  if (mainWindow === null) {
    electronLog.info('Electron restarted! [ Loading main.js ]');
    createWindow();
  }
});

/* Restrict Electrons APIs In Renderer Process For Security */

function rejectEvent(event) {
  event.preventDefault();
}

const allowedGlobals = new Set(['services']);
app.on('remote-get-global', (event, webContents, globalName) => {
  if (!allowedGlobals.has(globalName)) {
    event.preventDefault();
  }
});
app.on('remote-require', rejectEvent);
app.on('remote-get-builtin', rejectEvent);
app.on('remote-get-current-window', rejectEvent);
app.on('remote-get-current-web-contents', rejectEvent);
app.on('remote-get-guest-web-contents', rejectEvent);
