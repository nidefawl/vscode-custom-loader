'use strict';

const path = require('path');
const util = require('util');
const events = require('events');


function _overrideArgs(where, name, cb) {
  if (!where)
    throw new Error('type is null');
  if (!where.prototype)
    throw new Error('argument is not a type');
  const prevFunc = where.prototype[name];
  if (!prevFunc)
    throw new Error('type does not have a property named ' + name);
  where.prototype[name] = function () {
    let prevThis = this;
    let prevArgs = arguments;
    let res = cb.apply(this,
      [() => prevFunc.apply(prevThis, prevArgs), prevArgs]
    );
    return res;
  };
  return function () {
    where.prototype[name] = prevFunc;
  };
}

const DEBUG_EVT_HANDLERS = false;
const KEEP_RUNTIME_HOOKS = false;
const PRINT_LOG_INSTANCES = false;

const PROC_MAIN = 1;
const PROC_RENDER = 2;
const PROC_SHARED = 3;

function getCurrentProcName(processType) {
  if (processType == PROC_MAIN)
    return 'main';
  if (processType == PROC_RENDER)
    return 'renderer';
  if (processType == PROC_SHARED)
    return 'shared';
  return "unknown";
}

class Log {
  constructor(...cargs) {
    const makeLogFn = (fnName) => (...largs) => {
      console[fnName.toLowerCase()](`[${cargs.join('][')}]`, ...largs);
    };
    this.warn = makeLogFn('Warn');
    this.logErr = makeLogFn('Error');
    this.log = makeLogFn('Info');
  }
}

class VSCodeHook extends Log {
  constructor(processType, funcAmdLoader, globalObj) {
    super(getCurrentProcName(processType), 'VsCodeHook');
    this.hooksInstalled = false;
    this.evts = new events.EventEmitter();
    this.processType = processType;
    this.vsAmdLoader = funcAmdLoader;
    this.globalObj = globalObj;

    this.numRequires = 0;
    this.hookDisposeList = [];
    this.byName = new Map();
    this.byInstance = new Map();
    this.descrByName = new Map();
    this.nameByCtor = new Map();
    this.nameByDesc = new Map();
    this.registrySvcDesc = null;
    if (DEBUG_EVT_HANDLERS) {
      this.evts.on('instance', ()=>this._installDebugEvtHandlers());
    }
    if (PRINT_LOG_INSTANCES) {
      this.evts.on('instance', (typeName,_)=>console.warn(typeName));
    }
  }
  require(reqSvcName) {
    if (!KEEP_RUNTIME_HOOKS && this.hooksInstalled) {
      throw 'require must happen before hooks installed'
    }
    const _this = this;
    this.numRequires++;
    const req = new Promise((resolve, reject) => {
      const svcList = new Array(reqSvcName.length);
      const missingList = [];
      for (const svcName of reqSvcName) {
        const instance = this.byName.get(svcName);
        if (instance) {
          svcList[reqSvcName.indexOf(svcName)] = instance;
        } else {
          missingList.push(svcName);
        }
      }
      if (!missingList.length) {
        resolve(svcList);
        return;
      }
      const evtListener = (typeName, instance) => {
        const index = missingList.indexOf(typeName);
        if (index > -1) {
          svcList[reqSvcName.indexOf(typeName)] = instance;
          if (missingList.length <= 1) {
            _this.evts.off('instance', evtListener);
            resolve(svcList);
            return;
          }
          missingList.splice(index, 1);
        }
      };
      _this.evts.on('instance', evtListener);
    });
    req.then(()=>{
      _this.numRequires--;

      if (!KEEP_RUNTIME_HOOKS && _this.numRequires <= 0)
        this._uninstallHooks();
    });
    return req;
  }
  _createInternalAccess() {
    /* instance collection */
    const instances = {
      byName: this.byName,
      byInstance: this.byInstance,
      descrByName: this.descrByName,
      nameByCtor: this.nameByCtor,
      nameByDesc: this.nameByDesc,
      registrySvcDesc: this.registrySvcDesc
    };
    return instances;
  }

  _registerService(typeName, tInstance) {
    const isProxyNew = util.types.isProxy(tInstance);
    if (!isProxyNew) {
      if (tInstance['ctor']) {
        return false;
      }
    }
    if (!this.byInstance.has(tInstance) || !this.byName.has(typeName)) {
      let prevInst = this.byName.get(typeName);
      if (prevInst) {
        const isProxyPrev = util.types.isProxy(prevInst);
        if (!isProxyPrev && isProxyNew) {
          return false;
        }
      }
      this.byName.set(typeName, tInstance);
      this.byInstance.set(tInstance, typeName);
      return true;
    }
    return false;
  }

