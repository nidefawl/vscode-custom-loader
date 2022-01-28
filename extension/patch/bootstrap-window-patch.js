//BEGIN PATCH LOADER
(function(){
  try {
    require.__$__nodeRequire('<absPathHookModule>').bootstrapWindow();
  } catch (error) {
    console.error('Could not patch main process. If you have uninstalled the extension you can restore bootstrap-window.js from its backup\n\n', error, error.stack);
  }
}());
//END PATCH LOADER