/* Append at end of file */
(function(){
  try {
		require.__$__nodeRequire('C:/dev/04_NODE/vscode-custom-loader/hook').bootstrapWindow();
  } catch (error) {
    console.error('Could not patch main process. If you have uninstalled the extension you can restore bootstrap-window.js from its backup\n\n', error, error.stack);
  }
}());