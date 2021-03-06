
import {ipcRenderer, webFrame} from 'electron';
import util from './lib/util.js';
import Component from './lib/component.js';

const FONT_SIZE           = 16;                                // 基本のフォントサイズ
const LIGHT_THEME         = 'ace/theme/tomorrow';              // ライト・テーマ
const DARK_THEME          = 'ace/theme/tomorrow_night_bright'; // ダーク・テーマ
const BUTTON_BLOCK_HEIGHT = 32;                                // ボタン領域の高さ
const ICON_SIZE           = 16;                                // ボタンの大きさ
const ICON_MARGIN         = '8px 7px';                         // ボタンの余白
const DARK_MODE           = true;                              // テーマ
// Ace に設定するオプション
const EDITOR_OPTION = {
    highlightActiveLine: true,
    highlightSelectedWord: true,
    useSoftTabs: true,
    navigateWithinSoftTabs: true,
    vScrollBarAlwaysVisible: true,
    autoScrollEditorIntoView: true,
    scrollPastEnd: 1.0,
    highlightGutterLine: true,
    showPrintMargin: false,
    printMargin: false,
    displayIndentGuides: true,
    fontSize: `${FONT_SIZE}px`,
    fontFamily: '"Ricty Diminished Discord", "Ricty Diminished", Ricty, Monaco, consolas, monospace',
    theme: DARK_THEME,
    enableBasicAutocompletion: true,
    enableSnippets: false,
    enableLiveAutocompletion: true,
};

let macos = process.platform === 'darwin';
let horizonSplit   = true;      // 水平方向に分割されたビュー
let vimMode        = false;     // vim keybind
let latestResponse = null;      // サーバからのレスポンス（ファイル情報などを含む）
let latestActive   = null;      // ユーザーがアクティブにしたソースコードのインデックス
let activeTabIndex = 0;         // タブのなかで現在アクティブなインデックス
let items          = [];        // 読み込んだプロジェクトに含まれるソースコード（ディレクトリ）
let pages          = [];        // エディタを格納するページ DOM
let editors        = [];        // エディタ
let isGeneration   = false;     // エディタの生成中かどうか（生成中は onChange を無効化したいためのフラグ）
let kiosk          = false;     // kiosk mode
let split          = null;      // 上下分割の Splitter
let vsplit         = null;      // 上段の左右分割の Splitter
let tabStrip       = null;      // TabStrip
let frameListener  = null;      // frame 内で keydown を監視し F11 を禁止するためのリスナ
let globalFontSize = FONT_SIZE; // フォントサイズ
let globalDarkMode = DARK_MODE; // テーマ

// DOM Content Loaded でフロント側の設定等を開始する
window.addEventListener('DOMContentLoaded', () => {
    // ドラッグアンドドロップ
    document.addEventListener('dragover', (evt) => {
        evt.preventDefault();
        return false;
    }, false);
    document.addEventListener('drop', (evt) => {
        evt.preventDefault();
        return false;
    }, false);
    document.body.addEventListener('drop', (evt) => {
        let target = evt.dataTransfer.files[0];
        isDirectory(target)
        .then((flag) => {
            if(flag === true){
                // 変更済みのソースコードがある場合、開く前に尋ねる
                if(latestResponse != null && latestActive != null && items[latestActive].changes === true){
                    let message = 'ソースコードの変更後、一度も実行していない変更は破棄されます。\n新規プロジェクトを開いてよろしいですか？';
                    nativeDialog('info', message)
                    .then((res) => {
                        if(res > 0){
                            nativeSendPath(target.path);
                        }
                    });
                }else{
                    nativeSendPath(target.path);
                }
            }else{
                let message = 'プロジェクトのフォルダをドロップしてください。';
                nativeDialog('info', message, ['OK']);
            }
        });
    }, false);

    // このウィンドウに関する全体の設定
    windowSetting()
    .then(() => {
        // 初期化（主に DOM の生成）
        return initialSetting();
    })
    .then(() => {
        // イベント処理
        eventSetting();
        // ステータスバーを更新して準備完了
        setStatusBarMessage('📐: welcome editron');
        setStatusBarIcon(
            '#windowinterfacestatuseditron',
            'green', true,
            'editron initialize success'
        );
    });
}, false);

