// Host adapter for the Tauri shell (see docs/adr/0001-async-host-adapter.md).
// Every page loads both adapters; each one only acts inside its own shell.
var D = typeof D === 'undefined' ? {} : D; // eslint-disable-line no-var, no-use-before-define

/* eslint-disable no-underscore-dangle */
(function hostTauri() {
  if (!window.__TAURI__) return;
  D.desktop = true;
  D.host = { kind: 'tauri', ready: Promise.resolve() };

  // Implemented in Rust by "Bridge the RIDE TCP connection through Rust".
  D.host.conn = {
    connect: () => Promise.reject(Object.assign(
      new Error('Connecting is not available in the Tauri shell yet.'),
      { name: 'Not available', code: 'ENOTSUP' },
    )),
  };
}());
