import { createVSIX } from 'vsce';


// disable 'do you want to continue?' from vsce
process.env['VSCE_TESTS'] = 1;

createVSIX({
  cwd: './extension',
  packagePath: './dist',
  preRelease: true,
  updatePackageJson: false,
  dependencies: true,
  useYarn: true,
  packagedDependencies: [
    'sudo-prompt'
  ]
});
createVSIX({
  cwd: './vscode-background-image',
  packagePath: './dist',
  preRelease: true,
  updatePackageJson: false,
  dependencies: false,
  useYarn: true
});
