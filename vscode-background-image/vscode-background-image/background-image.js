define([
	"module",
	"require",
	"exports",
	"vscode-background-image/cssutil",
	"fs",
	"url"
], function (module, require, exports, cssutil, fs, url) {
	"use strict";
  function toBase64(arr) {
    //arr = new Uint8Array(arr) if it's an ArrayBuffer
    return btoa(
      arr.reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
  }
	const CSSUtil = cssutil.CSSUtil;

	const requiredCssFiles = [
		"ws-background-image.css",
		"ws-transparent-parts.css"
	];

	const customBgConfig = {
		currentImage: {
			fp: null,
			url: null
		},
		loadWithReadFile: false,
		backgroundImageCssRule: "no-repeat center center fixed; background-size: cover;"
	};


	const CustomBackground = {
		getRequiredCssFiles: () => requiredCssFiles,
		getConfig: () => customBgConfig,
		setImage: function (imgFilePath) {
			customBgConfig.currentImage.fp = imgFilePath;

			var urlFromFp = url.pathToFileURL(imgFilePath);
			urlFromFp = urlFromFp.href.replace("file://", "vscode-file://vscode-app");

			// if (customBgConfig.currentImage.url == urlFromFp) {
			//   return;
			// }
			customBgConfig.currentImage.url = urlFromFp;

			var newStyle = "";
			if (customBgConfig.loadWithReadFile) {

				console.log("readFileSync", imgFilePath);

				const buf = fs.readFileSync(imgFilePath);
				const base64Img = toBase64(buf);

				var fileType = "jpg";
				if (imgFilePath.endsWith(".png")) {
					fileType = "png";
				}
				newStyle = "background: url(data:image/" + fileType + ";base64," + base64Img + ") " + customBgConfig.backgroundImageCssRule;
			} else {
				newStyle = "background: url(" + urlFromFp + ") " + customBgConfig.backgroundImageCssRule;
			}

			CSSUtil.findStyleSheet("background-image.css", function (styleSheet) {
				styleSheet.deleteRule(2);
				var rule = ".monaco-workbench { " + newStyle + "; }";
				styleSheet.insertRule(rule, 2)
			});
		}
	};
	exports.CustomBackground = CustomBackground;
});
