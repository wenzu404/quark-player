const { Menu, shell, BrowserWindow, app, dialog } = require('electron');
const prompt = require('electron-prompt');
const path = require('path');
const fs = require('fs');
const electronLog = require('electron-log');

module.exports = (store, services, mainWindow, app, defaultUserAgent) => {
  var servicesMenuItems = [];
  var defaultServiceMenuItems = [];
  var enabledServicesMenuItems = [];
  // Get app version from package.json
  var appVersion = app.getVersion();
  // Enable remote module on sub-windows
  require("@electron/remote/main").enable(mainWindow.webContents);

  if (services !== undefined) {
    // Menu with all services that can be clicked for easy switching
    servicesMenuItems = services.map(service => ({
      label: service.name,
      visible: !service.hidden,
      click() {
        electronLog.info('Loading URL: ' + service.url);
        mainWindow.loadURL(service.url);
        mainWindow.send('run-loader', service);
      }
    }));

    // Menu for selecting default service (one which is opened on starting the app)
    defaultServiceMenuItems = services.map(service => ({
      label: service.name,
      type: 'checkbox',
      checked: store.get('options.defaultService')
          ? store.get('options.defaultService') == service.name
          : false,
      click(e) {
        e.menu.items.forEach(e => {
          if (!(e.label === service.name)) e.checked = false;
        });
        store.set('options.defaultService', service.name);
      }
    }));

    // Menu with all services that can be clicked for easy switching
    enabledServicesMenuItems = services.map(service => ({
      label: service.name,
      type: 'checkbox',
      checked: !service.hidden,
      click() {
        if(service._defaultService) {
          let currServices = store.get('services');
          currServices.push({
            name: service.name,
            hidden: !service.hidden
          });
          services = currServices;
          store.set('services', currServices);
        } else {
          let currServices = store.get('services');
          let currService = currServices.find(s => service.name == s.name);
          currService.hidden = service.hidden ? undefined : true
          services = currServices;
          store.set('services', currServices);
        }
        app.emit('relaunch-confirm');
      }
    }));
  }

  return Menu.buildFromTemplate([
    {
      label: 'Quark Player',
      submenu: [
        {
          label: 'Go Back',
          accelerator: 'Alt+Left',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.goBack();
            electronLog.info('Navigated back');
          }
        },
        {
          label: 'Go Forward',
          accelerator: 'Alt+Right',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.goForward();
            electronLog.info('Navigated forward');
          }
        },
        {
          label: 'New Window',
          accelerator: 'CmdorCtrl+N',
          click() {
            app.emit('new-window');
          }
        },
        {
          label: 'Close Window',
          accelerator: 'CmdorCtrl+W',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.close();
            electronLog.info('Closed a window');
          }
        },
        {
          type: 'separator'
        },
        { label: 'Open File',
          accelerator: 'Ctrl+Shift+O',
          click() {
            dialog.showOpenDialog({ properties: ['openFile'] }).then(result => {
            electronLog.info('Opened file:' + result.filePaths);
            var openURI = result.filePaths
            const openWindow = new BrowserWindow({
              webPreferences: {
                nodeIntegration: false,
                nodeIntegrationInWorker: false,
                contextIsolation: false,
                sandbox: true,
                experimentalFeatures: true,
                webviewTag: true,
                devTools: true,
                javascript: true,
                plugins: true,
                enableRemoteModule: true,
              },
            });
            openWindow.loadFile(openURI[0]);
            openWindow.setTitle(openURI[0])});
          }
        },
        {
          type: 'separator'
        },
        {
          label: 'Shortcut Table',
          accelerator: 'CmdorCtrl+Alt+H',
          click() {
            const helpWindow = new BrowserWindow({
              width: 632,
              height: 600,
              title: "Quark Player Help",
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
                preload: path.join(__dirname, 'client-preload.js'),
              },
            });
            require("@electron/remote/main").enable(helpWindow.webContents);
            helpWindow.loadFile('./ui/help.html');
            electronLog.info('Opened help.html');
          }
        },
        {
          label: 'Quit Quark Player',
          accelerator: 'CmdOrCtrl+Q', // TODO: Non Mac Shortcut
          click() {
            app.emit('exit');
          }
        },
      ]
    },
    {
      label: 'Services',
      submenu: [
        {
          label: 'Main Menu',
          accelerator: 'CmdOrCtrl+M',
          click() {
            electronLog.info('Opening main menu...');
            mainWindow.webContents.userAgent = defaultUserAgent;
            mainWindow.loadFile('./ui/index.html');
          }
        },
        {
          type: 'separator'
        },
        {
          label: 'Open Custom URL',
          accelerator: 'CmdOrCtrl+O',
          click(focusedWindow) {
            prompt({
              title: 'Open Custom URL',
              label: 'URL:',
              alwaysOnTop: true,
              showWhenReady: true,
              resizable: true,
              menuBarVisible: true,
              inputAttrs: {
                  placeholder: 'https://example.org'
              }
          })
          .then(inputtedURL => {
            if (inputtedURL != null) {
              if(inputtedURL == '') {
                inputtedURL = 'https://example.org';
              }
              electronLog.info('Opening Custom URL: ' + inputtedURL);
              focusedWindow.loadURL('https://' + inputtedURL);
            }
          })
          .catch(console.error);
          }
        }
      ].concat(servicesMenuItems)
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Enable AdBlocker *',
          type: 'checkbox',
          click(e) {
            store.set('options.adblock', e.checked);

            // Store details to remeber when relaunched
            if (mainWindow.getURL() != '') {
              store.set('relaunch.toPage', mainWindow.getURL());
            }
            store.set('relaunch.windowDetails', {
              position: mainWindow.getPosition(),
              size: mainWindow.getSize()
            });

            // Restart the app
            //app.relaunch();
            //app.quit();
            app.emit('relaunch-confirm');
          },
          checked: store.get('options.adblock')
            ? store.get('options.adblock')
            : false
        },
        {
          label: 'Always On Top',
          type: 'checkbox',
          click(e) {
            store.set('options.alwaysOnTop', e.checked);
            mainWindow.setAlwaysOnTop(e.checked);
          },
          checked: store.get('options.alwaysOnTop')
        },
        {
          label: 'Frameless Window *',
          type: 'checkbox',
          accelerator: 'CmdorCtrl+Alt+F',
          click(e) {
            store.set('options.hideWindowFrame', e.checked);
            app.emit('relaunch-confirm');
          },
          checked: store.get('options.hideWindowFrame')
            ? store.get('options.hideWindowFrame')
            : false
        },
        {
          label: store.get('options.useLightMode') ? 'Use Dark Mode' : 'Use Light Mode',
          type: 'checkbox',
          accelerator: 'CmdorCtrl+Shift+D',
          click(e) {
            if (store.get('options.useLightMode')) {
              store.set('options.useLightMode', false);
            } else {
              store.set('options.useLightMode', true);
            }
            app.emit('relaunch-confirm');
          },
          checked: false
        },
        {
          label: 'Remember Window Details',
          type: 'checkbox',
          click() {
            if (store.get('options.windowDetails')) {
              store.delete('options.windowDetails');
            } else {
              store.set('options.windowDetails', {});
            }
          },
          checked: !!store.get('options.windowDetails')
        },
        {
          label: 'Picture In Picture *',
          type: 'checkbox',
          click(e) {
            store.set('options.pictureInPicture', e.checked);
            app.emit('relaunch-confirm');
          },
          checked: store.get('options.pictureInPicture')
            ? store.get('options.pictureInPicture')
            : false,
          visible: process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32'
        },
        {
          label: 'Start in Fullscreen',
          type: 'checkbox',
          click(e) {
            store.set('options.launchFullscreen', e.checked);
          },
          checked: store.get('options.launchFullscreen')
            ? store.get('options.launchFullscreen')
            : false
        },
        {
          label: 'Enable/Disable Services *',
          submenu: enabledServicesMenuItems
        },
        {
          label: 'Default Service',
          submenu: [
            {
              label: 'Menu',
              type: 'checkbox',
              click(e) {
                e.menu.items.forEach(e => {
                  if (!(e.label === 'Menu')) e.checked = false;
                });
                store.delete('options.defaultService');
              },
              checked: store.get('options.defaultService') === undefined
            },
            {
              label: 'Last Opened Page',
              type: 'checkbox',
              click(e) {
                e.menu.items.forEach(e => {
                  if (!(e.label === 'Last Opened Page')) e.checked = false;
                });
                store.set('options.defaultService', 'lastOpenedPage');
              },
              checked: store.get('options.defaultService') === 'lastOpenedPage'
            },
            { type: 'separator' }
          ].concat(defaultServiceMenuItems)
        },
        {
          label: 'Edit Config File',
          click() {
            store.openInEditor();
          }
        },
        {
          label: 'Reset all Settings *',
          click() {
            // Reset Config
            store.clear();

            // Clear Engine Cache
            let engineCachePath = path.join(
              app.getPath('userData'),
              'adblock-engine-cache.txt'
            );
            fs.access(engineCachePath, fs.constants.F_OK, (err) => {
              if (!err) {
                fs.unlinkSync(engineCachePath);
              }
            });

            // Restart the app
            //app.relaunch();
            //app.quit();
            app.emit('reset-confirm');
          }
        },
        { label: '* Requires an App Restart', enabled: false }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteandmatchstyle' },
        { role: 'delete' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Go Back',
          accelerator: 'Alt+Left',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.goBack();
            electronLog.info('Navigated back');
          }
        },
        {
          label: 'Go Forward',
          accelerator: 'Alt+Right',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.goForward();
            electronLog.info('Navigated forward');
          }
        },
        {
          label: 'New Window',
          accelerator: 'CmdorCtrl+N',
          click() {
            app.emit('new-window');
          }
        },
        {
          label: 'Close Window',
          accelerator: 'CmdorCtrl+W',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.close();
            electronLog.info('Closed a window');
          }
        },
        {
          type: 'separator'
        },
        {
          role: 'zoomin'
        },
        {
          role: 'zoomout'
        },
        {
          role: 'resetzoom'
        },
        {
          type: 'separator'
        },
        {
          role: 'togglefullscreen'
        }
      ]
    },
    {
      label: 'Developer',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.reload();
          }
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.reloadIgnoringCache();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator:
            process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click(item, focusedWindow) {
            focusedWindow.webContents.toggleDevTools();
          }
        },
        {
          type: 'separator'
        },
        {
          label: 'Open Electron DevTools',
          accelerator:
            process.platform === 'darwin' ? 'CmdorCtrl+Shift+F12' : 'F12' || 'Ctrl+Shift+F12',
          click(item, focusedWindow) {
            focusedWindow.openDevTools({ mode: 'detach' });
          }
        },
        {
          label: 'Open chrome://gpu',
          accelerator: 'CmdorCtrl+Alt+G',
          click() {
            const gpuWindow = new BrowserWindow({width: 900, height: 700, title: "GPU Internals"});
            gpuWindow.loadURL('chrome://gpu');
            electronLog.info('Opened chrome://gpu');
          }
        },
        {
          label: 'Open chrome://process-internals',
          accelerator: 'CmdorCtrl+Alt+P',
          click() {
            const procsWindow = new BrowserWindow({width: 900, height: 700, title: "Process Model Internals"});
            procsWindow.loadURL('chrome://process-internals');
            electronLog.info('Opened chrome://process-internals');
          }
        },
        {
          label: 'Open chrome://media-internals',
          accelerator: 'CmdorCtrl+Alt+M',
          click() {
            const mediaWindow = new BrowserWindow({width: 900, height: 700, title: "Media Internals"});
            mediaWindow.loadURL('chrome://media-internals');
            electronLog.info('Opened chrome://media-internals');
          }
        },
        {
          label: 'Open Test Image',
          visible: process.env.QUARK_TEST === '1',
          accelerator: 'CmdorCtrl+Alt+Shift+T',
          click() {
            const yiffWindow = new BrowserWindow({width: 700, height: 932, title: "Juno's Ass"});
            electronLog.info('Opening test image')
            //yiffWindow.loadFile('./ui/imgs/juno-ass.png');
            yiffWindow.loadFile('./ui/yiff.html');
          }
        },
        {
          label: 'Restart App',
          click() {
            electronLog.warn('Restarting Electron...');
            app.emit('restart');
          }
        }
      ]
    },
    {
      role: 'help',
      label: 'About',
      submenu: [
        { label: 'Quark Player v' + app.getVersion(), enabled: false },
        { label: 'Created by Oscar Beaumont &&',
          click() {
            //shell.openExternal(
              //'https://github.com/oscartbeaumont/ElectronPlayer#readme'
            //);
            //electronLog.info('Opened external browser');
            new BrowserWindow({width: 1024, height: 768}).loadURL('https://github.com/oscartbeaumont/ElectronPlayer#readme');
          }
        },
        { label: 'Maintained by Alex313031',
          click() {
            //shell.openExternal(
              //'https://github.com/Alex313031/quarkplayer#readme'
            //);
            //electronLog.info('Opened external browser');
            new BrowserWindow({width: 1024, height: 768}).loadURL('https://github.com/Alex313031/quarkplayer#readme');
          }
        },
        {
          type: 'separator'
        },
        {
          label: 'View Humans.txt',
          accelerator: 'CmdorCtrl+Alt+Shift+H',
          click() {
            const humansWindow = new BrowserWindow({width: 532, height: 628, title: "humans.txt"});
            humansWindow.loadFile('./ui/humans.txt');
            electronLog.info('Opened humans.txt :)');
          }
        },
        {
          label: 'About App',
          accelerator: 'CmdorCtrl+Alt+A',
          click() {
            const aboutWindow = new BrowserWindow({
              width: 532,
              height: 528,
              title: "About Quark Player",
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
                preload: path.join(__dirname, 'client-preload.js'),
              },
            });
            require("@electron/remote/main").enable(aboutWindow.webContents);
            aboutWindow.loadFile('./ui/about.html');
            electronLog.info('Opened about.html');
          }
        }
      ]
    }
  ]);
};
