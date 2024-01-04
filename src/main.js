// Modules to control application life and create native browser window
const fs = require('fs');
const path = require('path');
const { app, session, components, BrowserWindow, nativeTheme, Menu, ipcMain, dialog } = require('electron');
const contextMenu = require('electron-context-menu');
const electronLog = require('electron-log');
const Store = require('electron-store');
const { ElectronBlocker, fullLists, Request } = require('@cliqz/adblocker-electron');
const fetch = require('node-fetch');

// contextBridge = require('electron').contextBridge,

// Load in the header script for frameless window
const headerScript = fs.readFileSync(
  path.join(__dirname, 'client-header.js'),
  'utf8'
);

// Initialize Electron remote module
require('@electron/remote/main').initialize();

// Restrict main.log size to 100Kb
electronLog.transports.file.maxSize = 1024 * 100;

// Create Global Varibles
let mainWindow; // Global Window Object
let newWindow; // Global New Window Object
let helpWindow; // Global Help Window Object
 // Global activate? Objects
let mainActivated;
let mainNewActivated;
const argsCmd = process.argv; // Global cmdline object.
// const argsCmd2 = process.argv[2]; // (2nd) Global cmdline object.
const menu = require('./menu.js');
const store = new Store();
const userDataDir = app.getPath('userData');

// Floating UA variable
let defaultUserAgent;

// Needed for electron-context-menu
try {
  require('electron-reloader')(module);
} catch { /* empty */ }

// Get app details from package.json
const appName = app.getName();
const appVersion = app.getVersion();
// Export Electron versions
const electronVer = process.versions.electron;
const chromeVer = process.versions.chrome;
const nodeVer = process.versions.node;
const v8Ver = process.versions.v8;

// Globally export what OS we are on
const isLinux = process.platform === 'linux';
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

