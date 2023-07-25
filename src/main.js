// Modules to control application life and create native browser window
const fs = require('fs'),
  path = require('path'),
  { app, session, components, BrowserWindow, nativeTheme, Menu, ipcMain, dialog } = require('electron'),
  contextMenu = require('electron-context-menu'),
  electronLog = require('electron-log'),
  Store = require('electron-store'),
  {
    ElectronBlocker,
    fullLists,
    Request
  } = require('@cliqz/adblocker-electron'),
  fetch = require('node-fetch');

// contextBridge = require('electron').contextBridge,

// Load in the header script for frameless window
const headerScript = fs.readFileSync(
  path.join(__dirname, 'client-header.js'),
  'utf8'
);

// Initialize Electron remote module
require('@electron/remote/main').initialize();

// Create Global Varibles
let mainWindow; // Global Windows Object
let mainActivated; // Global activate? Object
const menu = require('./menu');
const store = new Store();

// Floating UA variable
let defaultUserAgent;

// Needed for electron-context-menu
try {
  require('electron-reloader')(module);
} catch { /* empty */ }

// Export app version from package.json
var appVersion = app.getVersion();

// Globally export whether we are on Windows or not
const isWin = process.platform === 'win32';

async function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: 'Quark Player',
    resizable: true,
    maximizable: true,
    width: isWin ? 1032 : 1024,
    height: isWin ? 776 : 768,
    icon: isWin ? path.join(__dirname, 'icon.ico') : path.join(__dirname, 'icon64.png'),
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
    },
    trafficLightPosition: {
      x: 16,
      y: 16,
    },
    // Window Styling
    transparent: isWin ? false : true,
    autoHideMenuBar: false,
    darkTheme: store.get('options.useLightMode') ? false : true,
    vibrancy: store.get('options.useLightMode') ? 'light' : 'ultra-dark',
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

  // Connect Adblocker to Window if enabled
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

    // Backup the Engine cache to disk
    fs.writeFile(engineCachePath, engine.serialize(), err => {
      if (err) throw err;
      electronLog.info('Adblock engine file cache has been updated!');
    });
  }

  // Reset the Window's size and location
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

  // Detect and update config on null version
  if (!store.get('version')) {
    store.set('version', app.getVersion());
    store.set('services', []);
    electronLog.info('Initialized Configuration');
  }

  // Load the services and merge the user's with default services
  let userServices = store.get('services') || [];
  global.services = userServices;

  require('./default-services').forEach(dservice => {
    let service = userServices.find(service => service.name == dservice.name);
    if (service) {
      // Enumerate service properties from default-services.js
      global.services[userServices.indexOf(service)] = {
        name: service.name ? service.name : dservice.name,
        title: service.title ? service.title : dservice.title,
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

  if (store.get('options.useLightMode')) {
    nativeTheme.themeSource = 'light';
  } else {
    nativeTheme.themeSource = 'dark';
  }

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
  mainWindow.webContents.on('dom-ready', browserWindowDomReady);

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

contextMenu({
   // Chromium context menu defaults
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
   { label: 'Open Video in New Window',
      // Only show it when right-clicking video
      visible: parameters.mediaType === 'video',
      click: (linkURL) => {
          const newWin = new BrowserWindow({
            title: 'New Window',
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
            },
            darkTheme: store.get('options.useLightMode') ? false : true,
            vibrancy: store.get('options.useLightMode') ? 'light' : 'ultra-dark',
          });
          const vidURL = parameters.srcURL;
       newWin.loadURL(vidURL);
      }
   },
   { label: 'Open Link in New Window',
      // Only show it when right-clicking a link
      visible: parameters.linkURL.trim().length > 0,
      click: (linkURL) => {
          const newWin = new BrowserWindow({
            title: 'New Window',
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
            },
            darkTheme: store.get('options.useLightMode') ? false : true,
            vibrancy: store.get('options.useLightMode') ? 'light' : 'ultra-dark',
          });
          const toURL = parameters.linkURL;
       newWin.loadURL(toURL);
      }
   }]
});

// This method is called when the browser window's dom is ready
// it is used to inject the header if pictureInPicture mode and
// hideWindowFrame are enabled.
function browserWindowDomReady() {
  if (
    store.get('options.pictureInPicture') || store.get('options.hideWindowFrame')
  ) {
    // TODO: This is a temp fix and a propper fix should be developed
    if (mainWindow != null) {
      mainWindow.webContents.executeJavaScript(headerScript);
    }
  }
}

// Run when window is closed. This cleans up the mainWindow object to save resources.
function mainWindowClosed() {
  mainActivated = null;
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  // Initialize Widevine
  await components.whenReady();
  console.log('WidevineCDM component ready.\n Info:', components.status(), '\n');

  // Show version
  electronLog.info(`Quark Player v` + appVersion);
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
  'enable-features','CanvasOopRasterization,CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL,VaapiVideoDecoder,VaapiVideoEncoder,VaapiIgnoreDriverChecks',
  );
  app.commandLine.appendSwitch('disable-features','UseChromeOSDirectVideoDecoder',);
  //app.commandLine.appendSwitch('use-gl','desktop');
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
  electronLog.info('Relaunching Quark Player...');
  // Store details to remeber when relaunched
  if (mainWindow.getURL() != '') {
    store.set('relaunch.toPage', mainWindow.getURL());
  }
  store.set('relaunch.windowDetails', {
    position: mainWindow.getPosition(),
    size: mainWindow.getSize()
  });

  // Destory the BrowserWindow
  mainWindow.webContents.removeListener('dom-ready', browserWindowDomReady);

  // Remove app Close listener
  mainWindow.removeListener('closed', mainWindowClosed);

  // Close App
  mainWindow.close();
  mainWindow = undefined;

  // Create a New BrowserWindow
  electronLog.info('App relaunched! [ Loading main.js ]');
  createWindow();
});