/**
 * @param {string} text - 設定するテキスト
 */
function setStatusBarMessage(text){
    let message = document.querySelector('#windowinterfacestatusmessage');
    message.textContent = text;
}

/**
 * ステータスバーの右側にあるアイコンの更新を行う
 * @param {string} targetId - 対象となる DOM の ID
 * @param {string} stat - green, yellow, red
 * @param {boolean} add - stat で指定された色を設定するか、解除するか
 * @param {string} title - title 属性に設定する文字列
 */
function setStatusBarIcon(targetId, stat, add, title){
    let icon = document.querySelector(targetId);
    if(add === true){
        icon.classList.add(stat);
    }else{
        icon.classList.remove(stat);
    }
    icon.setAttribute('title', title);
}

/**
 * @return {Promise}
 */
function windowSetting(){
    // Electron 自体のズームは行われないように設定する
    webFrame.setZoomFactor(1);
    webFrame.setVisualZoomLevelLimits(1, 1);
    webFrame.setLayoutZoomLevelLimits(0, 0);
    return new Promise((resolve) => {
        // header
        let ttl = document.body.querySelector('#windowinterfacetitle');
        let min = document.body.querySelector('#windowinterfacecontrollermin');
        let max = document.body.querySelector('#windowinterfacecontrollermax');
        let cls = document.body.querySelector('#windowinterfacecontrollerclose');
        if(macos === true){
            let head = document.body.querySelector('#windowinterfaceheader');
            let menu = document.body.querySelector('#windowinterfacemenuicon');
            let ctrl = document.body.querySelector('#windowinterfacecontroller');
            head.style.lineHeight = '22px';
            head.style.minHeight  = '22px';
            head.style.maxHeight  = '22px';
            menu.style.minWidth = '4px';
            menu.style.maxWidth = '4px';
            ttl.style.fontSize = 'smaller';
            ttl.style.textAlign = 'center';
            ttl.style.padding = '0px 8px 0px 64px';
            ctrl.style.display = 'none';
        }else{
            min.addEventListener('click', () => {ipcRenderer.send('minimize', true);}, false);
            max.addEventListener('click', () => {ipcRenderer.send('maximize', true);}, false);
            cls.addEventListener('click', () => {ipcRenderer.send('close', true);}, false);
        }
        // footer
        let footer = document.body.querySelector('#windowinterfacefooter');
        // window level event
        window.addEventListener('resize', () => {
            if(editors == null || Array.isArray(editors) !== true){return;}
            editors.forEach((v) => {
                v.resize();
            });
            if(tabStrip != null){
                tabStrip.update();
            }
        }, false);
        window.addEventListener('keydown', (evt) => {
            switch(evt.key){
                // 保存および更新
                case 's':
                    if(evt.ctrlKey === true || evt.metaKey === true){
                        saveEditorSource();
                    }
                    break;
                // 開発者ツール
                case 'i':
                case 'I':
                    if(evt.ctrlKey === true || evt.metaKey === true){
                        ipcRenderer.send('opendevtools', {});
                    }
                    break;
                case 'F11':
                    evt.preventDefault();
                    toggleFullScreen();
                    break;
                case 'F12':
                    ipcRenderer.send('opendevtools', {});
                    break;
                // テーマの反転
                case 'b':
                case '∫':
                    if((evt.ctrlKey === true || evt.metaKey === true) && evt.altKey === true){
                        globalDarkMode = !globalDarkMode;
                        editors.forEach((v, index) => {
                            if(globalDarkMode === true){
                                v.setTheme(DARK_THEME);
                            }else{
                                v.setTheme(LIGHT_THEME);
                            }
                        });
                    }
                    break;
                // レイアウト変更
                case 'c':
                case 'ç':
                    if((evt.ctrlKey === true || evt.metaKey === true) && evt.altKey === true){
                        swapLayout();
                    }
                    break;
                // フォントサイズ減
                case '-':
                case '_':
                    if(evt.ctrlKey === true || evt.metaKey === true){
                        --globalFontSize;
                        pages.forEach((v, index) => {
                            v.style.fontSize = `${globalFontSize}px`;
                        });
                    }
                    break;
                // フォントサイズ増
                case '=':
                case '+':
                case ';':
                    if(evt.ctrlKey === true || evt.metaKey === true){
                        ++globalFontSize;
                        pages.forEach((v, index) => {
                            v.style.fontSize = `${globalFontSize}px`;
                        });
                    }
                    break;
                // tab change
                case 'Tab':
                    if(evt.ctrlKey === true || evt.metaKey === true){
                        if(evt.shiftKey === true){
                            activeTabIndex = (pages.length + activeTabIndex - 1) % pages.length;
                        }else{
                            activeTabIndex = (activeTabIndex + 1) % pages.length;
                        }
                        tabStrip.setPage(activeTabIndex);
                        editors[activeTabIndex].focus();
                    }
                    break;
                // item change
                case ',':
                case '.':
                case '≤':
                case '≥':
                    if((evt.ctrlKey === true || evt.metaKey === true) && evt.altKey === true){
                        if(latestResponse == null || latestResponse.dirs == null){return;}
                        let idx = 0;
                        let count = latestResponse.dirs.length;
                        if(evt.key === ',' || evt.key == '≤'){
                            idx = (count + latestActive - 1) % count;
                        }else{
                            idx = (latestActive + 1) % count;
                        }
                        const update = () => {
                            generateEditor(latestResponse.dirs[idx].data);
                            latestActive = idx;
                            items.forEach((w, i) => {
                                w.update(false, false);
                            });
                            items[latestActive].update(true, false);
                            setFrameSource(idx);
                            setStatusBarMessage(`start: [ ${latestResponse.dirs[idx].dirName} ]`);
                            setStatusBarIcon('#windowinterfacestatusfile', 'red', false, '');
                            setStatusBarIcon('#windowinterfacestatusfile', 'yellow', false, '');
                            setStatusBarIcon('#windowinterfacestatusfile', 'green', true, 'start success');
                        };
                        // ソースコードに変更が加えられているかどうかなどにより分岐する
                        if(latestActive != null && items[latestActive].changes === true){
                            let message = `現在のソースコード[ ${latestResponse.dirs[latestActive].dirName} ]に変更が加えられています。\n[ ${latestResponse.dirs[idx].dirName} ] を読み込むとその変更は破棄されます。読み込みを開始してよろしいですか？`;
                            nativeDialog('info', message)
                            .then((res) => {
                                if(res > 0){
                                    update();
                                }
                            });
                        }else{
                            update();
                        }
                    }
                    break
                // vim mode
                case 'v':
                case 'V':
                case '√':
                    if((evt.ctrlKey === true || evt.metaKey === true) && evt.altKey === true){
                        vimMode = !vimMode;
                        editors.forEach((v, index) => {
                            if(vimMode === true){
                                v.setKeyboardHandler('ace/keyboard/vim');
                            }else{
                                v.setKeyboardHandler(null);
                            }
                        });
                    }
                    break;
                default:
                    break;
            }
        }, false);
        // 最後にタイトルを更新
        ipcRenderer.on('settitledom', (evt, arg) => {
            ttl.textContent = arg;
            resolve();
        });
        let title = 'webgl - editron';
        ipcRenderer.send('settitle', title);
    });
}

