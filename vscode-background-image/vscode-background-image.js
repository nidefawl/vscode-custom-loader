const vscode = require('vscode');

const moduleList = [
  "vscode-background-image/main.js",
  "vscode-background-image/cssutil.js",
  "vscode-background-image/background-image.js",
  "vscode-background-image/ws-background-image.css",
  "vscode-background-image/ws-transparent-parts.css"
];

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {

  console.log(context.extension.packageJSON.displayName);
  console.log(`${context.extension.id} installed at ${context.asAbsolutePath('vscode-extension.js')}`);

  let disposableCmd1 = vscode.commands.registerCommand(`vscode-background-image.register`, async () => {
    console.log(`${context.extension.id}: vscode-background-image.register triggered`);
    const vsc = vscode.extensions.getExtension('nidefawl.vscode-custom-loader');
    const instance = await vsc.activate(); // a noop if ext is already active, return value is api
    instance.registerContribution(context.extension.id, moduleList)
  }, this);
  let disposableCmd2 = vscode.commands.registerCommand(`vscode-background-image.unregister`, async () => {
    console.log(`${context.extension.id}: vscode-background-image.unregister triggered`);
    const vsc = vscode.extensions.getExtension('nidefawl.vscode-custom-loader');
    const instance = await vsc.activate();
    instance.unregisterContributions(context.extension.id)
  }, this);
  context.subscriptions.push(disposableCmd1, disposableCmd2);
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
