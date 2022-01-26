
define([
  "module",
  "require",
  "exports",
  "vs/base/common/uri",
], function (module, require, exports, uri) {
  "use strict";
  const {URI} = uri;
  const moduleCfg = module.config();

  const CSSUtil = {
    findStyleSheet: (filename, cb) => {
      var docSheets = document.styleSheets;
      for (var i in docSheets) {
        if (docSheets[i].href && docSheets[i].href.endsWith(filename)) {
          cb(docSheets[i]);
        }
      }
    },
    loadCssFiles(cssFileList, onFinish, onError) {
      onFinish(1);
/*       const cssModuleList = cssFileList.map((cssFile) => {
        const dotCss = cssFile.lastIndexOf(".css");
        const cssFileWithoutExt = dotCss > -1 ? cssFile.substr(0, dotCss) : cssFile;
        const fileUri = URI.joinPath(moduleCfg.moduleUri, cssFileWithoutExt);
        const cssUri = "vs/css!" + fileUri.toString(true);
        return cssUri;
      });
      require(
        cssModuleList,
        async result => {
          //TODO: this will be called for every stylesheet loaded I assume!
          onFinish(result);
        },
        (error, y) => {
          console.error(`[uncaught exception]: ${error}`);
          if (error && typeof error !== 'string' && error.stack) {
            console.error(error.stack);
          }
          console.log(y);
          onError(error);
        }
      ); */
    }
  };

  exports.CSSUtil = CSSUtil;
});
