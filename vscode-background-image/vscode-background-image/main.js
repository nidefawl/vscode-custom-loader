define([
  "module",
  "require",
  "exports",
  "fs",
  "vs/base/common/uri",
  "vs/base/common/network"
], function (module, require, exports, fs, uri, network) {
  "use strict";
  const moduleCfg = module.config();

  const { URI } = uri;
  const { FileAccess } = network;


  const Helpers = {
    findStyleSheet: (filename, cb) => {
      var docSheets = document.styleSheets;
      for (var i in docSheets) {
        if (docSheets[i].href && docSheets[i].href.endsWith(filename)) {
          cb(docSheets[i]);
        }
      }
    },
    toBase64: (arr) => {
      //arr = new Uint8Array(arr) if it's an ArrayBuffer
      return btoa(
        arr.reduce((data, byte) => data + String.fromCharCode(byte), '')
      );
    },
    setStylesheetsAttrEnabled: (cssFiles, bEnabled) => {
      /**
       * TODO
       * swap this around. iterate over the DOM link elements
       * and for each check if the name is in registeredCssFiles
       */
      cssFiles.forEach(function (ssFilename) {
        Helpers.findStyleSheet(ssFilename, function (domLinkEl) {
          domLinkEl.disabled = !bEnabled;
        });
      });
    }
  };


const BackgroundImage = (_ => {
    const requiredCssFiles = [
      "ws-background-image.css",
      "ws-transparent-parts.css"
    ];

    let isEnabled = true;
    const customBgConfig = {
      currentImage: {
        fp: null,
        url: null
      },
      loadWithReadFile: false,
      backgroundImageCssRule: "no-repeat center center fixed; background-size: cover;"
    };
    return new class {
      constructor() {
        if (!isEnabled) {
          Helpers.setStylesheetsAttrEnabled(isEnabled);
        }
      }

      get enabled() { return isEnabled }
      set enabled(val) {
        isEnabled = val;
        Helpers.setStylesheetsAttrEnabled(requiredCssFiles, isEnabled);
      }
      setImage(imgFilePath) {
        console.warn('setImage', imgFilePath);
        customBgConfig.currentImage.fp = imgFilePath;
        const fileUri = FileAccess.asBrowserUri(URI.file(imgFilePath));
        customBgConfig.currentImage.url = fileUri;

        var newStyle = "";
        if (customBgConfig.loadWithReadFile) {

          console.log("readFileSync", imgFilePath);

          const buf = fs.readFileSync(imgFilePath);
          const base64Img = Helpers.toBase64(buf);

          var fileType = "jpg";
          if (imgFilePath.endsWith(".png")) {
            fileType = "png";
          }
          newStyle = "background: url(data:image/" + fileType + ";base64," + base64Img + ") " + customBgConfig.backgroundImageCssRule;
        } else {
          newStyle = "background: url(" + fileUri.toString(false) + ") " + customBgConfig.backgroundImageCssRule;
        }

        Helpers.findStyleSheet("ws-background-image.css", function (styleSheet) {
          styleSheet.deleteRule(2);
          var rule = ".monaco-workbench { " + newStyle + "; }";
          styleSheet.insertRule(rule, 2)
        });
      }
    };
  })();


  const rpcChannel = {
    recv(args) {
      args = args.splice(1);
      const command = args.splice(0, 2).join('.');
      switch (command) {
        case 'background.enable':
          BackgroundImage.enabled = args[0];
          break;
        case 'background.set':
          BackgroundImage.setImage(args[0]);
          break;
      }
    }
    /* send(args) will be added by API */
  };


  global.CustomLoaderRPC.then((rpcChannelHandler)=> {
    rpcChannelHandler.registerChannelHandler('nidefawl.vscode-background-image', rpcChannel);
  });

  exports.BackgroundImage = BackgroundImage;
});
