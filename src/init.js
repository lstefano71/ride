const Console = console;

{
  const init = () => {
    I.apl_font.hidden = true;

    if (D.desktop) {
      document.onmousewheel = (e) => {
        const d = e.wheelDelta;
        if (d && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) D.commands[d > 0 ? 'ZMI' : 'ZMO']();
      };
      document.body.className += ` zoom${D.prf.zoom()}`;
    }

    D.createContextMenu = (el, win) => {
      if (!D.desktop) return;
      el.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        let cmitems;
        if (e.target.classList.contains('breakpointarea')) {
          if (!win.lineClicked) return;
          const l = win.lineClicked - 1;
          cmitems = [
            {
              label: 'Trace',
              click: () => { win.toggleTrace(l); },
              type: 'checkbox',
              checked: win.trace.has(l),
            },
            {
              label: 'Stop',
              click: () => { win.toggleStop(l); },
              type: 'checkbox',
              checked: win.stop.has(l),
            },
            {
              label: 'Monitor',
              click: () => { win.toggleMonitor(l); },
              type: 'checkbox',
              checked: win.monitor.has(l),
            },
          ];
          delete win.lineClicked;
        } else {
          const hasSelection = win
            ? !win.me.getSelection().isEmpty()
            : el.getSelection().type === 'Range';
          const isReadOnly = !!win && win.isReadOnly;
          const tc = !!win && !!win.tc;
          cmitems = [
            { label: 'Cut', role: 'cut', enabled: hasSelection && !isReadOnly },
            { label: 'Copy', role: 'copy', enabled: hasSelection },
            { label: 'Paste', role: 'paste', enabled: !isReadOnly },
            { type: 'separator' },
            {
              label: 'Redo',
              ...win && { click: () => { D.commands.RDO(win.me); } },
              ...!win && { role: 'redo' },
              enabled: !tc,
            },
            {
              label: 'Undo',
              ...win && { click: () => { D.commands.UND(win.me); } },
              ...!win && { role: 'undo' },
              enabled: !tc,
            },
          ];
          if (win && !win.session.get()) {
            const { me } = win;
            if (tc) {
              cmitems.unshift(...[
                {
                  label: 'Skip to line',
                  click: () => { win.STL(me); },
                  visible: tc,
                },
                { type: 'separator' },
              ]);
            }
          }
        }
        const acts = {}; // id → click
        const template = cmitems.map((x, i) => {
          const { click, ...h } = x;
          if (click) {
            h.id = `c${i}`;
            acts[h.id] = click;
          }
          return h;
        });
        D.host.menu.popup(template).then((id) => { id && acts[id] && acts[id](); });
      };
    };
    D.createContextMenu(window);

    D.open = D.open || ((url, o) => {
      const {
        height, width, x, y,
      } = o;
      let spec = 'resizable=1';

      if (width != null && height != null) spec += `,width=${width},height=${height}`;
      if (x != null && y != null) spec += `,left=${x},top=${y},screenX=${x},screenY=${y}`;
      return !!window.open(url, '_blank', spec);
    });

    /* eslint-disable no-console */
    D.openExternal = D.desktop
      ? (x) => { D.host.sys.openExternal(x).catch((e) => console.error(e)); }
      : (x) => { window.open(x, '_blank'); };
    /* eslint-enable no-console */
    if (D.desktop) {
      window.open = (url) => {
        !!url && D.openExternal(url);
        return { location: { set href(u) { D.openExternal(u); } } };
      };
    }

    const loc = window.location;
    if (D.desktop) {
      const qp = new URLSearchParams(loc.search);
      const type = qp.get('type');
      if (type === 'prf') {
        document.body.className += ' floating-window';
        D.IPC_Prf();
        I.splash.hidden = 1;
      } else if (type === 'editor') {
        document.body.className += ' floating-window';
        D.IPC_Client(+qp.get('winId'));
        I.splash.hidden = 1;
      } else {
        const winsLoaded = D.IPC_Server();
        const { win } = D.host;
        const aux = { parent: 'main', hidden: true, minimizable: false };
        Promise.all([
          win.open('prf', 'index.html?type=prf', {
            ...aux, minWidth: 790, minHeight: 600, minimizable: true,
          }),
          win.open('dialog', 'dialog.html', {
            ...aux,
            modal: true,
            bounds: { width: 400, height: 350 },
            resizable: false,
            maximizable: false,
          }),
          win.open('status', 'status.html', {
            ...aux, bounds: { width: 600, height: 400 }, minimizable: true,
          }),
        ]).then(() => win.focus('main')).catch((e) => console.error(e)); // eslint-disable-line no-console
        Promise.all(winsLoaded).then(() => {
          I.splash.hidden = 1;
          D.cn.start();
        });
      }
    } else {
      const ws = new WebSocket((loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host);
      const q = [];
      // q:send queue
      const flush = () => { while (ws.readyState === 1 && q.length) ws.send(q.shift()); };
      D.send = (x, y) => { q.push(JSON.stringify([x, y])); flush(); };
      ws.onopen = () => {
        ws.send('SupportedProtocols=2');
        ws.send('UsingProtocol=2');
        ws.send('["Identify",{"apiVersion":1,"identity":1}]');
        ws.send('["Connect",{"remoteId":2}]');
        ws.send('["GetWindowLayout",{}]');
      };
      ws.onmessage = (x) => { if (x.data[0] === '[') { const [c, h] = JSON.parse(x.data); D.recv(c, h); } };
      ws.onerror = (x) => { Console.info('ws error:', x); };
      D.ide2 = new D.IDE();
      I.splash.hidden = 1;
    }
    const closeMain = D.desktop
      ? () => D.host.win.close(D.host.win.current())
      : () => window.close();
    if (!D.quit) D.quit = closeMain;
    // Whether the main window may close now; if not, it may close itself later.
    const mayClose = () => {
      if (D.ide && D.ide.connected && !D.ide.closing) {
        setTimeout(() => {
          const quit = () => {
            D.ide.closing = true;
            D.desktop && D.host.win.close('html3500').catch(() => {});
            if (D.spawned) {
              D.send('Exit', { code: 0 });
              // Wait for the disconnect message
            } else {
              D.send('Disconnect', { message: 'User shutdown request' });
              D.ide.connected = 0;
              closeMain();
            }
          };
          if (D.prf.sqp() && !(D.el && process.env.NODE_ENV === 'test')) {
            const msg = D.spawned ? 'Quit Dyalog APL.' : 'Disconnect from interpreter.';
            $.confirm(`${msg} Are you sure?`, document.title, (x) => { x && quit(); });
          } else {
            quit();
          }
        }, 10);
        return false;
      }
      if (D.ide && !D.ide.connected && D.desktop) D.wins[0].histWrite();
      // let the new instance start before this one goes
      if (D.ide && D.prf.connectOnQuit() && D.desktop) {
        /* eslint-disable-next-line no-console */
        return D.newSession().then(() => true, (e) => { console.error(e); return true; });
      }
      return true;
    };
    if (!D.desktop) {
      window.onbeforeunload = (e) => {
        try {
          if (!mayClose()) e.returnValue = false;
        } finally {
          e.returnValue === false || (window.onbeforeunload = null);
        }
      };
    } else if (D.host.win.current() === 'main') {
      D.host.win.onCloseRequested('main', mayClose);
    }

    let platform = '';
    if (D.mac) platform = ' platform-mac';
    else if (D.win) platform = ' platform-windows';

    if (D.desktop) document.body.className += platform;

    window.focused = true;
    window.onblur = (x) => { window.focused = x.type === 'focus'; };
    window.onfocus = window.onblur;
    // Implement access keys (Alt-X) using <u></u>.
    // HTML's accesskey=X doesn't handle duplicates well -
    // - it doesn't always favour a visible input over a hidden one.
    // Also, browsers like Firefox and Opera use different shortcuts -
    // - (such as Alt-Shift-X or Ctrl-X) for accesskey-s.
    if (!D.mac) {
      $(document).on('keydown', (e) => { // Alt-A...Alt-Z or Alt-Shift-A...Alt-Shift-Z
        if (!e.altKey || e.ctrlKey || e.metaKey || e.which < 65 || e.which > 90) return undefined;
        const c = String.fromCharCode(e.which).toLowerCase();
        const C = c.toUpperCase();
        const $ctx = $('.ui-widget-overlay').length
          ? $('.ui-dialog:visible').last()
          : $('body'); // modal dialogs take priority

        const $a = $('u:visible', $ctx).map((i, n) => {
          const h = n.innerHTML;
          if (h !== c && h !== C) return undefined;
          let $i = $(n).closest(':input,label,a').eq(0);
          if ($i.is('label')) $i = $(`#${$i.attr('for')}`).add($i.find(':input')).not(':disabled').eq(0);
          return $i[0];
        });
        if ($a.length > 1) {
          $a.eq(($a.index(':focus') + 1) % $a.length).focus();
        } else if ($a.is(':checkbox')) {
          $a.focus().prop('checked', !$a.prop('checked')).change();
        } else if ($a.is(':text,:password,textarea,select')) {
          $a.focus();
        } else { $a.click(); }
        return !$a.length;
      });
    }
    if (D.desktop) {
      // drag and drop
      D.host.win.onFileDrop((files) => {
        const [path] = files;
        if (!D.ide || !path) {
          // no session or no file dragged
        } else if (!/\.dws$/i.test(path)) {
          toastr.error('Ride supports drag and drop only for .dws files.');
        } else if (files.length !== 1) {
          toastr.error('Ride does not support dropping of multiple files.');
        } else {
          if (!D.isLocalInterpreter) {
            toastr.warning(
              'Drag and drop of workspaces works only for locally started interpreters.',
              'Load may fail',
            );
          }
          $.confirm(
            `Are you sure you want to )load ${path.replace(/^.*[\\/]/, '')}?`,
            'Load workspace',
            (x) => { if (x) D.ide.exec([`      )load ${path}\n`], 0); },
          );
        }
      }).catch((e) => console.error(e)); // eslint-disable-line no-console

      // extra css and js, read relative to the working directory
      /* eslint-disable no-console */
      const { env } = D.host.sys;
      const paths = (x) => (x || '').split(D.win ? ';' : ':').filter((y) => y);
      paths(env.RIDE_JS).forEach((x) => {
        D.host.fs.readText(x).then((s) => { $.globalEval(s); }, (e) => console.error(e));
      });
      paths(env.RIDE_CSS).forEach((x) => {
        D.host.fs.readText(x).then((s) => { $('<style>').text(s).appendTo('head'); }, (e) => console.error(e));
      });
      /* eslint-enable no-console */
    }
  };

  Promise.all([D.mop, D.host && D.host.ready]).then(() => init());
}