/**
 * @return {Promise}
 */
function initialSetting(){
    return new Promise((resolve) => {
        // 上下を分けるスプリッタ
        let container = document.querySelector('#container');
        split = new Component.Splitter(container, true);
        split.first.setAttribute('id', 'first');
        split.second.setAttribute('id', 'second');
        split.on('change', (arg) => {
            editors.forEach((v) => {
                v.resize();
            });
            setFrameSize();
        });
        // 上段を左右に分けるスプリッタ
        vsplit = new Component.Splitter(split.first, false, 0.2);
        vsplit.on('change', (arg) => {
            setFrameSize();
        });
        vsplit.first.setAttribute('id', 'vfirst');
        vsplit.second.setAttribute('id', 'vsecond');
        // 上段左サイドバー
        let leftBlock = document.createElement('div');
        util.appendStyle(leftBlock, {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
        });
        let buttonBlock = document.createElement('div');
        util.appendStyle(buttonBlock, {
            width: '100%',
            minHeight: `${BUTTON_BLOCK_HEIGHT}px`,
            maxHeight: `${BUTTON_BLOCK_HEIGHT}px`,
            display: 'flex',
            flexDirection: 'row',
            overflow: 'hidden',
            userSelect: 'none',
        });
        let openFolderIcon = document.createElement('img');
        openFolderIcon.setAttribute('id', 'open');
        openFolderIcon.setAttribute('title', 'プロジェクトを開く');
        openFolderIcon.src = './image/folder_plus.svg';
        util.appendStyle(openFolderIcon, {
            minWidth: `${ICON_SIZE}px`,
            maxWidth: `${ICON_SIZE}px`,
            height: `${ICON_SIZE}px`,
            margin: ICON_MARGIN,
            cursor: 'pointer',
            filter: 'invert(0.5)',
            userSelect: 'none',
        });
        openFolderIcon.addEventListener('mouseenter', () => {
            openFolderIcon.style.filter = 'invert(1)';
        });
        openFolderIcon.addEventListener('mouseleave', () => {
            openFolderIcon.style.filter = 'invert(0.5)';
        });
        let playIcon = document.createElement('img');
        playIcon.setAttribute('id', 'play');
        playIcon.setAttribute('title', 'ソースコードを保存しプレビューを更新 (Ctrl+s or Command+s)');
        playIcon.src = './image/play.svg';
        util.appendStyle(playIcon, {
            minWidth: `${ICON_SIZE}px`,
            maxWidth: `${ICON_SIZE}px`,
            height: `${ICON_SIZE}px`,
            margin: ICON_MARGIN,
            cursor: 'pointer',
            filter: 'invert(0.5)',
            userSelect: 'none',
        });
        playIcon.addEventListener('mouseenter', () => {
            playIcon.style.filter = 'invert(1)';
        });
        playIcon.addEventListener('mouseleave', () => {
            playIcon.style.filter = 'invert(0.5)';
        });
        let stopIcon = document.createElement('img');
        stopIcon.setAttribute('id', 'stop');
        stopIcon.setAttribute('title', 'プレビューを停止');
        stopIcon.src = './image/stop.svg';
        util.appendStyle(stopIcon, {
            minWidth: `${ICON_SIZE}px`,
            maxWidth: `${ICON_SIZE}px`,
            height: `${ICON_SIZE}px`,
            margin: ICON_MARGIN,
            cursor: 'pointer',
            filter: 'invert(0.5)',
            userSelect: 'none',
        });
        stopIcon.addEventListener('mouseenter', () => {
            stopIcon.style.filter = 'invert(1)';
        });
        stopIcon.addEventListener('mouseleave', () => {
            stopIcon.style.filter = 'invert(0.5)';
        });
        let layoutIcon = document.createElement('img');
        layoutIcon.setAttribute('id', 'layout');
        layoutIcon.setAttribute('title', 'レイアウトを変更');
        layoutIcon.src = './image/layout.svg';
        util.appendStyle(layoutIcon, {
            minWidth: `${ICON_SIZE}px`,
            maxWidth: `${ICON_SIZE}px`,
            height: `${ICON_SIZE}px`,
            margin: ICON_MARGIN,
            cursor: 'pointer',
            filter: 'invert(0.5)',
            userSelect: 'none',
        });
        layoutIcon.addEventListener('mouseenter', () => {
            layoutIcon.style.filter = 'invert(1)';
        });
        layoutIcon.addEventListener('mouseleave', () => {
            layoutIcon.style.filter = 'invert(0.5)';
        });
        let listBlock = document.createElement('div');
        listBlock.setAttribute('id', 'listblock');
        util.appendStyle(listBlock, {
            width: '100%',
            height: '100%',
            overflow: 'auto',
        });
        // appending
        vsplit.first.appendChild(leftBlock);
        leftBlock.appendChild(buttonBlock);
        leftBlock.appendChild(listBlock);
        buttonBlock.appendChild(openFolderIcon);
        buttonBlock.appendChild(playIcon);
        buttonBlock.appendChild(stopIcon);
        buttonBlock.appendChild(layoutIcon);

        resolve();
    });
}