  _inspectObjects(ctorOrDescriptor, instanceOrSyncDescriptor, isDescriptor) {
    try {
      let typeName;
      if (isDescriptor) {
        typeName = ctorOrDescriptor.toString();
      } else if (typeof (ctorOrDescriptor) == 'function') {
        typeName = this.nameByCtor.get(ctorOrDescriptor);
        if (!util.types.isProxy(instanceOrSyncDescriptor)) {
          if (!typeName)
            typeName = this.nameByCtor.get(instanceOrSyncDescriptor.constructor);
          if (!typeName)
            typeName = instanceOrSyncDescriptor.name;
          if (!typeName || typeName.length < 3)
            typeName = instanceOrSyncDescriptor.constructor.name;
        }
        if (!typeName || typeName.length < 3)
          typeName = ctorOrDescriptor.toString();
      }
      if (!typeName || typeName.length > 55)
        return false;
      typeName = typeName[0].toUpperCase() + typeName.slice(1);
      if (this._registerService(typeName, instanceOrSyncDescriptor)) {
        this.evts.emit('instance', typeName, instanceOrSyncDescriptor);
        // this.cbNewInstances(typeName, instanceOrSyncDescriptor);
      }
    } catch (error) {
      this.logErr(error);
      this.logErr(error.stack);
    }
    return false;
  }

  _initServiceDescRegistry(vs_ext) {
    if (vs_ext && this.processType == PROC_RENDER) {
      this.registrySvcDesc = vs_ext.getSingletonServiceDescriptors();
      for (const reg of this.registrySvcDesc) {
        const servDescName = reg[0].toString();
        this.nameByCtor.set(reg[1].ctor, servDescName);
        this.descrByName.set(servDescName, reg[1]);
        this.nameByDesc.set(reg[1], servDescName);
      }
    }
  }

  installBootHooks() {
    this.hooksInstalled = true;
    if (!DEBUG_EVT_HANDLERS) {
      const timeout = 8000;
      setTimeout(()=> {
        if (this.numRequires > 0) {
          console.error(`${this.numRequires} require where not fullfilled after ${timeout}ms`);
        }
      }, timeout, this);
    }
    let moduleList = [
      'vs/platform/instantiation/common/serviceCollection',
      'vs/platform/instantiation/common/instantiationService'
    ];
    if (this.processType == PROC_RENDER) {
      moduleList.push('vs/platform/instantiation/common/extensions');// window only :(
    }
    const thisLoader = this;
    this.vsAmdLoader(
      moduleList,
      function (vs_sc, vs_is, vs_ext) {
        if (vs_ext) {
          thisLoader._initServiceDescRegistry(vs_ext);
        }
        thisLoader.globalObj.ALL = thisLoader._createInternalAccess();
        let inspectedServiceCollection = null;
        let hookDispose;
        hookDispose = _overrideArgs(vs_sc.ServiceCollection, 'set', function (prevFuncArgsApplied, prevArgs) {
          if (inspectedServiceCollection !== this) {
            inspectedServiceCollection = this;
            for (const [key, value] of this._entries) {
              if (util.types.isProxy(value) || value['ctor'] === undefined) {
                thisLoader._inspectObjects(key, value, true);
              }
            }
          }
          if (prevArgs.length > 1) {
            thisLoader._inspectObjects(prevArgs[0], prevArgs[1], true);
          }
          return prevFuncArgsApplied();
        });
        thisLoader.hookDisposeList.push(hookDispose);
        hookDispose = _overrideArgs(vs_is.InstantiationService, '_createServiceInstanceWithOwner', function (prevFuncArgsApplied, prevArgs) {
          const instance = prevFuncArgsApplied();
          if (prevArgs.length > 0) {
            thisLoader._inspectObjects(prevArgs[0], instance, true);
          }
          return instance;
        });
        thisLoader.hookDisposeList.push(hookDispose);
        hookDispose = _overrideArgs(vs_is.InstantiationService, 'createInstance', function (prevFuncArgsApplied, prevArgs) {
          const instance = prevFuncArgsApplied();
          if (prevArgs.length > 0) {
            thisLoader._inspectObjects(prevArgs[0], instance, false);
          }
          return instance;
        });
        thisLoader.hookDisposeList.push(hookDispose);
      }
    );
  }

