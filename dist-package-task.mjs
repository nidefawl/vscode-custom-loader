import { createVSIX } from 'vsce';


// disable 'do you want to continue?' from vsce
process.env['VSCE_TESTS'] = 1;

async function packExtension(options) {

  const optionsCreateVSIX = {
    cwd: options.input,
    packagePath: options.output,
    version: options.version,
    preRelease: options.preRelease,
    updatePackageJson: false,
    dependencies: false
  };

  await createVSIX(optionsCreateVSIX).catch(err => { throw Error(`createVSIX failed with ${err}`); });
}

packExtension({
  input: './extension',
  output: `./dist/`,
  preRelease: true
});
packExtension({
  input: './vscode-background-image',
  output: `./dist/`,
  preRelease: true
});