// Full restart, quitting Electron. Triggered by developer menu
app.on('restart', () => {
  // Tell app we are going to relaunch
  app.relaunch();
  // Kill Electron to initiate the relaunch
  app.quit();

  // Ensure new BrowserWindow is created
  // Store details to remeber when relaunched
  if (mainWindow.getURL() != '') {
    store.set('relaunch.toPage', mainWindow.getURL());
  }
  store.set('relaunch.windowDetails', {
    position: mainWindow.getPosition(),
    size: mainWindow.getSize()
  });

  // Destory the BrowserWindow
  mainWindow.webContents.removeListener('dom-ready', browserWindowDomReady);

  // Remove app Close listener
  mainWindow.removeListener('closed', mainWindowClosed);

  // Close App
  mainWindow.close();
  mainWindow = undefined;

  // Create a New BrowserWindow
  electronLog.info('Electron restarted! [ Loading main.js ]');
  createWindow();
});

// Fix bug in quitting after restarting
app.on('exit', () => {
  // Close App
  mainWindow.close();
  mainWindow = null;
  // Kill Electron
  app.quit();
});

// Dialog box asking if user really wants to relaunch app
// Emitted from certain menu items that require an Electron restart
app.on('relaunch-confirm', () => {
    dialog.showMessageBox(mainWindow, {
        'type': 'question',
        'title': 'Relaunch Confirmation',
        'message': "Are you sure you want to relaunch Quark Player?",
        'buttons': [
            'Yes',
            'No'
        ]
    })
      // Dialog returns a promise so let's handle it correctly
      .then((result) => {
          // Bail if the user pressed "No" or escaped (ESC) from the dialog box
          if (result.response !== 0) { return; }
          // Testing.
          if (result.response === 0) {
              //console.log('The "Yes" button was pressed (main process)');
              //app.relaunch();
              //app.quit();
              app.emit('relaunch');
          }
      })
})

// Same as the above except used when resetting settings
app.on('reset-confirm', () => {
    dialog.showMessageBox(mainWindow, {
        'type': 'question',
        'title': 'Settings Reset Confirmation',
        'message': "Are you sure you want to reset *all* \nsettings to their defaults?",
        'buttons': [
            'Yes',
            'No'
        ]
    })
      // Dialog returns a promise so let's handle it correctly
      .then((result) => {
          // Bail if the user pressed "No" or escaped (ESC) from the dialog box
          if (result.response !== 0) { return; }
          // Testing.
          if (result.response === 0) {
              //console.log('The "Yes" button was pressed (main process)');
              app.relaunch();
              app.quit();
              app.emit('relaunch');
              electronLog.warn('Note: Reset All Settings!');
          }
      })
})

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
  if (mainActivated === null) {
    electronLog.info('Electron restarted! [ Loading main.js ]');
    createWindow();
  }
});

// Allow creating new instance with Ctrl+N
app.on('new-window', () => {
  createWindow();
  electronLog.info('Created new BrowserWindow');
  mainWindow.webContents.on('did-finish-load',() => {
      mainWindow.setTitle(`Quark Player (New Instance)`);
  });
});

// Called on disallowed remote API below
function rejectEvent(event) {
  event.preventDefault();
}

// Sets services for preload script
const allowedGlobals = new Set(['services']);
app.on('remote-get-global', (event, webContents, globalName) => {
  if (!allowedGlobals.has(globalName)) {
    event.preventDefault();
  }
});

/* Restrict certain Electron APIs in the renderer process for security */
app.on('remote-require', rejectEvent);
//app.on('remote-get-builtin', rejectEvent);
app.on('remote-get-current-window', rejectEvent);
app.on('remote-get-current-web-contents', rejectEvent);
app.on('remote-get-guest-web-contents', rejectEvent);