  _uninstallHooks() {
    this.hookDisposeList.forEach(f => f());
  }

  _installDebugEvtHandlers() {
    // testing callbacks (debug only, they are never disposed!!)
    const _this = this;

    const lifecycleService = this.byName.get('LifecycleMainService');
    const codeWindow = this.byName.get('CodeWindow');
    const configService = this.byName.get('ConfigurationService');
    const workspaceService = this.byName.get('WorkspacesManagementMainService');

    if (codeWindow && !this.cwReadyHandlerInstalled) {
      this.cwReadyHandlerInstalled = true;
      codeWindow.onDidSignalReady(_ => _this.warn('codeWindow.onDidSignalReady'));
      codeWindow.onWillLoad(_ => _this.warn('codeWindow.onWillLoad'));
    }

    if (lifecycleService && !this.lcmsHandlerInstalled) {
      this.lcmsHandlerInstalled = true;

      lifecycleService.when(1).then(_ => _this.warn('lifecycleService.when(1)'));
      lifecycleService.when(2).then(_ => _this.warn('lifecycleService.when(2)'));
      lifecycleService.when(3).then(_ => _this.warn('lifecycleService.when(3)'));
      lifecycleService.onWillLoadWindow(_ => _this.warn('lifecycleService.onWillLoadWindow'));
    }

    if (configService && !this.cfgChangedHandlerInstalled) {
      this.cfgChangedHandlerInstalled = configService.onDidChangeConfiguration(_ => _this.warn('onDidChangeConfiguration'));
      configService.userConfiguration?.onDidChange(_ => _this.warn('userConfiguration.onDidChange'));
    }

    if (workspaceService && !this.wsEnterHandlerInstalled) {
      this.wsEnterHandlerInstalled = workspaceService.onDidEnterWorkspace(_ => _this.warn('onDidEnterWorkspace'));
    }
  }
}



function loadCustomModules(log, vsAmdLoader, configService) {
  const cfgModuleList = configService.getValue('vscodecustomloader.modulelist');
  if (!cfgModuleList || !Array.isArray(cfgModuleList) || cfgModuleList.length < 1) {
    log.warn(`Empty configuration. Please configure 'vscodecustomloader.modulelist'`);
    return;
  }

  const lcfg = vsAmdLoader.getConfig();

  // modify amdModulesPattern
  lcfg.amdModulesPattern = new RegExp(lcfg.amdModulesPattern.source.concat('|(^.*[/].*$)'));
  const vs_uri = vsAmdLoader('vs/base/common/uri');

  const baseUrl = lcfg.baseUrl;
  const basePath = vs_uri.URI.parse(baseUrl).fsPath;

  let loadModuleNames = [];
  const loadModulesPaths = {};
  const loadModulesCfg = {};
  for (const directoryCfg of cfgModuleList) {
    const dirRelative = path.relative(basePath, directoryCfg.path);
    for (const moduleCfg of directoryCfg.modules) {
      const modFileRelative = path.join(dirRelative, moduleCfg.file);
      loadModuleNames.push(moduleCfg.module);
      loadModulesPaths[moduleCfg.module] = modFileRelative;
      loadModulesCfg[moduleCfg.module] = {
        name: moduleCfg.module,
        file: moduleCfg.file,
        dir: directoryCfg.path,
        pathDir: dirRelative,
        pathFile: modFileRelative,
        basePath: basePath,
        baseUrl: baseUrl,
      }
    }
  }

  vsAmdLoader.config({
    paths: loadModulesPaths,
    config: loadModulesCfg,
  });

  vsAmdLoader(
    loadModuleNames,
    function (...modulesLoaded) {
      log.log('modules loaded', modulesLoaded);
    }, undefined);
}