/**
 * @return {Promise}
 */
function swapLayout(){
    let container = document.querySelector('#container');
    // let first   = document.querySelector('#first');
    let second  = document.querySelector('#second');
    let vfirst  = document.querySelector('#vfirst');
    let vsecond = document.querySelector('#vsecond');
    // children
    // let cFirst   = null;
    let cSecond  = null;
    let cVFirst  = null;
    let cVSecond = null;
    // if(first.children.length > 0){cFirst = first.removeChild(first.firstChild);}
    if(second.children.length > 0){cSecond = second.removeChild(second.firstChild);}
    if(vfirst.children.length > 0){cVFirst = vfirst.removeChild(vfirst.firstChild);}
    if(vsecond.children.length > 0){cVSecond = vsecond.removeChild(vsecond.firstChild);}
    // first   = null;
    second  = null;
    vfirst  = null;
    vsecond = null;
    vsplit.release();
    split.release();
    // フラグを反転
    horizonSplit = !horizonSplit;
    let r = horizonSplit === true ? 0.2 : 0.5;
    // 再生成
    split = new Component.Splitter(container, horizonSplit);
    split.first.setAttribute('id', 'first');
    split.second.setAttribute('id', 'second');
    split.on('change', (arg) => {
        editors.forEach((v) => {
            v.resize();
        });
        if(tabStrip != null){
            tabStrip.update();
        }
        setFrameSize();
    });
    vsplit = new Component.Splitter(split.first, !horizonSplit, r);
    vsplit.on('change', (arg) => {
        setFrameSize();
    });
    vsplit.first.setAttribute('id', 'vfirst');
    vsplit.second.setAttribute('id', 'vsecond');
    // 子要素の再挿入
    // if(cFirst != null){split.first.appendChild(cFirst);}
    if(cSecond != null){split.second.appendChild(cSecond);}
    if(cVFirst != null){vsplit.first.appendChild(cVFirst);}
    if(cVSecond != null){vsplit.second.appendChild(cVSecond);}
    editors.forEach((v) => {
        v.resize();
    });
    setFrameSize();
}

