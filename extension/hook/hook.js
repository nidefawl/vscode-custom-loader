'use strict';

const path = require('path');
const util = require('util');
const events = require('events');

const __CONTRIB_REG_NAME = 'contrib-reg';

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
function _overrideFunc(where, name, cb) {
  const prevFunc = where.prototype[name];
  where.prototype[name] = function () {
    return cb.apply(this, [prevFunc, arguments]);
  };
}

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
    this.requires = []
    this.hookDisposeList = [];
    this.byName = new Map();
    this.byInstance = new Map();
    this.descrByName = new Map();
    this.nameByCtor = new Map();
    this.nameByDesc = new Map();
    this.registrySvcDesc = null;

    if (PRINT_LOG_INSTANCES) {
      this.evts.on('instance', (typeName,_)=>this.warn(typeName));
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
    const reqIdx = this.requires.length;
    this.requires.push(reqSvcName);
    req.then(()=>{
      this.requires = this.requires.filter((v, i)=>i===reqIdx);
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

    const timeout = 8000;
    setTimeout(()=> {
      if (this.numRequires > 0) {
        this.logErr(`${this.numRequires} require where not fullfilled after ${timeout}ms`, this.requires);
      }
    }, timeout, this);

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
        //TODO: test if access to services InstantiationService.invokeFunction is faster/cleaner/shorter/future proof
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

    this.vsAmdLoader(
      ['vs/workbench/browser/parts/activitybar/activitybarPart'],
      function (vs_activitybar) {
        const {ActivitybarPart} = vs_activitybar;
        const newSize = 32;
        ActivitybarPart.ACTION_HEIGHT = newSize
        _overrideArgs(vs_activitybar.ActivitybarPart, 'createCompositeBar', function (prevFuncArgsApplied, prevArgs) {
          this.ACTION_HEIGHT = newSize
          this.minimumWidth = newSize;
          this.maximumWidth = newSize;
          return prevFuncArgsApplied();
        });
      },
      function(err) {
        thisLoader.logErr("err", err);
      });
    this.vsAmdLoader(
      ['vs/workbench/browser/parts/editor/tabsTitleControl'],
      function (vs_tabsTitleControl) {
        const {TabsTitleControl} = vs_tabsTitleControl;
        TabsTitleControl.TAB_HEIGHT = 24
        TabsTitleControl.TAB_WIDTH.compact = 25;
        TabsTitleControl.TAB_WIDTH.shrink = 48;
        TabsTitleControl.TAB_WIDTH.fit = 80;
      },
      function(err) {
        thisLoader.logErr("err", err);
      });
    this.vsAmdLoader(
      ['vs/workbench/browser/parts/titlebar/titlebarPart'],
      function (vs_titlebarPart) {
        let desc = Object.getOwnPropertyDescriptor(vs_titlebarPart.TitlebarPart.prototype, 'minimumHeight');
        const prevFunc = desc.get;
        desc.get = function() {
          return parseInt(prevFunc.call(this)*0.75);
        };
        Object.defineProperty(vs_titlebarPart.TitlebarPart.prototype, 'minimumHeight', desc);
      },
      function(err) {
        thisLoader.logErr("err", err);
      });
    this.vsAmdLoader(
      ['vs/workbench/browser/part'],
      function (vs_parts) {
        const VSCODE_COMPONENT_TITLE_HEIGHT = 35;
        const ADJUSTED_TITLE_HEIGHT = 24;
        _overrideFunc(vs_parts.Part, 'layoutContents', function (prevFunc, prevArgs) {
          if (!this.options.hasTitle) {
            const dim = prevFunc.call(this, ...prevArgs);
            return dim;
          }
          // Fix contentSize calculation: Pass in delta height to content height
          const extraHeight = VSCODE_COMPONENT_TITLE_HEIGHT - ADJUSTED_TITLE_HEIGHT;
          const dimensions = prevFunc.call(this, prevArgs[0], prevArgs[1] + extraHeight);
          dimensions.titleSize.height = Math.min(prevArgs[1], ADJUSTED_TITLE_HEIGHT);
          return dimensions;
        });
      },
      function(err) {
        thisLoader.logErr("err", err);
      });
  }

  _uninstallHooks() {
    this.hookDisposeList.forEach(f => f());
  }

}



function loadCustomModules(log, vsAmdLoader, cfgModuleList, contribBaseUri) {

  const lcfg = vsAmdLoader.getConfig();


  if (!lcfg.isPatched) { // modify loader config only if we actually end up loading something

    // add vscode-file:// scheme to loaders regex so we don't have to calculate relative urls for all files as workaround
    AMDLoader.Utilities.isAbsolutePath=(url)=>/^((http:\/\/)|(https:\/\/)|(file:\/\/)|(vscode-file:\/\/)|(\/))/.test(url)
    // modify amdModulesPattern: allow loading modules with names other than 'vs/.*'
    lcfg.amdModulesPattern = new RegExp(lcfg.amdModulesPattern.source.concat('|(^.*[/].*$)'));
    // don't run this twice
    lcfg.isPatched = true;
  }

  const {URI} = vsAmdLoader('vs/base/common/uri');
  const {FileAccess} = vsAmdLoader('vs/base/common/network');

  const baseUri = contribBaseUri || URI.parse(lcfg.baseUrl);

  let loadModuleNames = [];
  const loadModulesPaths = {};
  const loadModulesCfg = {};
  for (const filename of cfgModuleList) {
    const parsedPath = path.parse(filename);


    let moduleName;
    if (parsedPath.ext === '.css') {
      /* Path mapping for CSS files is handled differently: Prefixed with vs/css!, and filenames without extension */
      const fileUri = FileAccess.asBrowserUri(URI.joinPath(baseUri, parsedPath.dir, parsedPath.name));
      moduleName = `vs/css!${fileUri.toString(true)}`;
    } else {
      const fileUri = FileAccess.asBrowserUri(URI.joinPath(baseUri, parsedPath.dir, parsedPath.base));
      const moduleDirUri = FileAccess.asBrowserUri(URI.joinPath(baseUri, parsedPath.dir))
      moduleName = `${parsedPath.dir}/${parsedPath.name}`;

      loadModulesPaths[moduleName] = fileUri.toString(true);

      /* set additional info provided by module.config() inside the loaded modules */
      loadModulesCfg[moduleName] = {
        name: moduleName,
        file: filename,
        uri: fileUri,
        extensionUri: baseUri,
        moduleUri: moduleDirUri
      }
    }
    loadModuleNames.push(moduleName);

  }

  /**
   * 'path: ' configure modulename to filepath mapping
   * 'config: ' options isn't strictly required, but provides loaded modules with additional
   * info available thru module.config()
   *
   * AMD loader config auto merges this config with its existing configuration. neat.
   */
  vsAmdLoader.config({
    paths: loadModulesPaths,
    config: loadModulesCfg,
  });

  /* trigger loading by passing the list of module names to the require func */
  vsAmdLoader(
    loadModuleNames,
    function (...modulesLoaded) {
      // log.log('modules loaded', modulesLoaded);
    }, undefined);
}

async function loadContribRegistryModules(log, vsAmdLoader, contribRegistry, extensionService) {
  for (const contrib of contribRegistry) {
    try {
      if (contrib.id && contrib.enabled && contrib.modules) {
        const extension = await extensionService.getExtension(contrib.id);
        if (extension) {
          log.log(`Loading ${contrib.modules.length} modules contributed by ${contrib.id}`);
          loadCustomModules(log, vsAmdLoader, contrib.modules, extension.extensionLocation);
        }
      }
    } catch(error) {
      log.logErr(error, contrib.id);
    }
  }
}

exports.bootstrapWindow = () => {
  const globalObj = global;
  if (!window) return;
  if (!globalObj['MonacoBootstrapWindow']) return;
  if (!globalObj.MonacoBootstrapWindow?.load) return;
  if (!globalObj['require']) return;
  const processType = {
    'workbench.html': PROC_RENDER,
  }[globalObj?.window?.location?.href.toString().split('/').pop()];

  if (!processType)
    return;

  const bootstrapLoadFunc = globalObj.MonacoBootstrapWindow.load;
  const vscHook = new VSCodeHook(processType, globalObj.require, globalObj);

  let resolveRpcHandler;
  /*
   * global CustomLoaderRPC allows renderer code to install a RPC handler
   * for commmunication with the extension in extension host process.
   * maybe this should be a module that needs to be imported.
   * But this works for now
   */
  globalObj.CustomLoaderRPC = new Promise(resolve=>resolveRpcHandler = resolve);


  /**
   * Step 1: Wait for StorageService and ExtensionService to be instantiated
   * Step 2: Install RPC handler for communication: renderer <-> extension host
   * Step 3: Load contributions from global storage, see which extension are enabled
   *         then load the modules registered to each extension.
   */
  vscHook.require(['StorageService', 'ExtensionService'])
    .then(async (services) => {
      const [storageService, extensionService] = services;
      let extStateJson = null;
      try {

        //TODO handle extension host reloads
        //TODO handle extension enable/disable changes

        // sadly there is no onExtensionHostStarted event (for the local ext host)
        let subscr = null;
        subscr = extensionService.onDidChangeExtensionsStatus((extensionIds)=>{
          try {
            const extHostManager = extensionService._extensionHostManagers[0]; // 0 == LocalProcess
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
          } catch(error) {
            subscr.dispose();
            vscHook.logErr(error);
          }
        });


        /* Wait for database to load */
        await storageService.initializationPromise;

        /* StorageService global storage allows access to extensions 'Mementos'     */
        const storage = storageService.globalStorage ? storageService.globalStorage : storageService.profileStorage;
        extStateJson = storage.get('nidefawl.vscode-custom-loader', undefined);

        if (extStateJson !== undefined) {
          const extState = JSON.parse(extStateJson);
          const contribRegistry = extState[__CONTRIB_REG_NAME] || [];
          loadContribRegistryModules(vscHook, vscHook.vsAmdLoader, contribRegistry, extensionService);
        }

      } catch(error) {
        vscHook.logErr(error, extStateJson);
      }
    });

  /* workaround for 'did-finish-load' firing early bug. Fix is already upstream on microsoft/vscode git */
  vscHook.require(['LifecycleService', 'NativeHostService']).then((services) => {
      const [lifecycleService, nativeHostService] = services;
      lifecycleService.when(4).then(_ => {
        // workaround for 'did-finish-load' firing early bug
        nativeHostService.notifyReady()
      });
    });


  // BEGIN renderer <-> extension host RPC

  /**
   * Basic RPC handler.
   * Will be registered to ID created by getOrRegisterProxyIdentifier
   * Interface must be identical for registered proxy identifier IDs
   */
  const rendererRpcHandler = new class RPCChannelHandler_Renderer {
    constructor() {
      this.log = new Log(getCurrentProcName(processType), 'RPCChannelHandler');
      this.channels = {};
      this.initialized = false;
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
      this.log.warn('$recv', 'Message has not been handled', args);
      return "Message has not been handled";
    }
    /* Outgoing */
    send(args) {
      return this.rpcHandlerProxy.$recv(args);
    }
  };

  /**
   * must not be called before extension host was created.
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
    //TODO register disposable to handle extension host exit
    // _rpcProtocol._register({dispose: ()=>{}});

    rpcProtocol.set(getOrRegisterProxyIdentifier(), rendererRpcHandler);
    const rpcHandlerProxy = rpcProtocol.getProxy(getOrRegisterProxyIdentifier());
    rendererRpcHandler.setProxy(rpcHandlerProxy);
    resolveRpcHandler(rendererRpcHandler);
    let initTimerHandle=null;
    const loaderChannel = {
      recv: function(args) {
        if (args[1] == 'initreply') {
          if (initTimerHandle) {
            clearTimeout(initTimerHandle);
            initTimerHandle = null;
          }
        }
      }
    };

    /* Init mechanism so the custom-loader extension inside the extension host
     * can detect if bootstrap-window.js was patched and hook.js has been loaded */
    rendererRpcHandler.registerChannelHandler('customloader', loaderChannel);
    let numPings = 1;
    const pingInit = () =>{
      loaderChannel.send('init');
      if (numPings++ > 10 && initTimerHandle) {
        clearTimeout(initTimerHandle);
        initTimerHandle = null;
      }
    }
    initTimerHandle = setInterval(pingInit, 2000);
    pingInit();
  }

  // END renderer <-> extension host RPC


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