async function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: 'Quark Player',
    resizable: true,
    maximizable: true,
    width: 1024,
    height: 768,
    useContentSize: true,
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
      preload: path.join(__dirname, 'client-preload.js')
    },
    trafficLightPosition: {
      x: 16,
      y: 16
    },
    // Window Styling
    transparent: isLinux ? true : false,
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
  require('@electron/remote/main').enable(mainWindow.webContents);

  defaultUserAgent = mainWindow.webContents.userAgent;

  // Connect Adblocker to Window if enabled
  if (store.get('options.adblock')) {
    const engineCachePath = path.join(userDataDir, 'adblock-engine-cache.txt');
    // Only load cache if there is no version mismatch
    if (fs.existsSync(engineCachePath) && (store.get('version') === '3.2.8')) {
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
  const windowDetails = store.get('options.windowDetails');
  const relaunchWindowDetails = store.get('relaunch.windowDetails');
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
    mainWindow.setSize(
      windowDetails.size[0],
      windowDetails.size[1]
    );
    mainWindow.setPosition(
      windowDetails.position[0],
      windowDetails.position[1]
    );
  }

  // Configire Picture In Picture
  if (store.get('options.pictureInPicture') && isMac) {
    app.dock.hide();
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setVisibleOnAllWorkspaces(true);
    mainWindow.setFullScreenable(false);
    app.dock.show();
  }

  // Detect and update config on null version
  if (!store.get('version')) {
    store.set('version', appVersion);
    store.set('services', []);
    electronLog.info('Initialized Configuration');
  } else {
    store.set('version', appVersion);
  }

  // Load the services and merge the user's with default services
  const userServices = store.get('services') || [];
  global.services = userServices;

  require('./default-services').forEach(dservice => {
    const service = userServices.find(service => service.name === dservice.name);
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
        hidden: service.hidden !== undefined ? service.hidden : dservice.hidden
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
  let defaultService = store.get('options.defaultService');
  const lastOpenedPage = store.get('options.lastOpenedPage');
  const relaunchToPage = store.get('relaunch.toPage');

  if (relaunchToPage !== undefined) {
    electronLog.info('Relaunching page: ' + relaunchToPage);
    mainWindow.loadURL(relaunchToPage);
    store.delete('relaunch.toPage');
  } else if (defaultService === 'lastOpenedPage' && lastOpenedPage) {
    electronLog.info('Loading the last opened page: ' + lastOpenedPage);
    mainWindow.loadURL(lastOpenedPage);
  } else if (defaultService !== undefined) {
    defaultService = global.services.find(
      service => service.name === defaultService
    );
    if (defaultService.url) {
      electronLog.info('Loading the default service: ' + defaultService.url);
      mainWindow.loadURL(defaultService.url);
      mainWindow.webContents.userAgent = defaultService.userAgent ? defaultService.userAgent : defaultUserAgent;
    } else {
      electronLog.warn('Error: Default service does not have a URL set. Falling back to main menu.');
      mainWindow.loadFile('./ui/index.html');
    }
  } else {
    electronLog.info('Loading main menu');
    mainWindow.loadFile('./ui/index.html');
  }

  // Emitted when the window is closing
  mainWindow.on('close', () => {
    // Save open service if lastOpenedPage is the default service
    if (store.get('options.defaultService') === 'lastOpenedPage') {
      store.set('options.lastOpenedPage', mainWindow.getURL());
    }

    // If enabled store the window details so they can be restored upon restart
    if (store.get('options.windowDetails')) {
      if (mainWindow) {
        store.set('options.windowDetails', {
          position: mainWindow.getPosition(),
          size: mainWindow.getSize()
        });
        electronLog.info('Saved windowDetails.');
      } else {
        electronLog.error('Error: Window was not defined while trying to save windowDetails.');
        return;
      }
    }
    electronLog.info('mainWindow.close()');
  });

  // Inject Header Script On Page Load If In Frameless Window
  mainWindow.webContents.on('dom-ready', browserWindowDomReady);

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    mainWindowClosed();
  });

  // Emitted when website requests permissions - Electron default allows any permission this restricts websites
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const websiteOrigin = new URL(webContents.getURL()).origin;
      const service = global.services.find(
        service => new URL(service.url).origin === websiteOrigin
      );

      if (
        (service &&
          service.permissions &&
          service.permissions.includes(permission)) ||
        permission === 'fullscreen'
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

async function createNewWindow() {
  // Create the browser window.
  newWindow = new BrowserWindow({
    title: 'Quark Player (New Instance)',
    resizable: true,
    maximizable: true,
    width: 1024,
    height: 768,
    useContentSize: true,
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
      preload: path.join(__dirname, 'client-preload.js')
    },
    trafficLightPosition: {
      x: 16,
      y: 16
    },
    // Window Styling
    transparent: isLinux ? true : false,
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
  require('@electron/remote/main').enable(newWindow.webContents);

  defaultUserAgent = newWindow.webContents.userAgent;

  // Connect Adblocker to Window if enabled
  if (store.get('options.adblock')) {
    const engineCachePath = path.join(userDataDir, 'adblock-engine-cache.txt');
    // Only load cache if there is no version mismatch
    if (fs.existsSync(engineCachePath) && (store.get('version') === '3.2.8')) {
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
  const windowDetails = store.get('options.windowDetails');
  const relaunchWindowDetails = store.get('relaunch.windowDetails');
  if (relaunchWindowDetails) {
    newWindow.setSize(
      relaunchWindowDetails.size[0],
      relaunchWindowDetails.size[1]
    );
    newWindow.setPosition(
      relaunchWindowDetails.position[0],
      relaunchWindowDetails.position[1]
    );
    store.delete('relaunch.windowDetails');
  } else if (windowDetails) {
    newWindow.setSize(
      windowDetails.size[0],
      windowDetails.size[1]
    );
    newWindow.setPosition(
      windowDetails.position[0],
      windowDetails.position[1]
    );
  }

  // Configire Picture In Picture
  if (store.get('options.pictureInPicture') && isMac) {
    app.dock.hide();
    newWindow.setAlwaysOnTop(true, 'floating');
    newWindow.setVisibleOnAllWorkspaces(true);
    newWindow.setFullScreenable(false);
    app.dock.show();
  }

  // Detect and update config on null version
  if (!store.get('version')) {
    store.set('version', appVersion);
    store.set('services', []);
    electronLog.info('Initialized Configuration');
  } else {
    store.set('version', appVersion);
  }

  // Load the services and merge the user's with default services
  const userServices = store.get('services') || [];
  global.services = userServices;

  require('./default-services').forEach(dservice => {
    const service = userServices.find(service => service.name === dservice.name);
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
        hidden: service.hidden !== undefined ? service.hidden : dservice.hidden
      };
    } else {
      dservice._defaultService = true;
      global.services.push(dservice);
    }
  });

  if (store.get('options.useLightMode')) {
    nativeTheme.themeSource = 'light';
  } else {
    nativeTheme.themeSource = 'dark';
  }

  // Load the UI or the Default Service
  const defaultService = store.get('options.defaultService');
  const lastOpenedPage = store.get('options.lastOpenedPage');
  const relaunchToPage = store.get('relaunch.toPage');

  if (relaunchToPage !== undefined) {
    electronLog.info('Relaunching page: ' + relaunchToPage);
    newWindow.loadURL(relaunchToPage);
    store.delete('relaunch.toPage');
  } else if (defaultService === 'lastOpenedPage' && lastOpenedPage) {
    electronLog.info('Loading the last opened page: ' + lastOpenedPage);
    newWindow.loadURL(lastOpenedPage);
  } else if (defaultService !== undefined) {
    defaultService = global.services.find(
      service => service.name === defaultService
    );
    if (defaultService.url) {
      electronLog.info('Loading the default service: ' + defaultService.url);
      newWindow.loadURL(defaultService.url);
      newWindow.webContents.userAgent = defaultService.userAgent ? defaultService.userAgent : defaultUserAgent;
    } else {
      electronLog.warn('Error: Default service does not have a URL set. Falling back to main menu.');
      newWindow.loadFile('./ui/index.html');
    }
  } else {
    electronLog.info('Loading main menu');
    newWindow.loadFile('./ui/index.html');
  }

  // Emitted when the window is closing
  newWindow.on('close', () => {
    // Save open service if lastOpenedPage is the default service
    if (store.get('options.defaultService') === 'lastOpenedPage') {
      store.set('options.lastOpenedPage', newWindow.getURL());
    }
    electronLog.info('newWindow.close()');
  });

  // Inject Header Script On Page Load If In Frameless Window
  newWindow.webContents.on('dom-ready', browserWindowDomReady);

  // Emitted when the window is closed.
  newWindow.on('closed', () => {
    newWindowClosed();
  });

  // Emitted when website requests permissions - Electron default allows any permission this restricts websites
  newWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const websiteOrigin = new URL(webContents.getURL()).origin;
      const service = global.services.find(
        service => new URL(service.url).origin === websiteOrigin
      );

      if (
        (service &&
          service.permissions &&
          service.permissions.includes(permission)) ||
        permission === 'fullscreen'
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

async function openHelpWindow() {
  helpWindow = new BrowserWindow({
    title: 'Quark Player Help',
    resizable: true,
    maximizable: false,
    width: 632,
    height: 600,
    useContentSize: true,
    icon: isWin ? path.join(__dirname, 'icon.ico') : path.join(__dirname, 'icon64.png'),
    webPreferences: {
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: false,
      sandbox: true,
      experimentalFeatures: true,
      webviewTag: true,
      devTools: true,
      preload: path.join(__dirname, 'client-preload.js')
    },
    trafficLightPosition: {
      x: 16,
      y: 16
    },
    // Window Styling
    transparent: isLinux ? true : false,
    autoHideMenuBar: false,
    darkTheme: store.get('options.useLightMode') ? false : true,
    vibrancy: store.get('options.useLightMode') ? 'light' : 'ultra-dark',
    backgroundColor: '#00000000',
    toolbar: true
  });
  defaultUserAgent = helpWindow.webContents.userAgent;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
  {
  label: 'Quark Player',
  submenu: [
    {
      label: 'Go Back',
      accelerator: 'Alt+Left',
      click(helpWindow) {
        helpWindow.webContents.goBack();
        electronLog.info('Navigated back');
      }
    },
    {
      label: 'Go Forward',
      accelerator: 'Alt+Right',
      click(helpWindow) {
        helpWindow.webContents.goForward();
        electronLog.info('Navigated forward');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Quark Player',
      accelerator: 'CmdOrCtrl+Q',
      role: 'quit'
    }]
  },
  {
  role: 'help',
  label: 'About',
  submenu: [
    { label: appName + ' v' + appVersion, enabled: false },
    {
      label: 'Created by Oscar Beaumont &&',
      click() {
        new BrowserWindow({ width: 1024, height: 768, useContentSize: true }).loadURL('https://github.com/oscartbeaumont/ElectronPlayer#readme');
      }
    },
    {
      label: 'Maintained by Alex313031',
      click() {
        new BrowserWindow({ width: 1024, height: 768, useContentSize: true }).loadURL('https://github.com/Alex313031/quark-player#readme');
      }
    },
    { type: 'separator' },
    {
      label: 'View Humans.txt',
      accelerator: 'CmdorCtrl+Alt+Shift+H',
      click() {
        const humansWindow = new BrowserWindow({ width: 532, height: 600, useContentSize: true, title: 'humans.txt' });
        humansWindow.loadFile('./ui/humans.txt');
        electronLog.info('Opened humans.txt :)');
      }
    },
    {
      label: 'View License',
      accelerator: 'CmdorCtrl+Alt+Shift+L',
      click() {
        const licenseWindow = new BrowserWindow({ width: 532, height: 550, useContentSize: true, title: 'License' });
        licenseWindow.loadFile('./ui/license.md');
        electronLog.info('Opened license.md');
      }
    },
    {
      label: 'About App',
      accelerator: 'CmdorCtrl+Alt+A',
      click() {
        const aboutWindow = new BrowserWindow({
          width: 512,
          height: 480,
          useContentSize: true,
          title: 'About Quark Player',
          icon: isWin ? path.join(__dirname, 'icon.ico') : path.join(__dirname, 'icon64.png'),
          webPreferences: {
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            contextIsolation: false,
            sandbox: false,
            experimentalFeatures: true,
            webviewTag: true,
            devTools: true,
            preload: path.join(__dirname, 'client-preload.js')
          }
        });
        require('@electron/remote/main').enable(aboutWindow.webContents);
        aboutWindow.loadFile('./ui/about.html');
        electronLog.info('Opened about.html');
      }
    }]
    }
  ]));
  require('@electron/remote/main').enable(helpWindow.webContents);

  if (store.get('options.useLightMode')) {
    nativeTheme.themeSource = 'light';
  } else {
    nativeTheme.themeSource = 'dark';
  }

  helpWindow.loadFile('./ui/help.html');
  electronLog.info('Opened help.html');
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
  prepend: (defaultActions, parameters) => [
  {
    label: 'Open Video in New Window',
    // Only show it when right-clicking video
    visible: parameters.mediaType === 'video',
    click: () => {
      const newWin = new BrowserWindow({
      title: 'New Window',
      width: 1024,
      height: 768,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        experimentalFeatures: true,
        devTools: true
      },
      darkTheme: store.get('options.useLightMode') ? false : true,
      vibrancy: store.get('options.useLightMode') ? 'light' : 'ultra-dark'
      });
      const vidURL = parameters.srcURL;
      newWin.loadURL(vidURL);
    }
  },
  {
    label: 'Open Link in New Window',
    // Only show it when right-clicking a link
    visible: parameters.linkURL.trim().length > 0,
    click: () => {
      const newWin = new BrowserWindow({
      title: 'New Window',
      width: 1024,
      height: 768,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        experimentalFeatures: true,
        devTools: true
      },
      darkTheme: store.get('options.useLightMode') ? false : true,
      vibrancy: store.get('options.useLightMode') ? 'light' : 'ultra-dark'
      });
      const toURL = parameters.linkURL;
      newWin.loadURL(toURL);
    }
  }]
});