/**
 * エディタのタイトル文字列となる配列を生成して返す
 */
function getTitleArray(data){
    let titles = Object.keys(data);
    titles.sort();
    let frag = [];
    titles.forEach((v, index) => {
        if(v.includes('fs') === true){
            frag.push(v);
        }
    });
    // fs 系を vs の後ろに insert する
    if(frag.length > 0){
        titles.splice(0, frag.length);
        frag.forEach((v, index) => {
            let i = 2 + index * 2 + 1;
            titles.splice(i, 0, v);
        });
    }
    // html を末尾に移動する
    let html = titles.shift();
    titles.push(html);
    return titles;
}

/**
 * @return {Promise}
 */
function editorSetting(data){
    let titles = getTitleArray(data);
    if(editors != null){
        editors.forEach((v) => {
            v = null;
        });
    }
    editors = [];
    return new Promise((resolve, reject) => {
        // タブの各ページにエディタを配置し初期化する
        pages.forEach((v, index) => {
            let type = '';
            switch(true){
                case titles[index].includes('html'):
                    type = 'html';
                    break;
                case titles[index].includes('js'):
                    type = 'javascript';
                    break;
                case titles[index].includes('vs'):
                case titles[index].includes('fs'):
                    type = 'glsl';
                    break;
                default:
                    reject('invalid type');
                    return;
            }
            let editor = ace.edit(v.id);
            editor.$blockScrolling = Infinity;
            editor.setOptions(EDITOR_OPTION);
            editor.session.setMode(`ace/mode/${type}`);
            editor.session.setTabSize(4);
            if(globalDarkMode === true){
                editor.setTheme(DARK_THEME);
            }else{
                editor.setTheme(LIGHT_THEME);
            }
            v.style.fontSize = `${globalFontSize}px`;

            // event setting
            // 諸事情により Command + L は封印する
            editor.commands.addCommand({
                name: 'disableCtrl-L',
                bindKey: {win: 'Ctrl-L', mac: 'Command-L'},
                exec: () => {},
            });

            // 変更があったことを検出して左サイドバーのリスト上にインジケータを出すための処理
            editor.session.on('change', () => {
                if(isGeneration === true){return;}
                if(latestResponse != null && latestActive != null && latestResponse.dirs[latestActive] != null){
                    latestResponse.dirs[latestActive].changes = true;
                    items[latestActive].update(null, true)
                }
            });

            editors.push(editor);
        });

        resolve();
    });
}

