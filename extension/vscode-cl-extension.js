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
    logChannel?.appendLine("RPC Message has not been handled")
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
  logChannel?.appendLine(msg)
  console.log(msg);
}

class VsCodeCustomizeExtension {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    logChannel = vscode.window.createOutputChannel('CustomLoader');
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
      logChannel?.appendLine('RPC Hook failed');
    });

/*     vscode.workspace.onDidChangeConfiguration(evt => {
      if (evt.affectsConfiguration('vscodecustomloader')) {
        console.log('configuration changed');
      }
    }, this, this.ctxt.subscriptions); */

    let cmdReset = vscode.commands.registerCommand('vscode-custom-loader.reset', this._resetRegistry, this);
    this.ctxt.subscriptions.push(logChannel);
    this.ctxt.subscriptions.push(cmdReset);

    // extensionLog(`${this.ctxt.extension.id} installed at ${this.ctxt.asAbsolutePath('vscode-extension.js')}`);
  }
  _createRpcChannelHandler(rpcProtocol) {
      //TODO register disposable to handle extension host exit
      // rpcProtocol._register({dispose: ()=>{}});
      this.rpcChannelHandler = new RPCChannelHandler_ExtHost(rpcProtocol);

      let timeout = setTimeout(() => {
        const msg = 'Custom Loader hook is not installed.\n\nPlease patch bootstrap-window.js';
        extensionLog(msg);
          vscode.window.showInformationMessage(msg);
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


  _resetRegistry() {

    extensionLog(this.ctxt.extension);
    this.ctxt.globalState.update(__CONTRIB_REG_NAME, []);
    vscode.window.showInformationMessage(`Reset registry`);
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
      vscode.window.showInformationMessage('New extension registered\nPlease reload the window', {}, 'Reload window', 'Ignore').
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
