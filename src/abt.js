// About dialog
{
  let d;
  let ta; // DOM elements for the dialog and the textarea

  D.aboutDetails = function AboutDetails() {
    const v = D.versionInfo || {};
    const ri = D.remoteIdentification || {};
    const u = 'unknown';
    const db = D.db || localStorage;
    const repr = JSON.stringify;
    let s = '';
    for (let i = 0; i < db.length; i++) {
      const x = db.key(i);
      s += `${i ? ',\n' : ''}    ${repr(x)}:${repr(db.getItem(x))}`;
    }
    let el = '';
    if (D.el) {
      el = ''
        + `\n  Electron: ${D.el.process.versions.electron}`
        + `\n  Chrome: ${D.el.process.versions.chrome}`
        + `\n  Node: ${D.el.process.versions.node}`
        + `\n  Platform: ${D.el.process.platform}-${D.el.process.arch}`;
    }
    return 'IDE:'
      + `\n  Version: ${v.version || u}`
      + `${el}`
      + `\n  Date: ${v.date || u}`
      + `\n  Git commit: ${v.rev || u}`
      + `\n  Preferences:{\n${s}\n  }\n`
      + '\nInterpreter:'
      + `\n  Version: ${ri.version || u}`
      + `\n  Platform: ${ri.platform || u}`
      + `\n  Edition: ${ri.arch || u}`
      + `\n  Date: ${(ri.date || u).replace(/^Created: /, '')}\n`;
  };

  D.abt = function About() {
    if (D.desktop) {
      // about.html asks the main window for its content
      D.host.win.open('about', 'about.html', {
        parent: 'main',
        modal: true,
        bounds: { width: 600, height: 500 },
        minWidth: 600,
        minHeight: 500,
      }).catch((e) => console.error(e)); // eslint-disable-line no-console
    } else {
      if (!d) {
        d = I.abt;
        I.abt_close.onclick = () => { d.hidden = 1; };
        I.abt_copy.onclick = () => {
          ta.select();
          document.execCommand('copy');
          ta.selectionEnd = 0;
        };
        I.abt_copy.hidden = !document.queryCommandSupported('copy');
        I.abt_contact.onclick = (x) => {
          if (x.target.nodeName === 'A' && /^http/.test(x.target.href)) {
            D.openExternal(x.target.href);
            return !1;
          }
          return !0;
        };
        ta = I.abt_ta;
      }
      D.util.dlg(d, { w: 600, h: 450 });
      ta.value = D.aboutDetails();
      ta.scrollTop = 0;
      ta.selectionStart = 0;
      ta.selectionEnd = 0;
      (!I.abt_copy.hidden ? I.abt_copy : I.abt_close).focus();
    }
  };
}