function eventSetting(){
    // 左サイドバー上のボタン類に対するイベントを設定する
    let open  = document.querySelector('#open');
    let play  = document.querySelector('#play');
    let stop  = document.querySelector('#stop');
    let layout  = document.querySelector('#layout');

    open.addEventListener('click', () => {
        // 変更済みのソースコードがある場合、開く前に尋ねる
        if(latestResponse != null && latestActive != null && items[latestActive].changes === true){
            let message = 'ソースコードの変更後、一度も実行していない変更は破棄されます。\n新規プロジェクトを開いてよろしいですか？';
            nativeDialog('info', message)
            .then((res) => {
                if(res > 0){
                    nativeOpenDirectory();
                }
            });
        }else{
            nativeOpenDirectory();
        }
    }, false);
    play.addEventListener('click', () => {
        // Command + s と同等
        saveEditorSource();
    });
    stop.addEventListener('click', () => {
        // iframe の中身だけをリセットする
        clearFrame();
        setStatusBarMessage('clear frame');
        setStatusBarIcon('#windowinterfacestatusfile', 'green', false, 'clear frame');
    });
    layout.addEventListener('click', () => {
        swapLayout();
    });
}

/**
 * Electron を経由してネイティブ（かつモーダル）なダイアログを出す
 * @param {string} title - タイトル
 * @param {string} message - ダイアログのメッセージ本文
 * @param {Array.<string>} [buttons] - 省略時は OK, cancel になる
 *
 */
function nativeDialog(title, message, buttons){
    return new Promise((resolve) => {
        ipcRenderer.once('nativedialog', (arg, res) => {
            resolve(res);
        });
        ipcRenderer.send('nativedialog', {title: title, message: message, buttons: buttons});
    });
}

/**
 * メインプロセスにプロジェクトのパスを送信する
 * @param {string} path - ドロップなどでクライアント側で発生した開きたいプロジェクトのパス
 */
function nativeSendPath(path){
    setServerRunningListener();
    ipcRenderer.send('sendpath', {targetPath: path});
}

/**
 * ローカルのディレクトリを開くダイアログを出す。
 * メインプロセス側でファイル構成のチェックなどを行ってくれるので、クライアント
 * 側では localserverrunning をリッスンして待機する。
 */
function nativeOpenDirectory(){
    setServerRunningListener();
    ipcRenderer.send('opendirectory');
}

/**
 * ローカルサーバが起動した際に発火する localserverrunning を once でリッスンす
 * るリスナーを設定する。このとき、読み込んだファイルの情報一覧と共に情報が返さ
 * れるのでこれを参照し、ファイルの情報が得られた場合はサーバ実装側でローカルサ
 * ーバが起動しているはずである。
 * ポート番号はレスポンスに含まれるため、iframe には `http://localhost:port/dirname`
 * のように URL を指定することができる。
 */