exports.bootstrapWindow = () => {
  const globalObj = global;
  if (!window) return;
  if (!globalObj['MonacoBootstrapWindow']) return;
  if (!globalObj.MonacoBootstrapWindow?.load) return;
  if (!globalObj['require']) return;
  const processType = {
    'sharedProcess.html': PROC_SHARED,
    'workbench.html': PROC_RENDER,
  }[globalObj?.window?.location?.href.toString().split('/').pop()];

  if (!processType)
    return;

  const bootstrapLoadFunc = globalObj.MonacoBootstrapWindow.load;
  const vscHook = new VSCodeHook(processType, globalObj.require, globalObj);

  if (processType == PROC_RENDER) {
    vscHook.require(['LifecycleService', 'ConfigurationService']).then((services) => {
        const [lifecycleService, configService] = services;

        vscHook.warn('############################################');
        vscHook.warn('###        LifecycleService found        ###');
        vscHook.warn('###          ConfigService found         ###');
        vscHook.warn('############################################');

        lifecycleService.when(4).then(_ => {
          loadCustomModules(vscHook, vscHook.vsAmdLoader, configService);
        });
      });

    vscHook.require(['LifecycleService', 'NativeHostService']).then((services) => {
        const [lifecycleService, nativeHostService] = services;
        lifecycleService.when(4).then(_ => {
          // workaround for 'did-finish-load' firing early bug
          nativeHostService.notifyReady()
        });
      });
    vscHook.require(['MainProcessService']).then((services) => {
        const [mainProcessService] = services;
        mainProcessService.getChannel('customLoader').call('init', ['hi friend']);
        const onTestEvent = mainProcessService.getChannel('customLoader').listen('testevent', ['hi friend']);
        onTestEvent((...args)=>vscHook.log('testevent occured', args));
      });

    /**
     * Basic IPC handler.
     * Will be registered to ID created by getOrRegisterProxyIdentifier
     * Interface must be identical for registered proxy identifier IDs
     */
    const extHostIpcHandler = new class {
      constructor() {
        this.log = new Log(getCurrentProcName(processType), 'ExtHostIpcHandler');
      }
      $handleMessage(args) {
        this.log.warn('$handleMessage', args);
        return Promise.resolve("hi from renderer");
      }
    };

    /**
     * may not be called before extension host was created.
     * returns same identifier on subsequent calls
     */
    const getOrRegisterProxyIdentifier = (() => {
      let registeredProxyIdentifier = null;
      function getOrRegister() {
        const {ProxyIdentifier} = vscHook.vsAmdLoader('vs/workbench/services/extensions/common/proxyIdentifier');
        if (!registeredProxyIdentifier) {
          registeredProxyIdentifier = new ProxyIdentifier(true, 'customLoader');
        }
        return registeredProxyIdentifier;
      }
      return getOrRegister;
    })();

    function installRpc(rpcProtocol) {


      // this ready Promise is not of use, the extHostManager signals ready
      // before the process actually started
      // extHostManager.ready().then(()=>{ /* install... */ });


      //TODO register disposable to handle extension host exit
      // _rpcProtocol._register({dispose: ()=>{}});

      rpcProtocol.set(getOrRegisterProxyIdentifier(), extHostIpcHandler);
      const ipcHandlerProxy = rpcProtocol.getProxy(getOrRegisterProxyIdentifier());
      ipcHandlerProxy.$handleMessage(['Init message from renderer', Math.random()]);
      let timer = setInterval(()=>{
        try {
          ipcHandlerProxy.$handleMessage(['test from renderer', Math.random()]);
        } catch (error) {
          vscHook.logErr(error);
          clearTimeout(timer);
        }
      }, 60000);
    }

    /**
     * subscribe to extension host ready event.
     * this should play well with reconnecting after connection loss.
     */
    vscHook.require(['ExtensionService']).then((services) => {
        const [extensionService] = services;
        let subscr = null;
        //TODO handle extension host reloads
        //TODO handle extension enable/disable changes

        // sadly there is no onExtensionHostStarted event (for the local ext host)
        subscr = extensionService.onDidChangeExtensionsStatus((extensionIds)=>{

          const extHostManager = extensionService._getExtensionHostManager(0); // 0 == LocalProcess
          if (!extHostManager) {
            return;
          }

          const _rpcProtocol = extHostManager._rpcProtocol
          if (!_rpcProtocol) {
            return;
          }

          for (const extensionId of extensionIds) {
            if (extensionId.value.toLowerCase().indexOf("vscode-custom-loader")>-1) {
              subscr.dispose();
              installRpc(_rpcProtocol);
              break;
            }
          }
        });
      });
  }

  globalObj.MonacoBootstrapWindow.load = async function (modulePaths, resultCallback, options) {
    globalObj.require = Object.assign(function () {
      try {
        if (arguments?.length > 1 && arguments[0] === modulePaths) {
          // remove hook
          // @ts-ignore
          globalObj.require = vscHook.vsAmdLoader;

          // trigger bootstrapping
          const asyncOnLoadFn = arguments[1];
          let r = vscHook.vsAmdLoader(arguments[0], async function (...args) {
            vscHook.installBootHooks();
            await asyncOnLoadFn(...args);
          }, arguments[2]);


          return r;
        } else {
          return vscHook.vsAmdLoader(...arguments);
        }
      } catch (error) {
        vscHook.logErr(error, error.stack);
      }
    }, globalObj.require);
    // trigger bootstrapping
    return bootstrapLoadFunc(modulePaths, resultCallback, options);
  };
};


