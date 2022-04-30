const vscode = require('vscode');
const nodeFsPath = require('path');
const { commands, workspace, window, Uri } = vscode;

const moduleList = [
  "vscode-background-image/main.js",
  "vscode-background-image/ws-background-image.css",
  "vscode-background-image/ws-transparent-parts.css",
  "vscode-background-image/ws-compact-layout.css"
];

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  let extRef = null;
  let rpcChannel = null;
  let cachedImageList = null;

  async function getLoaderAPI() {
    if (!extRef) {
      const vsc = vscode.extensions.getExtension('nidefawl.vscode-custom-loader');
      extRef = await vsc.activate(); // a noop if ext is already active, return value is api
    }
    return extRef;
  }
  async function lazyGetRPCChannel() {
    if (!rpcChannel) {
      rpcChannel = {
        recv(args) {
        }
        /* send(args) will be added by API */
      };
      const loader = await getLoaderAPI();
      await loader.registerRpcHandler(context.extension.id, rpcChannel);
    }
    return rpcChannel;
  }
  async function readDirectoryImagelist(cb) {
    let backgroundImageFolder = getConfigStringOrUndefined('backgroundimage.folder');
    if (!backgroundImageFolder) {
      const result = await window.showInformationMessage('Please configure image folder', {}, 'Set image folder', 'Ignore');
      if (result === 'Set image folder') {
        backgroundImageFolder = await commands.executeCommand('backgroundimage.cmd.setfolder');
      } else {
        return undefined;
      }
    }
    let imgFolderUri = undefined;
    if (backgroundImageFolder) {
      imgFolderUri = Uri.file(backgroundImageFolder);
    }
    if (!imgFolderUri) {
      return undefined;
    }
    return workspace.fs.readDirectory(imgFolderUri).then(async (namesTypes) => {
      const filenamesFound = namesTypes
        .filter((entry) => entry[1] !== vscode.FileType.Directory)
        .map((entry) => entry[0]);

      return cb(filenamesFound, imgFolderUri);
    });
  }
  async function readDirectoryCachedImagelist(callback) {
    if (cachedImageList) {
      return callback(cachedImageList, Uri.file(workspace.getConfiguration().get('backgroundimage.folder')));
    }
    return readDirectoryImagelist(async (filenamesFound, imgFolderUri) => {
      cachedImageList = filenamesFound;
      return callback(filenamesFound, imgFolderUri);
    });
  }
  async function getImageByOffset(offset) {
    const backgroundImageCurrent = getConfigStringOrUndefined('backgroundimage.image');
    return await readDirectoryCachedImagelist(async (filenamesFound, imgFolderUri)=>{
      const curIndex = filenamesFound.indexOf(nodeFsPath.parse(backgroundImageCurrent).base);
      const listLen = filenamesFound.length;
      const offsetIndex = ((curIndex+offset)%listLen + listLen)%listLen
      if (filenamesFound[offsetIndex]) {
        const imageUri = Uri.joinPath(imgFolderUri, filenamesFound[offsetIndex]);
        return imageUri;
      }
      return undefined;
    });
  }
  /* vscode config returns '' for values that should be undefined */
  function getConfigStringOrUndefined(configPath) {
    const configValue = workspace.getConfiguration().get(configPath, undefined);
    if (typeof (configValue) === 'string' && configValue.length > 0) {
      return configValue;
    }
    return undefined;
  }
  async function setImageAndUpdateConfig(absPath) {
    try {
      await workspace.getConfiguration().update('backgroundimage.image', absPath);
    } catch (_) {
      /* ignore */
    }
  }
  let cmdDisp1 = commands.registerCommand(`backgroundimage.cmd.register`, async () => {
    const instance = await getLoaderAPI();
    instance.registerContribution(context.extension.id, moduleList)
  }, this);
  let cmdDisp2 = commands.registerCommand(`backgroundimage.cmd.unregister`, async () => {
    const instance = await getLoaderAPI();
    instance.unregisterContributions(context.extension.id)
  }, this);
  let cmdDispPrev = commands.registerCommand(`backgroundimage.cmd.prev`, async () => {
    const imguriOrUndef = await getImageByOffset(-1);
    if (imguriOrUndef) setImageAndUpdateConfig(imguriOrUndef.fsPath);
  }, this);
  let cmdDispNext = commands.registerCommand(`backgroundimage.cmd.next`, async () => {
    const imguriOrUndef = await getImageByOffset(1);
    if (imguriOrUndef) setImageAndUpdateConfig(imguriOrUndef.fsPath);
  }, this);
  let cmdDispToggle = commands.registerCommand(`backgroundimage.cmd.toggle`, async () => {
    const wsConfig = workspace.getConfiguration();
    let enabled = !wsConfig.get('backgroundimage.enabled', true);
    return wsConfig.update('backgroundimage.enabled', enabled);
  }, this);
  let cmdDispRandom = commands.registerCommand(`backgroundimage.cmd.pickRandom`, async () => {
    const imguriOrUndef = await getImageByOffset(Math.round(Math.random()*100000));
    if (imguriOrUndef) setImageAndUpdateConfig(imguriOrUndef.fsPath);
  }, this);

  let cmdDispPick = commands.registerCommand(`backgroundimage.cmd.pickimage`, async () => {
    return readDirectoryImagelist(async (filenamesFound, imgFolderUri) => {
      const backgroundImageCurrent = getConfigStringOrUndefined('backgroundimage.image');
      const currentDesc = backgroundImageCurrent ? `Current: ${backgroundImageCurrent}` : undefined;
      const clearDesc = `No background image`;
      const setImageFromPick = async (...args) => {
        const isPreview = args[0];
        const picked = args[1];
        const wsConfig = workspace.getConfiguration();
        const rpc = await lazyGetRPCChannel();
        if (picked == clearDesc) {
          if (!isPreview)
            await wsConfig.update('backgroundimage.enabled', false);
          else
            rpc.send('background', 'enable', false);
          return undefined;
        }
        if (typeof(picked) === 'string' && picked.length && picked !== currentDesc) {
          if (!isPreview)
            await wsConfig.update('backgroundimage.enabled', true);
          else
            rpc.send('background', 'enable', true);
          const imageUri = Uri.joinPath(imgFolderUri, picked);
          if (!isPreview)
            setImageAndUpdateConfig(imageUri.fsPath);
          else
            rpc.send('background', 'set', imageUri.fsPath);
          return imageUri.fsPath;
        }
        if (currentDesc && backgroundImageCurrent) {
          if (!isPreview)
            await wsConfig.update('backgroundimage.enabled', true);
          else
            rpc.send('background', 'enable', true);
          rpc.send('background', 'set', backgroundImageCurrent);
          return backgroundImageCurrent;
        }
        rpc.send('background', 'enable', false);
        return undefined;
      };
      const dlgOptions = {
        title: 'Select Background Image',
        placeHolder: 'Select Background Image',
        onDidSelectItem: setImageFromPick.bind(null, true)
      };
      const quickPickList = [];
      if (currentDesc) quickPickList.push(currentDesc);
      quickPickList.push(clearDesc, ...filenamesFound);
      return window.showQuickPick(quickPickList, dlgOptions).then(setImageFromPick.bind(null, false));
    });
  }, this);
  let cmdDispSetFolder = commands.registerCommand(`backgroundimage.cmd.setfolder`, async () => {
    const wsConfig = workspace.getConfiguration();

    const dlgOptions = {};
    const imagefolder = getConfigStringOrUndefined('backgroundimage.folder');
    if (imagefolder) {
      dlgOptions.defaultUri = Uri.file(imagefolder);
    }
    dlgOptions.title = 'Pick background image folder';
    dlgOptions.openLabel = 'Set image folder';
    dlgOptions.canSelectFiles = false;
    dlgOptions.canSelectFolders = true;
    dlgOptions.canSelectMany = false;

    await window.showOpenDialog(dlgOptions).then(async (uris) => {
      cachedImageList = null;
      if (uris && uris.length) {
        await wsConfig.update('backgroundimage.folder', uris[0].fsPath);
      }
    });
    return getConfigStringOrUndefined('backgroundimage.folder');
  }, this);

  context.subscriptions.push(cmdDisp1, cmdDisp2, cmdDispPrev, cmdDispNext, cmdDispToggle, cmdDispRandom, cmdDispPick, cmdDispSetFolder);

  let btn1 = window.createStatusBarItem("backgroundimage.statusbar.prev", vscode.StatusBarAlignment.Right, 5);
  let btn2 = window.createStatusBarItem("backgroundimage.statusbar.toggle", vscode.StatusBarAlignment.Right, 4);
  let btn3 = window.createStatusBarItem("backgroundimage.statusbar.next", vscode.StatusBarAlignment.Right, 3);
  let btn4 = window.createStatusBarItem("backgroundimage.statusbar.pickimage", vscode.StatusBarAlignment.Right, 2);

  btn1.text = "$(triangle-left)";
  btn1.command = 'backgroundimage.cmd.prev';
  btn1.name = btn1.tooltip = 'Previous background';
  btn2.text = "$(symbol-color)";
  btn2.command = 'backgroundimage.cmd.toggle';
  btn2.name = btn2.tooltip = 'Toggle background';
  btn3.text = "$(triangle-right)";
  btn3.command = 'backgroundimage.cmd.next';
  btn3.name = btn3.tooltip = 'Next background';
  btn4.text = "$(zap)";
  btn4.command = 'backgroundimage.cmd.pickimage';
  btn4.name = btn4.tooltip = 'Open picker';
  this.buttons = [btn1, btn2, btn3, btn4];
  context.subscriptions.push(btn1, btn2, btn3, btn4);

  this.buttons.forEach(element => {
    element.show();
  });

  this.timerImageUpdate = null;
  workspace.onDidChangeConfiguration(evt => {
    if (evt.affectsConfiguration('backgroundimage.folder')) {
      cachedImageList = null;
    }
    if (evt.affectsConfiguration('backgroundimage.randomDelay')) {
      if (this.timerImageUpdate !== null) {
        clearInterval(this.timerImageUpdate);
        this.timerImageUpdate = null;
      }
      const configValue = workspace.getConfiguration().get('backgroundimage.randomDelay', undefined);
      if (typeof (configValue) === 'number' && configValue > 0) {
        this.timerImageUpdate = setInterval(async () => {
          const isEnabled = workspace.getConfiguration().get('backgroundimage.enabled', true);
          if (isEnabled) {
            await commands.executeCommand('backgroundimage.cmd.pickRandom');
          }
        }, configValue * 1000);
      }
    }
    if (evt.affectsConfiguration('backgroundimage.enabled')) {
      lazyGetRPCChannel().then(rpc=>{
        const isEnabled = workspace.getConfiguration().get('backgroundimage.enabled', true);
        const backgroundImageCurrent = getConfigStringOrUndefined('backgroundimage.image');
        if (isEnabled && backgroundImageCurrent) {
          rpc.send('background', 'set', backgroundImageCurrent);
        }
        rpc.send('background', 'enable', isEnabled);
      });
    }
    if (evt.affectsConfiguration('backgroundimage.image')) {
      const backgroundImageCurrent = getConfigStringOrUndefined('backgroundimage.image');
      if (backgroundImageCurrent) {
        lazyGetRPCChannel().then(rpc=>{
          rpc.send('background', 'set', backgroundImageCurrent);
        });
      }
    }
  }, this, context.subscriptions);
  const instance = await getLoaderAPI();
  instance.registerContribution(context.extension.id, moduleList)

  lazyGetRPCChannel().then(rpc=>{
    let isFirstRun = context.globalState.get('isFirstRun', true);
    context.globalState.update('isFirstRun', false);
    const wsConfig = workspace.getConfiguration();
    const bgEnabled = wsConfig.get('backgroundimage.enabled', true);
    if (bgEnabled) {
      const backgroundImageCurrent = getConfigStringOrUndefined('backgroundimage.image');
      const backgroundImageFolder = getConfigStringOrUndefined('backgroundimage.folder');
      if (backgroundImageCurrent) {
        rpc.send('background', 'set', backgroundImageCurrent);
      } else if (isFirstRun && !backgroundImageFolder) {
        setTimeout(() => {
          wsConfig.update('backgroundimage.image', 'https://w.wallhaven.cc/full/j3/wallhaven-j3wqwm.jpg');
          window.showInformationMessage('You can now set a background image folder', {}, 'Set image folder', 'Ignore');
        }, 1500);
      }
      const configValue = workspace.getConfiguration().get('backgroundimage.randomDelay', undefined);
      if (typeof (configValue) === 'number' && configValue > 0) {
        this.timerImageUpdate = setInterval(async () => {
          const isEnabled = workspace.getConfiguration().get('backgroundimage.enabled', true);
          if (isEnabled) {
            await commands.executeCommand('backgroundimage.cmd.pickRandom');
          }
        }, configValue * 1000);
      }
    }
  });
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