function setServerRunningListener(){
    ipcRenderer.once('localserverrunning', (arg, res) => {
        if(res === false){
            // キャンセルされた場合
            setStatusBarMessage('cancel on project open dialog');
        }else if(res.hasOwnProperty('err') === true){
            // 何かしらのエラー
            setStatusBarMessage(`Error: ${res.err}`);
            setStatusBarIcon('#windowinterfacestatuslocalserver', 'green', false, '');
            setStatusBarIcon('#windowinterfacestatuslocalserver', 'yellow', false, '');
            setStatusBarIcon('#windowinterfacestatuslocalserver', 'red', true, 'project open failed');
            nativeDialog('error', 'ソースコードの構成が正しくないためプロジェクトを開けませんでした。', ['OK']);
        }else{
            // レスポンスの内容を確認
            if(Array.isArray(res.dirs) !== true || res.dirs.length === 0){
                setStatusBarMessage(`Error: ${res.err}`);
                setStatusBarIcon('#windowinterfacestatuslocalserver', 'green', false, '');
                setStatusBarIcon('#windowinterfacestatuslocalserver', 'yellow', false, '');
                setStatusBarIcon('#windowinterfacestatuslocalserver', 'red', true, 'project open failed');
                nativeDialog('error', 'ソースコードの構成が正しくないか不正なプロジェクトです。', ['OK']);
                return;
            }
            setStatusBarMessage(`open project: [ ${res.pwd} ] | port: [ ${res.port} ]`)
            setStatusBarIcon('#windowinterfacestatuslocalserver', 'red', false, '');
            setStatusBarIcon('#windowinterfacestatuslocalserver', 'yellow', false, '');
            setStatusBarIcon('#windowinterfacestatuslocalserver', 'green', true, 'project open success');
            // 開く前にすべてをリセット
            clearFrame();
            clearList();
            clearEditor();
            let left = document.querySelector('#listblock');
            items = [];
            latestResponse = res;
            latestResponse.dirs.forEach((v, index) => {
                let item = new Component.Item(left, index, v.dirName, false);
                items[index] = item;
                item.on('click', (idx) => {
                    const update = () => {
                        generateEditor(latestResponse.dirs[idx].data);
                        latestActive = idx;
                        items.forEach((w, i) => {
                            w.update(false, false);
                        });
                        item.update(true, false);
                        setFrameSource(idx);
                        setStatusBarMessage(`start: [ ${latestResponse.dirs[idx].dirName} ]`);
                        setStatusBarIcon('#windowinterfacestatusfile', 'red', false, '');
                        setStatusBarIcon('#windowinterfacestatusfile', 'yellow', false, '');
                        setStatusBarIcon('#windowinterfacestatusfile', 'green', true, 'start success');
                    };
                    // ソースコードに変更が加えられているかどうかなどにより分岐する
                    if(latestActive != null && idx !== latestActive && items[latestActive].changes === true){
                        let message = `現在のソースコード[ ${latestResponse.dirs[latestActive].dirName} ]に変更が加えられています。\n[ ${latestResponse.dirs[idx].dirName} ] を読み込むとその変更は破棄されます。読み込みを開始してよろしいですか？`;
                        nativeDialog('info', message)
                        .then((res) => {
                            if(res > 0){
                                update();
                            }
                        });
                    }else{
                        if(idx === latestActive && items[latestActive].changes === true){
                            // 現在のソースに変更が加えられているときに現在のソースを選択した場合
                            // フレームだけを更新してリスト等は操作しない
                            setFrameSource(idx);
                            setStatusBarMessage(`start: [ ${latestResponse.dirs[idx].dirName} ]`);
                            setStatusBarIcon('#windowinterfacestatusfile', 'red', false, '');
                            setStatusBarIcon('#windowinterfacestatusfile', 'yellow', false, '');
                            setStatusBarIcon('#windowinterfacestatusfile', 'green', true, 'start success');
                        }else{
                            update();
                        }
                    }
                });
            });
        }
    });
}

/**
 * サーバ実装側で起動したローカルサーバを停止する
 */
function nativeCloseServer(){
    ipcRenderer.once('localserverclosed', (arg, res) => {
        clearFrame();
        clearList();
        clearEditor();
        setStatusBarMessage(`local server closed`)
        setStatusBarIcon('#windowinterfacestatuslocalserver', 'green', false, '');
    });
    ipcRenderer.send('closelocalserver');
}

/**
 * iframe の中身をクリアする
 */
function clearFrame(){
    let frame = document.querySelector('#frame');
    if(frame != null){
        frame.contentWindow.removeEventListener('keydown', frameListener);
        frameListener = null;
        frame.src = 'about:blank';
        vsplit.second.removeChild(frame);
        frame = null;
    }
    frame = document.createElement('iframe');
    frame.setAttribute('id', 'frame');
    vsplit.second.appendChild(frame);
}

/**
 * 左サイドバー上のディレクトリ名一覧を削除する
 */
function clearList(){
    let left = document.querySelector('#listblock');
    while(left.children.length > 0){
        left.removeChild(left.children[0]);
    }
}

/**
 * エディタの中身をすべてクリアする
 */
function clearEditor(){
    latestResponse = null;
    latestActive = null;
    editors.forEach((v, index) => {
        v.setValue('', -1);
    });
}

/**
 * エディタを生成する
 */
function generateEditor(data){
    return new Promise((resolve) => {
        if(split == null || split.second == null || data == null){return;}
        while(split.second.children.length > 0){
            let c = split.second.removeChild(split.second.firstChild);
            c = null;
        }
        let titles = getTitleArray(data);
        activeTabIndex = 0;
        tabStrip = null;
        tabStrip = new Component.TabStrip(split.second, titles, 0);
        tabStrip.on('change', (activeIndex) => {
            activeTabIndex = activeIndex;
            editors.forEach((v) => {
                v.resize();
            });
        });
        isGeneration = true;
        pages = tabStrip.getAllPage();
        editorSetting(data)
        .then(() => {
            setEditorSource(data);
            isGeneration = false;
            resolve();
        });
    });
}