// Run when window is closed. This cleans up the mainWindow object to save resources.
function mainWindowClosed() {
  mainActivated = null;
}

// Run when a secondary window is closed. This cleans up the mainNewWindow object to save resources.
function newWindowClosed() {
  mainNewActivated = null;
}

// This method is called when the BrowserWindow's DOM is ready
// it is used to inject the header if pictureInPicture mode and
// hideWindowFrame are enabled.
function browserWindowDomReady() {
  if (
    store.get('options.pictureInPicture') || store.get('options.hideWindowFrame')
  ) {
    // TODO: This is a temp fix and a proper fix should be developed
    if (mainWindow !== null || newWindow !== null) {
      mainWindow.webContents.executeJavaScript(headerScript);
      newWindow?.webContents.executeJavaScript(headerScript);
    }
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async() => {
  // Show versions
  if (argsCmd.includes('--version') || argsCmd.includes('-v')) {
    console.log('\n  Quark Player Version: ' + appVersion);
    console.log('  Electron Version: ' + electronVer);
    console.log('  Chromium Version: ' + chromeVer);
    console.log('  NodeJS Version: ' + nodeVer);
    console.log('  V8 Version: ' + v8Ver + '\n');
    app.quit();
  } else if (argsCmd.includes('--help') || argsCmd.includes('-h')) {
    electronLog.info('Opening Help');
    openHelpWindow();
  } else if (argsCmd.includes('--cdm-info')) {
    await components.whenReady();
    console.log('WidevineCDM Component Info:\n');
    console.log(components.status());
    app.quit();
  } else {
    // Log app version to console
    electronLog.info('Quark Player v' + appVersion);
    // Initialize Widevine
    await components.whenReady();
    electronLog.info('WidevineCDM component ready.');

    // Show version info and acceleration/vulkan warnings if applicable
    if (store.get('options.disableAcceleration')) {
      electronLog.warn('NOTE: Running with acceleration disabled!');
      if (store.get('options.enableVulkan')) {
        electronLog.warn('NOTE: Running with experimental Vulkan backend!');
      }
    } else {
      if (store.get('options.enableVulkan')) {
        electronLog.warn('NOTE: Running with experimental Vulkan backend!');
      }
    }

    // The timeout fixes the trasparent background on Linux ???? why
    //setTimeout(createWindow, 500);
    createWindow();
  }
});

if (store.get('options.disableAcceleration')) {
  // Enable new Canvas2D APIs
  app.commandLine.appendSwitch('new-canvas-2d-api');
  // Enable local DOM to access all resources in a tree
  app.commandLine.appendSwitch('enable-local-file-accesses');
  // Enable QUIC for faster handshakes
  app.commandLine.appendSwitch('enable-quic');
  // Enable inspecting ALL layers
  app.commandLine.appendSwitch('enable-ui-devtools');
  // app.commandLine.appendSwitch('use-gl','desktop');
  if (!store.get('options.useLightMode')) {
    // Force Dark Mode
    app.commandLine.appendSwitch('force-dark-mode');
  }
  // Enable useful features
  if (isLinux) {
    if (store.get('options.enableVulkan')) {
      app.commandLine.appendSwitch(
      'enable-features', 'CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL,Vulkan'
      );
      app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');
    } else {
      app.commandLine.appendSwitch(
      'enable-features', 'CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL'
      );
      app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');
    }
  } else {
    // VAAPI is only applicable on linux so copy the above without the VAAPI flags
    if (store.get('options.enableVulkan')) {
      app.commandLine.appendSwitch(
      'enable-features', 'CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL,Vulkan'
      );
    } else {
      app.commandLine.appendSwitch(
      'enable-features', 'CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL'
      );
    }
  }
  // Enable remote debugging only if we in development mode
  if (process.env.NODE_ENV === 'development') {
    app.commandLine.appendSwitch('remote-debugging-port', '9222');
  }
} else {
  // Force enable GPU acceleration
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  // Force enable GPU rasterization
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  // Enable Zero Copy for GPU memory associated with Tiles
  app.commandLine.appendSwitch('enable-zero-copy');
  // Inform GPU process that GPU context will not be lost in power saving modes
  // Useful for fixing blank or pink screens/videos upon system resume, etc
  app.commandLine.appendSwitch('gpu-no-context-lost');
  if (isLinux) {
    // Enable native CPU-mappable GPU memory buffer support on Linux
    app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
  }
  // Enable transparent overlays
  app.commandLine.appendSwitch('enable-transparent-visuals');
  // Enable new Canvas2D APIs
  app.commandLine.appendSwitch('new-canvas-2d-api');
  // Enable local DOM to access all resources in a tree
  app.commandLine.appendSwitch('enable-local-file-accesses');
  // Enable QUIC for faster handshakes
  app.commandLine.appendSwitch('enable-quic');
  // Enable inspecting ALL layers
  app.commandLine.appendSwitch('enable-ui-devtools');
  if (!store.get('options.useLightMode')) {
    // Force Dark Mode
    app.commandLine.appendSwitch('force-dark-mode');
  }
  // Enable all WebGL Features
  app.commandLine.appendSwitch('enable-webgl-draft-extensions');
  // Enable WebGPU
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  // app.commandLine.appendSwitch('use-gl','desktop');

  // Enable useful features
  if (isLinux) {
    if (store.get('options.enableVulkan')) {
      app.commandLine.appendSwitch(
      'enable-features', 'CanvasOopRasterization,CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL,VaapiVideoDecoder,VaapiVideoEncoder,VaapiIgnoreDriverChecks,Vulkan'
      );
    } else {
      app.commandLine.appendSwitch(
      'enable-features', 'CanvasOopRasterization,CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL,VaapiVideoDecoder,VaapiVideoEncoder,VaapiIgnoreDriverChecks'
      );
    }
    app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');
  } else {
    // VAAPI is only applicable on linux so copy the above without the VAAPI flags
    if (store.get('options.enableVulkan')) {
      app.commandLine.appendSwitch(
      'enable-features', 'CanvasOopRasterization,CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL,Vulkan'
      );
    } else {
      app.commandLine.appendSwitch(
      'enable-features', 'CanvasOopRasterization,CSSColorSchemeUARendering,ImpulseScrollAnimations,ParallelDownloading,Portals,StorageBuckets,JXL'
      );
    }
  }
  // Enable remote debugging only if we in development mode
  if (process.env.NODE_ENV === 'development') {
    app.commandLine.appendSwitch('remote-debugging-port', '9222');
  }
}

// This is a custom event that is used to relaunch the application.
// It destroys and recreates the browser window. This is used to apply
// settings that Electron doesn't allow to be changed in an active
// browser window.
app.on('relaunch', () => {
  electronLog.info('Relaunching Quark Player...');
  // Store details to remeber when relaunched
  if (mainWindow.getURL() !== '') {
    store.set('relaunch.toPage', mainWindow.getURL());
  }
  store.set('relaunch.windowDetails', {
    position: mainWindow.getPosition(),
    size: mainWindow.getSize()
  });

  // Destroy the BrowserWindow
  mainWindow.webContents.removeListener('dom-ready', browserWindowDomReady);
  newWindow?.webContents.removeListener('dom-ready', browserWindowDomReady);
  // Remove app Close listener
  mainWindow.removeListener('closed', mainWindowClosed);
  newWindow?.removeListener('closed', newWindowClosed);
  // Close App
  mainWindow.close();
  newWindow?.close();
  mainWindow = undefined;
  newWindow = undefined;

  // Create a New BrowserWindow
  electronLog.info('App relaunched! [ Loading main.js ]');
  createWindow();
});

// Full restart, quitting Electron. Triggered by developer menu and disabling acceleration
app.on('restart', () => {
  electronLog.warn('Restarting Electron...');
  // Store details to remeber when relaunched
  if (mainWindow.getURL() !== '') {
    store.set('relaunch.toPage', mainWindow.getURL());
  }
  store.set('relaunch.windowDetails', {
    position: mainWindow.getPosition(),
    size: mainWindow.getSize()
  });

  // Destroy the BrowserWindow
  mainWindow.webContents.removeListener('dom-ready', browserWindowDomReady);
  newWindow?.webContents.removeListener('dom-ready', browserWindowDomReady);
  // Remove app Close listener
  mainWindow.removeListener('closed', mainWindowClosed);
  newWindow?.removeListener('closed', newWindowClosed);
  // Close App
  mainWindow.close();
  newWindow?.close();
  mainWindow = undefined;
  newWindow = undefined;

  // Tell app we are going to relaunch
  app.relaunch();
  // Kill Electron to initiate the relaunch
  app.quit();
});

// Dialog box asking if user really wants to relaunch app
// Emitted from certain menu items that require an BrowserWindow reload
app.on('relaunch-confirm', () => {
    dialog.showMessageBox(mainWindow, {
        'type': 'question',
        'title': 'Relaunch Confirmation',
        'message': 'Are you sure you want to relaunch Quark Player?',
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
});

// Dialog box asking if user really wants to restart app
// Emitted from certain menu items that require an Electron restart
app.on('restart-confirm', () => {
    dialog.showMessageBox(mainWindow, {
        'type': 'question',
        'title': 'Restart Confirmation',
        'message': 'Are you sure you want to restart Quark Player?',
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
              app.emit('restart');
          }
      })
});

// Same as the above except used when resetting settings
app.on('reset-confirm', () => {
    dialog.showMessageBox(mainWindow, {
        'type': 'question',
        'title': 'Settings Reset Confirmation',
        'message': 'Are you sure you want to reset *all* \nsettings to their defaults?',
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

// Navigate to given URL when told to by the UI
ipcMain.on('open-url', (e, service) => {
  electronLog.info('Opening service: ' + service.name);
  const currentWindow = BrowserWindow.getFocusedWindow();
  currentWindow.webContents.userAgent = service.userAgent ? service.userAgent : defaultUserAgent;
  currentWindow.loadURL(service.url);
});

// Disable fullscreen when button pressed
ipcMain.on('exit-fullscreen', () => {
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
  if (mainActivated == null) {
    electronLog.info('App Re-Activated [ Loading main.js ]');
    createWindow();
  }
  if (mainActivated == null && mainNewActivated !== null) {
    electronLog.warn('mainActivated == null && mainNewActivated !== null');
    return;
  }
});

// Allow creating new instance with Ctrl+N
app.on('new-window', () => {
  createNewWindow();
  electronLog.info('Created new BrowserWindow');
  newWindow.webContents.once('dom-ready', () => {
      newWindow.setTitle('Quark Player (New Instance)');
  });
});

app.on('will-quit', () => {
  electronLog.warn('Quark Player is quitting now');
});

// Called on disallowed remote APIs below
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
