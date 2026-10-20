// support for presentations
(function Demo() {
  let lines = [];
  let index = -1;
  function move(d) {
    if (index + d >= 0 && index + d < lines.length) {
      index += d;
      D.ide.wins[0].loadLine(lines[index]);
    }
  }
  // key display mode:
  let $p; // dom element for the pending key or null if key display mode is off
  const meta = new Set(['Shift', 'Alt', 'Ctrl', 'Cmd', 'Meta', 'Win']);
  function keyInfo(e) { // returns a pair of the key name and an "is complete?" flag
    const be = e.browserEvent;
    const kbs = D.wins[0].me._standaloneKeybindingService;
    const mk = kbs.resolveKeyboardEvent(e);
    const isMeta = meta.has(monaco.KeyCode[e.keyCode]);
    const s = !isMeta || be.altKey || be.shiftKey || be.ctrlKey || be.metaKey ? mk.getLabel() : '';
    return [s, !isMeta]; // s:key name, c:is the key combination complete?
  }
  function loadDemoScript(f) { // f:path to file, ignored if empty
    f && D.host.fs.readText(f).then((s) => {
      index = -1;
      let indent = 6;
      lines = s.replace(/^[\ufeff\ufffe]/, '').split(/\r?\n/)
        .map((l) => {
          const [, m] = l.match(/^\s*&&(.*)/) || [];
          if (m) {
            m.replace(/(\w*)=([^\s]*)/g, (x, k, v) => {
              k === 'indent' && (indent = +v);
            });
          }
          return ' '.repeat(indent) + l;
        })
        .filter(x => !/^\s*&(⍝|&)/.test(x));
    }, () => { $.err('Cannot load demo file'); });
  }
  D.desktop && loadDemoScript(D.host.sys.env.RIDE_DEMO_SCRIPT);
  const handlers = [];
  $.extend(D.commands, {
    DMN() { move(1); }, // next line
    DMP() { move(-1); }, // prev line
    DMR() { // load demo script
      if (!D.desktop || D.ide.floating) return;
      D.host.dlg.open({ title: 'Load demo script' }).then((f) => { f && loadDemoScript(f); });
    },
  });
}());
