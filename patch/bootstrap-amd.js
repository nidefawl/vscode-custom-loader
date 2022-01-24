/* Append at end of file */
const bootstrapLoadFunc = exports.load;
exports.load = function () {
  if (arguments[0] === 'vs/code/electron-main/main') {
    try {
      let vscodehook = loader.__$__nodeRequire('C:/dev/04_NODE/vscode-custom-loader/hook');
      return vscodehook.bootstrapMain(global, loader, bootstrapLoadFunc, arguments);
    } catch (error) {
      console.error('Could not patch main process. If you have uninstalled the extension you can restore bootstrap-amd.js from its backup');
      console.error(error);
    }
  }
  return bootstrapLoadFunc(...arguments);
};