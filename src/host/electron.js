// Host adapter for the Electron shell (see docs/adr/0001-async-host-adapter.md).
// Every page loads both adapters; each one only acts inside its own shell.
var D = typeof D === 'undefined' ? {} : D; // eslint-disable-line no-var, no-use-before-define

/* eslint-disable no-underscore-dangle */
(function hostElectron() {
  if (window.__TAURI__ || !/\bElectron\//.test(navigator.userAgent)) return;
  D.desktop = true;
  D.host = { kind: 'electron', ready: Promise.resolve() };

  // Only index.html exposes Node (as nodeRequire); auxiliary pages get the flag alone.
  if (typeof nodeRequire === 'undefined') return;
  D.el = nodeRequire('@electron/remote');
  D.elm = D.el.require('@electron/remote/main');
  D.elw = D.el.getGlobal('elw');
  D.ipc = nodeRequire('node-ipc').default;
  D.ipc.config.logInColor = false;
  D = $.extend(D, D.el.getGlobal('D'));
  const plt = process.platform;
  D.win = /^win/i.test(plt);
  D.mac = plt === 'darwin';
}());
