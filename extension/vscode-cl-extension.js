const vscode = require('vscode');

const net = require('net');

// This should not be allowed from extensions:
const amdLoader = module['parent'].exports;

const { PersistentProtocol, BufferedEmitter } = amdLoader('vs/base/parts/ipc/common/ipc.net');
const { NodeSocket, createRandomIPCHandle } = amdLoader('vs/base/parts/ipc/node/ipc.net');
const { RPCProtocol } = amdLoader('vs/workbench/services/extensions/common/rpcProtocol');

const colorTables = [
  ['#2977B1', '#FC802D', '#34A13A', '#D3282F', '#9366BA'],
  ['#8B564C', '#E177C0', '#7F7F7F', '#BBBE3D', '#2EBECD']
];
function prettyWithoutArrays(data) {
  if (Array.isArray(data)) {
      return data;
  }
  if (data && typeof data === 'object' && typeof data.toString === 'function') {
      let result = data.toString();
      if (result !== '[object Object]') {
          return result;
      }
  }
  return data;
}
function pretty(data) {
  if (Array.isArray(data)) {
      return data.map(prettyWithoutArrays);
  }
  return prettyWithoutArrays(data);
}

class RPCLogger {
  constructor() {
      this._totalIncoming = 0;
      this._totalOutgoing = 0;
      this._colored = false;
  }
  _log(direction, totalLength, msgLength, req, initiator, str, data) {
      data = pretty(data);
      const colorTable = colorTables[initiator];
      const color = this._colored ? colorTable[req % colorTable.length] : '#000000';
      let args = [`%c[${direction}]%c[${String(totalLength).padStart(7)}]%c[len: ${String(msgLength).padStart(5)}]%c${String(req).padStart(5)} - ${str}`,
                  'color: darkgreen', 'color: grey', 'color: grey', `color: ${color}`];
      if (/\($/.test(str)) {
          args = args.concat(data);
          args.push(')');
      }
      else {
          args.push(data);
      }
      console.log.apply(console, args);
  }
  logIncoming(msgLength, req, initiator, str, data) {
      this._totalIncoming += msgLength;
      if (str.startsWith('receiveRequest'))
        this._log('Win \u2192 ExtHost', this._totalIncoming, msgLength, req, initiator, str, data);
  }
  logOutgoing(msgLength, req, initiator, str, data) {
      this._totalOutgoing += msgLength;
      if (str.startsWith('request') && str.indexOf('logExtensionHostMessage')<0)
        this._log('ExtHost \u2192 Win', this._totalOutgoing, msgLength, req, initiator, str, data);
  }
}
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

function installRpc(rpcProtocol) {
  // rpcProtocol._logger = new RPCLogger();
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

let disposeOverride = undefined;
disposeOverride = _override(RPCProtocol, '_receiveRequest', function _hookRpcRecvReq(prevFunc) {
  try {
    disposeOverride();
    console.log('_receiveRequest hook');
    installRpc(this);
  } catch (error) {
    console.log(error);
  }
  return prevFunc();
});

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
    this.ipcPipeName = createRandomIPCHandle();

    logChannel = vscode.window.createOutputChannel('CustomLoader');
    vscode.workspace.onDidChangeConfiguration(evt => {
      if (evt.affectsConfiguration('vscodecustomloader')) {
        console.log('configuration changed');
      }
    }, this, this.ctxt.subscriptions);
    let disposeCmdHello = vscode.commands.registerCommand('vscode-custom-loader.helloWorld', this.cmdHello, this);
    this.ctxt.subscriptions.push(logChannel);
    this.ctxt.subscriptions.push(disposeCmdHello);

    extensionLog(this.ctxt.extension.packageJSON.displayName);
    extensionLog(`${this.ctxt.extension.id} installed at ${this.ctxt.asAbsolutePath('vscode-extension.js')}`);
  }
  //unused, just testing
  async createIpcServer() {
    const pipeName = this.ipcPipeName;
    return new Promise((resolve, reject) => {
        this._namedPipeServer = net.createServer();
        this._namedPipeServer.on('error', reject);
        this._namedPipeServer.listen(pipeName, () => {
            if (this._namedPipeServer) {
                this._namedPipeServer.removeListener('error', reject);
            }
            resolve(pipeName);
        });
    });
  }
  //unused, just testing
  async connectToIpcServer() {
    const pipeName = this.ipcPipeName;
    const createProtocolFromIpc = new Promise((resolve, reject) => {
      const socket = net.createConnection(pipeName, () => {
        socket.removeListener('error', reject);
        resolve(new PersistentProtocol(new NodeSocket(socket, 'vscode-extension')));
      });
      socket.once('error', reject);
      socket.on('close', () => {
        console.log('client closed the socket');
      });
    });

    const protocol = await createProtocolFromIpc;
    const extContext = this.ctxt;
    const ipcServer = new class {
        constructor() {
            this._onMessage = new BufferedEmitter();
            this.onMessage = this._onMessage.event;
            this._terminating = false;
            protocol.onMessage((msg) => {
              this._onMessage.fire(msg);
            });
            extContext.subscriptions.push({ dispose: ()=>{
                ipcServer._terminating = true;
                ipcServer.drain();
                protocol.sendDisconnect();
                protocol.dispose();
              }});
        }
        send(msg) {
            if (!this._terminating) {
                protocol.send(msg);
            }
        }
        drain() {
            return protocol.drain();
        }
    };
  }

  cmdHello() {
    vscode.window.showInformationMessage(`Hello World from ${this.ctxt.extension.packageJSON.displayName}`);

    extensionLog(this.ctxt.extension);
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    let editorOptions = editor.options;
    extensionLog(editorOptions)
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  const ext = new VsCodeCustomizeExtension(context);
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
