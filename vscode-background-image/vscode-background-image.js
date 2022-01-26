const vscode = require('vscode');
const nodeFsPath = require('path');
const { commands, workspace, window, Uri } = vscode;

const moduleList = [
  "vscode-background-image/main.js",
  "vscode-background-image/ws-background-image.css",
  "vscode-background-image/ws-transparent-parts.css"
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
    const wsConfig = workspace.getConfiguration();
    let imagefolder = wsConfig.get('backgroundimage.folder');
    if (typeof (imagefolder) !== 'string') {
      const result = await window.showInformationMessage('Please configure image folder', {}, 'Set image folder', 'Ignore');
      if (result === 'Set image folder') {
        imagefolder = commands.executeCommand('backgroundimage.cmd.setfolder');
      }
    }
    let imgFolderUri = undefined;
    if (typeof (imagefolder) === 'string') {
      imgFolderUri = Uri.file(imagefolder);
    }
    if (!imgFolderUri) {
      return;
    }
    return workspace.fs.readDirectory(imgFolderUri).then(async (namesTypes) => {
      const filenamesFound = namesTypes
        .filter((entry) => entry[1] !== vscode.FileType.Directory)
        .map((entry) => entry[0]);

      return cb(filenamesFound, imgFolderUri);

    });
  }
  async function readDirectoryImagelistCached(cb) {
    if (cachedImageList) {
      return cb(cachedImageList, Uri.file(workspace.getConfiguration().get('backgroundimage.folder')));
    }
    return readDirectoryImagelist(async (filenamesFound, imgFolderUri) => {
      cachedImageList = filenamesFound;
      return cb(filenamesFound, imgFolderUri);
    });
  }
  async function getImageByOffset(offset) {
    const backgroundImageCurrent = workspace.getConfiguration().get('backgroundimage.image');
    return await readDirectoryImagelistCached(async (filenamesFound, imgFolderUri)=>{
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
  async function setImageAndUpdateConfig(absPath) {
    const rpc = await lazyGetRPCChannel();
    rpc.send('background', 'set', absPath);
    workspace.getConfiguration().update('backgroundimage.image', absPath);
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
    wsConfig.update('backgroundimage.enabled', enabled);
    const rpc = await lazyGetRPCChannel();
    rpc.send('background', 'enable', enabled);
  }, this);

  let cmdDispPick = commands.registerCommand(`backgroundimage.cmd.pickimage`, async () => {
    return readDirectoryImagelist(async (filenamesFound, imgFolderUri) => {
        const dlgOptions = {
          title: 'Select Background Image',
          placeHolder: 'Select Background Image',
          onDidSelectItem: async (picked) => {
            if (typeof(picked) === 'string' && picked.length) {
              const rpc = await lazyGetRPCChannel();
              rpc.send('background', 'set', Uri.joinPath(imgFolderUri, picked).fsPath);
            }
          }
        };
        const backgroundImageCurrent = workspace.getConfiguration().get('backgroundimage.image');
        return window.showQuickPick(filenamesFound, dlgOptions).then(async (picked) => {
          let imagePicked = null;
          if (typeof (picked) === 'string') {
            imagePicked = picked;

          } else {
            imagePicked = backgroundImageCurrent;
          }
          if (typeof(imagePicked) === 'string' && imagePicked.length) {
            const imageUri = Uri.joinPath(imgFolderUri, imagePicked);
            setImageAndUpdateConfig(imageUri.fsPath);
            return imageUri.fsPath;
          }
          return undefined;
        });
    });
  }, this);
  let cmdDispSetFolder = commands.registerCommand(`backgroundimage.cmd.setfolder`, async () => {
    const wsConfig = workspace.getConfiguration();

    const dlgOptions = {};
    const imagefolder = wsConfig.get('backgroundimage.folder');
    if (typeof (imagefolder) === 'string') {
      dlgOptions.defaultUri = Uri.file(imagefolder);
    }
    dlgOptions.title = 'Pick background image folder';
    dlgOptions.openLabel = 'Set image folder';
    dlgOptions.canSelectFiles = false;
    dlgOptions.canSelectFolders = true;
    dlgOptions.canSelectMany = false;

    return window.showOpenDialog(dlgOptions).then(async (uris) => {
      cachedImageList = null;
      if (uris && uris.length) {
        await wsConfig.update('backgroundimage.folder', uris[0].fsPath);

        return uris[0].fsPath;
      }
      return null;
    });
  }, this);

  context.subscriptions.push(cmdDisp1, cmdDisp2, cmdDispPrev, cmdDispNext, cmdDispToggle, cmdDispPick, cmdDispSetFolder);

  let btn1 = window.createStatusBarItem("backgroundimage.statusbar.prev", vscode.StatusBarAlignment.Right, 5);
  let btn2 = window.createStatusBarItem("backgroundimage.statusbar.toggle", vscode.StatusBarAlignment.Right, 4);
  let btn3 = window.createStatusBarItem("backgroundimage.statusbar.next", vscode.StatusBarAlignment.Right, 3);
  let btn4 = window.createStatusBarItem("backgroundimage.statusbar.next", vscode.StatusBarAlignment.Right, 2);

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


  lazyGetRPCChannel().then(rpc=>{
    const wsConfig = workspace.getConfiguration();
    const enabled = wsConfig.get('backgroundimage.enabled', true);
    const backgroundImageCurrent = wsConfig.get('backgroundimage.image', null);
    if (typeof (backgroundImageCurrent) === 'string' && backgroundImageCurrent.length) {
      rpc.send('background', 'set', backgroundImageCurrent);
    }
    rpc.send('background', 'enable', enabled);
  });
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
