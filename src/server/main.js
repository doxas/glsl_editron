
import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import {app, ipcMain, dialog, Menu, BrowserWindow} from 'electron';
import connect from 'electron-connect';
import local from 'connect';
import serveStatic from 'serve-static';
import util from './lib/util.js';

// constant variable ==========================================================
const VERSION = 'v2.1.3';
const MACOS = process.platform === 'darwin';
const LOCAL_PORT = 56565;
const IS_DEVELOPMENT = __MODE__ === 'development';
const INDEX_HTML_PATH = IS_DEVELOPMENT ? './app/client/index.html' : './client/index.html';
const MAIN_WINDOW_PARAMETER = {
    width: 1400,
    height: 750,
    frame: MACOS,
    webPreferences: {
        nodeIntegration: true
    }
};
if(MACOS === true){MAIN_WINDOW_PARAMETER.titleBarStyle = 'hidden';}

// variables ==================================================================
let mainWindow;           // main window
let connectClient;        // connector from electron-connect for client
let connectApp = local(); // connect package
let server = null;
let localPortIncrement = 0;

// app events =================================================================
let isLockable = app.requestSingleInstanceLock();
if(isLockable !== true){app.quit();}

app.on('second-instance', () => {
    if(mainWindow != null){
        if(mainWindow.isMinimized() === true){
            mainWindow.restore();
        }
        mainWindow.focus();
    }
});

app.on('ready', () => {
    createMenu();
    createMainWindow();
});

app.on('window-all-closed', () => {
    mainWindow = null;
    if(server != null){
        server.close();
        server = null;
        console.log('local server closed');
    }
    app.quit();
});

// function ===================================================================
function createMenu(){
    if(MACOS !== true){return;}
    const template = [{
        label: 'Edit',
        submenu: [
            {
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                role: 'undo'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                role: 'redo'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                role: 'cut'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                role: 'copy'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                role: 'paste'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                role: 'selectall'
            },
        ]
    }];
    let menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}
function createMainWindow(){
    // create new browser window
    mainWindow = new BrowserWindow(MAIN_WINDOW_PARAMETER);
    mainWindow.loadFile(INDEX_HTML_PATH);

    mainWindow.on('closed', () => {
        mainWindow = null;
        if(IS_DEVELOPMENT === true){
            connectClient.sendMessage('quit', null);
        }
    });

    ipcMain.on('minimize', (evt, arg) => {
        mainWindow.minimize();
    });
    ipcMain.on('maximize', (evt, arg) => {
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    });
    ipcMain.on('close', (evt, arg) => {
        mainWindow.close();
    });
    ipcMain.on('opendevtools', (evt, arg) => {
        mainWindow.webContents.openDevTools();
    });
    ipcMain.on('settitle', (evt, arg) => {
        let title = `${arg} [ ${VERSION} ]`;
        mainWindow.setTitle(title);
        evt.sender.send('settitledom', title);
    });

    ipcMain.on('nativedialog', (evt, arg) => {
        dialog.showMessageBox(mainWindow, {
            title: arg.title,
            message: arg.message,
            buttons: arg.buttons || ['cancel', 'ok']
        }, (res) => {
            evt.sender.send('nativedialog', res);
        });
    });
    ipcMain.on('sendpath', (evt, arg) => {
        if(arg == null || arg.hasOwnProperty('targetPath') !== true || arg.targetPath === ''){
            evt.sender.send('localserverrunning', false);
        }else{
            util.checkDirectories(arg.targetPath)
            .then((dirnames) => {
                let launch = () => {
                    getEmptyPort()
                    .then((port) => {
                        connectApp.use(serveStatic(arg.targetPath));
                        console.log(arg.targetPath);
                        server = http.createServer(connectApp);
                        server.listen(port);
                        console.log('run local server');
                        evt.sender.send('localserverrunning', {
                            dirs: dirnames,
                            pwd: arg.targetPath,
                            port: port,
                        });
                    });
                };
                if(server != null){
                    server.close(() => {
                        server = null;
                        console.log('local server closed');
                        launch();
                    });
                }else{
                    launch();
                }
            })
            .catch((err) => {
                evt.sender.send('localserverrunning', {err: 'invalid project'});
            });
        }
    });
    ipcMain.on('opendirectory', (evt, arg) => {
        dialog.showOpenDialog(mainWindow, {
            title: 'open editron project',
            properties: ['openDirectory']
        }, (res) => {
            if(res == null || Array.isArray(res) !== true || res.length === 0){
                evt.sender.send('localserverrunning', false);
            }else{
                util.checkDirectories(res[0])
                .then((dirnames) => {
                    let launch = () => {
                    getEmptyPort()
                    .then((port) => {
                        connectApp.use(serveStatic(res[0]));
                        console.log(res[0]);
                        server = http.createServer(connectApp);
                        server.listen(port);
                        console.log('run local server');
                        evt.sender.send('localserverrunning', {
                            dirs: dirnames,
                            pwd: res[0],
                            port: port,
                        });
                    });
                    };
                    if(server != null){
                        server.close(() => {
                            server = null;
                            console.log('local server closed');
                            launch();
                        });
                    }else{
                        launch();
                    }
                })
                .catch((err) => {
                    evt.sender.send('localserverrunning', {err: 'invalid project'});
                });
            }
        });
    });
    ipcMain.on('closelocalserver', (evt, arg) => {
        if(server != null){
            server.close();
            server = null;
            console.log('local server closed');
            evt.sender.send('localserverclosed', 'success');
        }else{
            evt.sender.send('localserverclosed', 'not running server');
        }
    });
    ipcMain.on('saveproject', (evt, arg) => {
        if(arg == null || arg.hasOwnProperty('fullPath') !== true || arg.hasOwnProperty('data') !== true){
            evt.sender.send('savefile', {err: 'invalid data'});
        }else{
            util.saveFiles(arg.fullPath, arg.data)
            .then(() => {
                evt.sender.send('savefile', 'success');
            })
            .catch((err) => {
                evt.sender.send('savefile', {err: 'save file failed'});
            });
        }
    });
    ipcMain.on('kioskmode', (evt, arg) => {
        let flag = arg === true;
        mainWindow.setKiosk(flag);
        evt.sender.send('setkiosk', flag);
    });

    if(IS_DEVELOPMENT === true){
        connectClient = connect.client.create(mainWindow);
        mainWindow.webContents.openDevTools();
    }
}

function getEmptyPort(){
    return new Promise((resolve) => {
        let target = LOCAL_PORT + localPortIncrement;
        ++localPortIncrement;
        checkEmptyPort(target)
        .then((port) => {
            resolve(port);
        })
        .catch(() => {
            getEmptyPort()
            .then((port) => {
                resolve(port);
            });
        });
    });
}

function checkEmptyPort(port){
    return new Promise((resolve, reject) => {
        console.log(`check-port: ${port}`);
        let client = new net.Socket();
        const something = () => {
            client.destroy();
            reject(port);
        };
        const empty = () => {
            client.destroy();
            resolve(port);
        };
        client.setTimeout(500);
        client.on('connect', something);
        client.on('timeout', empty);
        client.on('error', empty);
        client.connect(port, '127.0.0.1');
    });
};