/**
 * レスポンスの情報をエディタに反映する
 */
function setEditorSource(data){
    let titles = getTitleArray(data);
    titles.forEach((v, index) => {
        editors[index].setValue(data[v].data, -1);
    });
    editors[0].focus();
}

/**
 * エディタの情報をレスポンスに反映したのちサーバにプッシュし物理的にファイルを保存する
 */
function saveEditorSource(){
    if(latestResponse == null || latestActive == null){return;}
    let titles = getTitleArray(latestResponse.dirs[latestActive].data);
    titles.forEach((v, index) => {
        latestResponse.dirs[latestActive].data[v] = {data: editors[index].getValue(), exists: true};
    });
    ipcRenderer.once('savefile', (res) => {
        if(res.hasOwnProperty('err') === true){
            setStatusBarMessage(`Error: ${res.err}`);
            setStatusBarIcon('#windowinterfacestatusfile', 'green', false, '');
            setStatusBarIcon('#windowinterfacestatusfile', 'yellow', false, '');
            setStatusBarIcon('#windowinterfacestatusfile', 'red', true, 'save file failed');
            nativeDialog('error', 'ファイルを保存できませんでした。', ['OK']);
        }else{
            setStatusBarMessage(`save project: [ ${latestResponse.dirs[latestActive].dirName} ]`);
            setStatusBarIcon('#windowinterfacestatusfile', 'red', false, '');
            setStatusBarIcon('#windowinterfacestatusfile', 'yellow', false, '');
            setStatusBarIcon('#windowinterfacestatusfile', 'green', true, 'save file success');
            items[latestActive].update(null, false);
            setFrameSource(latestActive);
        }
    });
    ipcRenderer.send('saveproject', latestResponse.dirs[latestActive]);
}

/**
 * iframe に URL を設定しロードする
 */
function setFrameSource(index){
    clearFrame();
    let frame = document.querySelector('#frame');
    frame.src = `http://localhost:${latestResponse.port}/${latestResponse.dirs[index].dirName}?date=${Date.now()}`;
    frameListener = (evt) => {
        if(evt.key === 'F11'){
            evt.preventDefault();
            toggleFullScreen();
        }
    };
    setTimeout(() => {
        if(frame.contentWindow == null){return;}
        frame.contentWindow.addEventListener('keydown', frameListener, false);
    }, 500);
}

/**
 * iframe のサイズを設定する
 */
function setFrameSize(){
    let frame = document.querySelector('#frame');
    if(frame == null){return;}
    let bound = frame.parentElement.getBoundingClientRect();
    frame.width = bound.width;
    frame.height = bound.height;
}

/**
 * フルスクリーンモード
 */
function toggleFullScreen(flag){
    let header = document.querySelector('#windowinterfaceheader');
    let footer = document.querySelector('#windowinterfacefooter');
    new Promise((resolve) => {
        ipcRenderer.once('setkiosk', (evt, arg) => {
            resolve();
        });
        if(flag == null){
            kiosk = !kiosk;
        }else{
            kiosk = flag;
        }
        ipcRenderer.send('kioskmode', kiosk);
    })
    .then(() => {
        if(kiosk === true){
            header.style.display = 'none';
            footer.style.display = 'none';
            // 上下分割は前者を表示
            split.show(false, true);
            // 上段の左右分割は後者を表示
            vsplit.show(false, false);
        }else{
            header.style.display = '';
            footer.style.display = '';
            split.show(true);
            vsplit.show(true);
        }
        if(latestResponse != null && latestActive != null){
            setFrameSource(latestActive);
        }
    });
}

/**
 * FileAPI と FileReaderAPI でディレクトリ判定
 */
function isDirectory(target){
    return new Promise((resolve) => {
        if(target.type !== ''){
            resolve(false);
        }else{
            const reader = new FileReader();
            reader.onloadend = () => {
                if(reader.error != null){
                    resolve(true);
                }else{
                    resolve(false);
                }
            };
            reader.readAsBinaryString(target);
        }
    });
}
