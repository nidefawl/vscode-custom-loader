const vscode = require('vscode');

// This should not be allowed from extensions:
const amdLoader = module['parent'].exports;
const { RPCProtocol } = amdLoader('vs/workbench/services/extensions/common/rpcProtocol');

const __CONTRIB_REG_NAME = 'contrib-reg';

function _override(where, name, cb) {
  const prevFunc = where.prototype[name];
  where.prototype[name] = function () {
    let prevThis = this;
    let prevArgs = arguments;
    let res = cb.apply(this,
      [() => prevFunc.apply(prevThis, prevArgs)]
    );
    return res;
  };
  return function () {
    where.prototype[name] = prevFunc;
  };
}


/**
 * Basic IPC handler.
 * Will be registered to ID created by getOrRegisterProxyIdentifier
 * Interface must be identical for registered proxy identifier IDs
 */
class RPCChannelHandler_ExtHost {
  constructor() {
    this.channels = {};
  }
  setProxy(rpcHandlerProxy) {
    this.rpcHandlerProxy = rpcHandlerProxy;
  }
  registerChannelHandler(srcExtId, handler) {
    handler['send'] = (...args) => this.send([srcExtId, ...args]);
    this.channels[srcExtId] = handler;
  }
  uregisterChannels(srcExtId) {
    this.channels[srcExtId] = undefined;
  }
  /* Incoming */
  $recv(args) {
    if (args.length) {
      const chan = this.channels[args[0]];
      if (chan) {
        return chan.recv(args);
      }
    }
    extensionLog("RPC Message has not been handled")
    console.warn('$recv', 'Message has not been handled', args, this.channels);
    return "Message has not been handled";
  }
  /* Outgoing */
  send(args) {
    return this.rpcHandlerProxy.$recv(args);
  }
}

/**
 * may not be called before extension host was created.
 * returns same identifier on subsequent calls
 */
const getOrRegisterProxyIdentifier = (() => {
  let registeredProxyIdentifier = null;
  function getOrRegister() {
    const {ProxyIdentifier} = amdLoader('vs/workbench/services/extensions/common/proxyIdentifier');
    if (!registeredProxyIdentifier) {
      registeredProxyIdentifier = new ProxyIdentifier(true, 'customLoader');
    }
    return registeredProxyIdentifier;
  }
  return getOrRegister;
})();


var logChannel = null;
/**
 * @param {any} msg
 */
function extensionLog(msg) {
  if (!logChannel)
    logChannel = vscode.window.createOutputChannel('CustomLoader');
  logChannel?.appendLine(msg)
  console.log(msg);
}

class VsCodeCustomizeExtension {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.ctxt = context;
    const ext = this;
    this.rpcPromise = new Promise((resolve, reject) => {
      let disposeOverride = undefined;
      disposeOverride = _override(RPCProtocol, '_receiveRequest', function _hookRpcRecvReq(prevFunc) {
        try {
          disposeOverride();
          ext._createRpcChannelHandler(this);
          resolve(this);
        } catch (error) {
          reject(error);
        }
        return prevFunc();
      });
    }).catch((error) => {
      console.error('RPC Hook failed', error);
      extensionLog('RPC Hook failed');
    });

    let cmdPatch = vscode.commands.registerCommand('vscode-custom-loader.patchinstallation', this._patchInstallation, this);
    let cmdReset = vscode.commands.registerCommand('vscode-custom-loader.reset', this._resetRegistry, this);
    let cmdDump = vscode.commands.registerCommand('vscode-custom-loader.show', this._dumpRegistry, this);

