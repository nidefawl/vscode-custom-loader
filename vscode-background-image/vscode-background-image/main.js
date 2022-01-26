define([
  "require",
  "exports",
  "vscode-background-image/cssutil",
  "vscode-background-image/background-image"
], function (require, exports, cssutil, bgImage) {
  "use strict";
  const CSSUtil = cssutil.CSSUtil;
  const CustomBackground = bgImage.CustomBackground;

  const myassert = function (x) {
    if (!x) console.error("ASSERTION FAILED");
  }

  //TODO: move this out of here
  const bgImgFiles = {
    filelist: [
      "wallhaven-01wvgv.jpg",
      "wallhaven-397mgd.png",
      "wallhaven-3z91ey.jpg",
      "wallhaven-42vwx0.jpg",
      "wallhaven-45w1e1.jpg",
      "wallhaven-47l3y0.jpg",
      "wallhaven-4lqz6r.jpg",
      "wallhaven-4x8l1d.jpg",
      "wallhaven-5wkj59.jpg",
      "wallhaven-j3lvlq.png",
      "wallhaven-j5vejp.png",
      "wallhaven-lmj5gl.png",
      "wallhaven-lmwegp.png",
      "wallhaven-mdyd1k.png",
      "wallhaven-n6rv2w.png",
      "wallhaven-nk888q.jpg",
      "wallhaven-nkg696.jpg",
      "wallhaven-nm188n.png",
      "wallhaven-nm2729.png",
      "wallhaven-nr27eq.jpg",
      "wallhaven-nzrokv.jpg",
      "wallhaven-r45574.jpg",
      "wallhaven-r7981q.jpg",
      "wallhaven-y8kdvd.jpg",
      "xp-night-hill-4k-p1-3840x2160.jpg"
    ],
    imgDirectory: "C:\\dev\\vscode-customize\\wallpapers_blurry\\",
  };

  let imageIdx = 0;

  function SetImageIdx(idx) {

    if (!bgImgFiles.filelist || !bgImgFiles.filelist.length)
      return;
    idx = idx < 0 ? bgImgFiles.filelist.length - 1 : idx;
    imageIdx = idx >= bgImgFiles.filelist.length ? 0 : idx;
    let imagePath = null;
    imagePath = bgImgFiles.filelist[imageIdx];
    if (bgImgFiles.imgDirectory) {
      imagePath = bgImgFiles.imgDirectory + imagePath;
    }
    if (imagePath) {

      CustomBackground.setImage(imagePath);
    }
  }
  function setImageAndUpdateConfiguration() {
      CustomBackground.setImage(imagePath);
    ACCESS.byName.get("ConfigurationService").getValue("conf.view.showOnWindowOpen")
  }

  function setRandomImage() {
    !bgImgFiles.filelist || !bgImgFiles.filelist.length || SetImageIdx(Math.floor(Math.random() * bgImgFiles.filelist.length));
  }

  const CustomStyle = (() => {
    let isEnabled = true;
    let isInitialized = false;
    let handlersOnActivate = [];
    let registeredCssFiles = [];


    function createButton(btnId, btnLabel, btnSymbol, fnOnClick) {
      const e = document.createElement("div");
      e.id = btnId;
      e.className = "statusbar-item right";
      e.setAttribute("aria-label", btnLabel);
      const a = document.createElement("a");
      a.tabIndex = -1;
      a.setAttribute("role", "button");
      a.setAttribute("aria-label", btnLabel);
      const span = document.createElement("span");
      span.className = "codicon " + btnSymbol;
      a.appendChild(span);
      a.addEventListener('click', fnOnClick);

      // e.addEventListener('mouseover', otherEvt);

      e.appendChild(a);
      return e;
    }

    function createStatusBarControls() {
      const elButtonFirst = document.querySelector(".right-items #status\\.vsccustomize\\.toggle");
      if (!elButtonFirst) {
        const elStatusBar = document.querySelector(".right-items");
        const elStatusBarItem = document.querySelector(".right-items > :first-child");
        if (!elStatusBar || !elStatusBarItem) {
          setTimeout(createStatusBarControls, 500);
          return;
        }

        let btnStatusBar = createButton(
          "status.vsccustomize.next",
          "Next Background",
          "codicon-triangle-right",
          function () {
            SetImageIdx(imageIdx + 1);
          });
        elStatusBar.appendChild(btnStatusBar);
        btnStatusBar = createButton(
          "status.vsccustomize.toggle",
          "Background Image On/Off",
          "codicon-symbol-color",
          function () {
            CustomStyle.toggleEnabled();
          });
        elStatusBar.appendChild(btnStatusBar);
        btnStatusBar = createButton(
          "status.vsccustomize.prev",
          "Previous Background",
          "codicon-triangle-left",
          function () {
            SetImageIdx(imageIdx - 1);
          });
        elStatusBar.appendChild(btnStatusBar);
      }
      setTimeout(createStatusBarControls, 6000);
    }

    function setStylesheetsAttrEnabled(bEnabled) {
      /**
       * TODO
       * swap this around. iterate over the DOM link elements
       * and for each check if the name is in registeredCssFiles
       */
      registeredCssFiles.forEach(function (ssFilename) {
        CSSUtil.findStyleSheet(ssFilename, function (domLinkEl) {
          domLinkEl.disabled = !bEnabled;
        });
      });
    }
    return {
      initialized: () => isInitialized,
      enabled: () => isEnabled,
      toggleEnabled: () => {
        isEnabled = !isEnabled;
        setStylesheetsAttrEnabled(isEnabled);
      },
      subscribeOnActivate: (fn) => {
        handlersOnActivate.push(fn);
      },
      init: () => {
        registeredCssFiles.push(...CustomBackground.getRequiredCssFiles());
        CSSUtil.loadCssFiles(
          registeredCssFiles,
          function () {
            setTimeout(createStatusBarControls, 500);
            isInitialized = true;
            myassert(CustomStyle.initialized());
            if (isInitialized && isEnabled) {
              myassert(CustomStyle.enabled());
              while (handlersOnActivate.length) {
                handlersOnActivate.shift().call();
              }
            }
            if (isInitialized && !isEnabled) {
              myassert(!CustomStyle.enabled());
              setStylesheetsAttrEnabled(isEnabled);
            }
          },
          function (error) {
            console.error(error);
            isInitialized = false;
            myassert(!CustomStyle.initialized());
          }
        );
      }
    };
  })();

  CustomStyle.subscribeOnActivate(function () {
    myassert(CustomStyle.initialized());
    let cfgImage = global.ACCESS?.byName?.get("ConfigurationService")?.getValue("vscode-customize.background.image")
    if (typeof(cfgImage) == 'string') {
      CustomBackground.setImage(cfgImage);
    } else {
      setTimeout(setRandomImage, 300);
    }
  });


  //TODO: subscribe to the right event to call this after
  CustomStyle.init();

  exports.CustomStyle = CustomStyle;

});
