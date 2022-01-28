import { createVSIX } from 'vsce';
import yazl from 'yazl';
import yauzl from 'yauzl';
import fs from 'fs';


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

  if (options.additionalFiles) {
    const zipCloned = await new Promise((resolve, reject) => {
      const zipfile = new yazl.ZipFile();
      zipfile.on('error', (err) => reject(err));
      yauzl.open(options.output, { lazyEntries: true }, function (err, zipIn) {
        if (err) reject(err);
        zipIn.on('end', () => {
          zipIn.close();
          resolve(zipfile);
        });
        zipIn.on('entry', function (entry) {
          zipIn.openReadStream(entry, function (err, readStream) {
            if (err) reject(err);
            zipfile.addReadStream(readStream, entry.fileName);
            readStream.on('end', () => {
              zipIn.readEntry();
            });
          });
        });
        zipIn.readEntry();
      })
    });


    return new Promise((resolve, reject) => {
      zipCloned.on('error', (err) => reject(err));
      options.additionalFiles.forEach((f) => zipCloned.addFile(`./${f}`, `extension/${f}`));
      zipCloned.end();
      fs.unlink(options.output, (err) => {
        if (err) reject(err);
        else {
          const outStream = fs.createWriteStream(options.output);
          outStream.on('error', (err) => reject(err));
          zipCloned.outputStream.on('end', () => resolve(options.output));
          zipCloned.outputStream.pipe(outStream);
        }
      });
    });
  }

  return options.output;
}

function packCustomLoader() {
  const extVersion = '0.0.3';
  const options = {
    input: './extension',
    output: `./dist/vscode-custom-loader-${extVersion}.vsix`,
    version: extVersion,
    preRelease: true
  };

  return packExtension(options)
    .then(f => console.log('Generated', f));
}

function packBackgroundImage() {
  const extVersion = '0.0.3';
  const options = {
    input: './vscode-background-image',
    output: `./dist/vscode-background-image-${extVersion}.vsix`,
    version: extVersion,
    preRelease: true
  };

  return packExtension(options)
    .then(f => console.log('Generated', f));
}


await packCustomLoader();
await packBackgroundImage();