    this.ctxt.subscriptions.push(logChannel, cmdPatch, cmdReset, cmdDump);
  }
  _createRpcChannelHandler(rpcProtocol) {
      //TODO register disposable to handle extension host exit
      // rpcProtocol._register({dispose: ()=>{}});
      this.rpcChannelHandler = new RPCChannelHandler_ExtHost(rpcProtocol);

      let timeout = setTimeout(() => {
        const msg = 'Custom Loader hook is not installed. Do you want to install the required patch now?';
        extensionLog(msg);
        vscode.window.showInformationMessage(msg, {}, 'Install Patch', 'Ignore').
          then((response)=>{
            if (response == 'Install Patch') {
              return vscode.commands.executeCommand('vscode-custom-loader.patchinstallation');
            }
          });
          
        }, 12000);
        this.rpcChannelHandler.registerChannelHandler('customloader', {
        recv: function(args) {
          if (args[1] == 'init') {
            if (timeout) {
              clearTimeout(timeout);
              timeout = null;
            }
            // extensionLog('Custom Loader received init');
            this.send('initreply');
          }
        }
      });

      // don't swap next 2 calls!
      rpcProtocol.set(getOrRegisterProxyIdentifier(), this.rpcChannelHandler);
      const rpcHandlerProxy = rpcProtocol.getProxy(getOrRegisterProxyIdentifier());
      this.rpcChannelHandler.setProxy(rpcHandlerProxy);

  }

  _patchInstallation() {
    extensionLog("Patch bootstrap-window.js");
    try {
      const njspath = require('path');
      const njsfs = require('fs');
      const pathVsCodeInstallation = require.main.path;
      const pathBoostrapWindowJs = njspath.join(pathVsCodeInstallation, 'bootstrap-window.js');
      const pathBoostrapWindowJsBak = njspath.join(pathVsCodeInstallation, 'bootstrap-window.js.without-customloader');
      const pathPatchTemplate = this.ctxt.asAbsolutePath('patch/bootstrap-window-patch.js');
      let pathHookModule = this.ctxt.asAbsolutePath('hook');
      if (njspath.sep != njspath.posix.sep) // replace backslash with forward on win32
        pathHookModule = pathHookModule.split(njspath.sep).join(njspath.posix.sep);

      if (![pathBoostrapWindowJs, pathPatchTemplate].every(p=>njsfs.statSync(p).isFile)
          || ![pathVsCodeInstallation, pathHookModule].every(p=>njsfs.statSync(p).isDirectory)) {
        throw Error(`Some files are missing. Maybe reinstall the extension`);
      }

      const srcPatchTemplate = njsfs.readFileSync(pathPatchTemplate, {encoding: 'utf8', flag: 'r'});
      const srcBootstrapWindowJs = njsfs.readFileSync(pathBoostrapWindowJs, {encoding: 'utf8', flag: 'r'});
    
      const loaderCode = srcPatchTemplate.replace('<absPathHookModule>', pathHookModule);
      const regexPatchGreedy = /([\s\S]+?)(\/\/BEGIN PATCH LOADER[\s\S]+\/\/END PATCH LOADER)([\s\S]+)/;
      const srcMatches = srcBootstrapWindowJs.match(regexPatchGreedy);
      let before, after;
      if (!srcMatches) {
        before = srcBootstrapWindowJs;
        before += '\n';
        after = '\n';
      } else {
        if (!(srcMatches?.length == 4) || !(srcMatches[3]===''&& srcMatches[2]===undefined || srcMatches.every((v)=>typeof(v)==='string'))) {
          throw Error(`Unexpected state of file ${pathBoostrapWindowJs}.\nMaybe try a fresh VSCode installation`);
        }
        before = srcMatches[1];
        after = srcMatches.length === 4 && srcMatches[3].length > 0 ? srcMatches[3] : '\n';
      }
    
      // Backup bootstrap-window.js once (Tho this way the file might be outdated if VSCode updates)
      try {
        njsfs.copyFileSync(pathBoostrapWindowJs, pathBoostrapWindowJsBak, njsfs.constants.COPYFILE_EXCL)
      } catch (error) {
        if (error.code !== 'EEXIST')
          throw error;
      }
    
      let contentsPatched = before;
      contentsPatched += loaderCode;
      contentsPatched += after;

      njsfs.writeFileSync(pathBoostrapWindowJs, contentsPatched, {encoding: 'utf8', flag: 'w'});

      extensionLog(`Patched ${pathBoostrapWindowJs} to load ${pathHookModule}`);
      return vscode.window.showInformationMessage('Patched bootstrap-window.js. Please reload the window', {}, 'Reload window', 'Ignore').
        then((response)=>{
          if (response == 'Reload window') {
            return vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
    } catch (error) {
      extensionLog("Patching bootstrap-window failed");
      extensionLog(''+error);
      logChannel?.show(false);
      return vscode.window.showInformationMessage(`Error occured while installing patch. See log channel for more information`);
    }
  }

  _resetRegistry() {
    extensionLog("Reset registry");
    this.ctxt.globalState.update(__CONTRIB_REG_NAME, []);
    vscode.window.showInformationMessage(`Reset registry`);
  }

  _dumpRegistry() {
    let apiReg = this.ctxt.globalState.get(__CONTRIB_REG_NAME, []);
    console.log(apiReg);
    extensionLog(JSON.stringify(apiReg, null, 2));
    logChannel?.show(false);
  }
  
  async registerRpcHandler(srcExtId, handler) {
    await this.rpcPromise;
    return this.rpcChannelHandler.registerChannelHandler(srcExtId, handler);
  }

  registerContribution(srcExtId, moduleList) {
    let apiReg = this.ctxt.globalState.get(__CONTRIB_REG_NAME, []);
    let extReg = apiReg.find((v)=>v.id==srcExtId);
    let modified = false;
    if (extReg) {
      modified = JSON.stringify(extReg.modules) !== JSON.stringify(moduleList);
      extReg.modules = moduleList;
    } else {
      modified = true;
      extReg = {id: srcExtId, enabled: true, errors: undefined, modules: moduleList}
      apiReg.push(extReg);
    }
    this.ctxt.globalState.update(__CONTRIB_REG_NAME, apiReg);
    if (modified) {
      extensionLog(`registerContribution from ${srcExtId}`);
      vscode.window.showInformationMessage('New extension registered. Please reload the window', {}, 'Reload window', 'Ignore').
        then((response)=>{
          if (response == 'Reload window') {
            return vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
    }
  }
  unregisterContributions(srcExtId) {
    extensionLog(`unregisterContribution from ${srcExtId}`);
    const apiReg = this.ctxt.globalState.get(__CONTRIB_REG_NAME);
    delete apiReg[srcExtId];
    this.ctxt.globalState.update(__CONTRIB_REG_NAME, apiReg);
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  const ext = new VsCodeCustomizeExtension(context);
  const api = {
    registerContribution: ext.registerContribution.bind(ext),
    unregisterContributions: ext.unregisterContributions.bind(ext),
    registerRpcHandler: ext.registerRpcHandler.bind(ext)
  };
  return api;
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