function updateValidFileRoots(vsAmdLoader, configService, potocolMainService) {
  const cfgModuleList = configService.getValue('vscodecustomloader.modulelist');
  if (!cfgModuleList || !Array.isArray(cfgModuleList) || cfgModuleList.length < 1) {
    this.warn(`Empty configuration. Please configure 'vscodecustomloader.modulelist'`);
    return;
  }

  const vs_uri = vsAmdLoader('vs/base/common/uri'); // synchronous require

  // file roots never get removed when removed from configuration
  // protocolmainservice can handle duplicates
  for (const directoryCfg of cfgModuleList) {
    potocolMainService.addValidFileRoot(vs_uri.URI.file(directoryCfg.path));
  }
}


exports.bootstrapMain = (globalObj, vsAmdLoader, bootstrapLoadFunc, loaderArgs) => {
  const entrypoint = loaderArgs[0];
  const onLoadFn = loaderArgs[1];
  const onErrorFn = loaderArgs[2];
  const vscHook = new VSCodeHook(PROC_MAIN, vsAmdLoader, globalObj);

  const createIpcTestChannel = () => new class {
    constructor() {
      const vsEvent = vscHook.vsAmdLoader('vs/base/common/event');
      this._evtTestEmitter = new vsEvent.Emitter();
      this.onTestEvent = this._evtTestEmitter.event;
      this.log = new Log(getCurrentProcName(PROC_MAIN), 'IPCChannel');

      this.evts = new events.EventEmitter();
      setInterval(()=>this._evtTestEmitter.fire({reason:'test',someData: Math.random()}), 10000);
    }
    // call<T>(ctx: TContext, command: string, arg?: any, cancellationToken?: CancellationToken): Promise<T>;
    // listen<T>(ctx: TContext, event: string, arg?: any): Event<T>;
    call(ctx, command, arg, cancellationToken) {
      this.log.warn('call', ctx, command, arg);
      switch (command) {
          case 'init': return Promise.resolve("welcome back");
      }
      throw new Error(`Call not found: ${command}`);
    }
    listen(ctx, event, arg) {
      this.log.warn('listen', ctx, event, arg);
      switch (event) {
          case 'testevent': return this.onTestEvent;
      }
      throw new Error(`Event not found: ${event}`);
    }
  };

  function registerIpcChannel() {
      try {
        const channelName = 'customLoader';
        vscHook.warn(`register IPC channel ${channelName}`);
        const vsApp = vscHook.vsAmdLoader('vs/code/electron-main/app');
        let hookDispose = undefined;
        hookDispose = _overrideArgs(vsApp.CodeApplication, 'initChannels', function (prevFuncArgsApplied, prevArgs) {
          hookDispose();
          const retVal = prevFuncArgsApplied();
          const mainProcesslectronIPCServer = prevArgs[1];
          mainProcesslectronIPCServer.registerChannel(channelName, createIpcTestChannel());
          return retVal;
        });
      } catch (error) {
        vscHook.logErr(error);
      }
  }

  vscHook.require(['LifecycleMainService', 'ConfigurationService', 'ProtocolMainService'])
    .then((services) => {
      const [lifecycleService, configService, potocolMainService] = services;
      vscHook.logErr('############################################');
      vscHook.logErr('###      ProtocolMainService found       ###');
      vscHook.logErr('###          Adding File Roots           ###');
      vscHook.logErr('############################################');

      lifecycleService.when(2).then(() => {
        updateValidFileRoots(vsAmdLoader, configService, potocolMainService);
        configService.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration('vscodecustomloader')) {
            vscHook.logErr('vscodecustomloader configuration changed')
            updateValidFileRoots(vsAmdLoader, configService, potocolMainService);
          }
        });
      });
    });


  // trigger bootstrapping
  let r = bootstrapLoadFunc(entrypoint, function (...args) {
    registerIpcChannel();
    vscHook.installBootHooks();
    if (onLoadFn)
      return onLoadFn(...args);
    return undefined;
  }, onErrorFn);
  return r;
};

