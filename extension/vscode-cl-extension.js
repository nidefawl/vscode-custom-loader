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
 const extHostIpcHandler = new class {
  constructor() {
  }
  $handleMessage(args) {
    console.warn('$handleMessage', args);
    return Promise.resolve("hi from extension");
  }
};

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

function installRpc(rpcProtocol, ext) {
  //TODO register disposable to handle extension host exit
  // rpcProtocol._register({dispose: ()=>{}});
  rpcProtocol.set(getOrRegisterProxyIdentifier(), extHostIpcHandler);
  const ipcHandlerProxy = rpcProtocol.getProxy(getOrRegisterProxyIdentifier());
  let timer = setInterval(()=>{
    try {
      ipcHandlerProxy.$handleMessage(['test from extension', Math.random()]);
    } catch (error) {
      console.error(error);
      clearTimeout(timer);
    }
  }, 10000);
}


var logChannel = null;
/**
 * @param {any} msg
 */
function extensionLog(msg) {
  logChannel?.appendLine(msg)
  console.log(msg);
}

class VsCodeCustomizeExtension {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.ctxt = context;

    logChannel = vscode.window.createOutputChannel('CustomLoader');
    vscode.workspace.onDidChangeConfiguration(evt => {
      if (evt.affectsConfiguration('vscodecustomloader')) {
        console.log('configuration changed');
      }
    }, this, this.ctxt.subscriptions);
    let cmdReset = vscode.commands.registerCommand('vscode-custom-loader.reset', this.resetRegistry, this);
    this.ctxt.subscriptions.push(logChannel);
    this.ctxt.subscriptions.push(cmdReset);

    extensionLog(this.ctxt.extension.packageJSON.displayName);
    extensionLog(`${this.ctxt.extension.id} installed at ${this.ctxt.asAbsolutePath('vscode-extension.js')}`);
  }

  installRpc() {
    let ext = this;
    let disposeOverride = undefined;
    disposeOverride = _override(RPCProtocol, '_receiveRequest', function _hookRpcRecvReq(prevFunc) {
      try {
        disposeOverride();
        console.log('_receiveRequest hook');
        installRpc(this, ext);
      } catch (error) {
        console.log(error);
      }
      return prevFunc();
    });
  }

  resetRegistry() {

    extensionLog(this.ctxt.extension);
    this.ctxt.globalState.update(__CONTRIB_REG_NAME, []);
    vscode.window.showInformationMessage(`Reset registry`);
  }

  registerContribution(srcExtId, moduleList) {
    extensionLog(`registerContribution from ${srcExtId}`);
    let apiReg = this.ctxt.globalState.get(__CONTRIB_REG_NAME, []);
    let extReg = apiReg.find((v)=>v.id==srcExtId);
    if (extReg) {
      extReg.modules = moduleList;
    } else {
      extReg = {id: srcExtId, enabled: true, errors: undefined, modules: moduleList}
      apiReg.push(extReg);
    }

    this.ctxt.globalState.update(__CONTRIB_REG_NAME, apiReg);
  }
  unregisterContributions(srcExtId) {
    extensionLog(`unregisterContribution from ${srcExtId}`);
    const apiReg = this.ctxt.globalState.get(__CONTRIB_REG_NAME);
    delete apiReg[srcExtId];
    this.ctxt.globalState.set(__CONTRIB_REG_NAME, apiReg);
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  const ext = new VsCodeCustomizeExtension(context);
  ext.installRpc();
  const api = {
    registerContribution: ext.registerContribution.bind(ext),
    unregisterContributions: ext.unregisterContributions.bind(ext)
  };
  return api;
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
