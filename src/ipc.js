{
  const pm = ('die execCommand focus insert open processAutocompleteReply prompt saved setTC stateChanged' +
    ' update zoom ReplyFormatCode SetHighlightLine ValueTip').split(' ');
  // A floating window's link to the main window, in the shape ide.ipc expects.
  const toMain = { emit: (type, data) => D.host.ipc.send('main', type, data) };

  D.IPC_Client = function IPCClient(winId) {
    // floating editor window
    const { on } = D.host.ipc;
    D.send = (type, payload) => toMain.emit('RIDE', [type, payload]);
    const ide = new D.IDE({ floating: 1, ipc: toMain });
    pm.forEach((k) => on(k, ([id, ...x]) => { D.ide.wins[id][k](...x); }));
    on('caption', (c) => { D.ide.caption = c; });
    on('close', ([id]) => {
      D.ide.wins[id].close();
      toMain.emit('unblock', 0);
    });
    on('getUnsaved', () => {
      toMain.emit('getUnsavedReply', D.ide.getUnsaved());
    });
    on('prf', ([k, x]) => { D.prf[k](x, 1); });
    on('ED', (id) => D.ide.wins[id].ED(D.ide.wins[id].me));
    on('pendingEditor', (pe) => {
      const { editorOpts, ee } = pe;
      const ed = new D.Ed(D.ide, editorOpts);
      D.ide.wins[ed.id] = ed;
      ed.me_ready.then(() => {
        ed.open(ee);
        ed.updSize();
        ed.refresh();
        toMain.emit('unblock', ed.id);
        ed.meIsReady = true;
      });
      setTimeout(() => {
        const glr = D.ide.gl.root;
        const ci = glr.contentItems;
        if (!ci.length) glr.addChild({ type: 'stack' });
        ci[0].type === 'stack' && ci[0].header.position(ci[0].contentItems.length ? 'top' : false);
        glr.contentItems[0].addChild({
          type: 'component',
          componentName: 'win',
          componentState: { id: ed.id },
          title: ee.name,
        });
      }, 100);
    });
    on('syntax', (x) => {
      Object.assign(D.syntax, x);
      D.defineSyntaxRegex();
    });
    D.host.win.onCloseRequested(D.host.win.current(), () => {
      const e = {};
      ide.onbeforeunload(e);
      return e.returnValue !== false;
    });
    toMain.emit('browserCreated', winId);
  };

  D.IPC_Prf = function IPCPrf() {
    // preferences window: closing it only hides it
    const { on } = D.host.ipc;
    on('caption', (c) => { document.title = `Preferences - ${c}`; });
    on('show', (x) => D.prf_ui(x));
    on('prf', ([k, x]) => D.prf[k](x, 1));
    D.host.win.onCloseRequested(D.host.win.current(), () => {
      toMain.emit('prfClose');
      return false;
    });
    toMain.emit('prfCreated');
  };

  // Content bounds for the seq-th floating editor window: cascaded from the saved
  // position, or centred by the shell (x, y null) if that is now mostly off screen.
  const WindowRect = (seq, prf) => {
    let {
      x, y, width, height,
    } = prf;
    x += prf.ox * (seq - 1);
    y += prf.oy * (seq - 1);
    return D.host.win.displayFor({
      x, y, width, height,
    }).then((b) => {
      const vw = Math.max(0, Math.min(x + width, b.x + b.width) - Math.max(x, b.x));
      const vh = Math.max(0, Math.min(y + height, b.y + b.height) - Math.max(y, b.y));
      if (width * height > 2 * vw * vh) {
        // saved window position is now mostly off screen
        x = null; y = null;
        width = Math.min(width, b.width);
        height = Math.min(height, b.height);
      }
      return {
        x, y, width, height,
      };
    });
  };
  let winSeq = 0;
  let starting = 0; // editor windows created but not yet registered (browserCreated)
  D.IPC_CreateWindow = function IPCCreateWindow(seq) {
    winSeq += 1;
    starting += 1;
    const n = winSeq;
    WindowRect(seq, D.prf.editWins()).then((bounds) => D.host.win.open(
      `editor${n}`,
      `index.html?type=editor&winId=${n}`,
      { parent: 'main', bounds, hidden: true },
    )).catch((e) => {
      starting -= 1;
      console.error(e); // eslint-disable-line no-console
    });
  };

  D.IPC_Server = function IPCServer() {
    // main window: the hub every other window talks to
    let dlgLoaded;
    let prfLoaded;
    let statLoaded;
    const winsLoaded = [
      new Promise((r) => { dlgLoaded = r; }),
      new Promise((r) => { prfLoaded = r; }),
      new Promise((r) => { statLoaded = r; }),
    ];
    D.pwins = [];
    D.pendingEditors = [];
    const { on, send } = D.host.ipc;
    on('prfCreated', () => prfLoaded(true));
    on('prfShow', (x) => D.prf_ui(x));
    on('prfClose', () => {
      D.host.win.hide('prf');
      D.ide && D.ide.focusMRUWin();
    });
    on('statCreated', (data, from) => {
      send(from, 'setTheme', D.theme);
      statLoaded(true);
    });
    on('statClose', () => {
      D.prf.statusWindow(0);
    });
    on('dialogCreated', (data, from) => {
      send(from, 'setTheme', D.theme);
      dlgLoaded(true);
    });
    on('dialogClose', ([t, r]) => {
      D.util.replyDialog(t, r);
      D.host.win.hide('dialog');
      D.ide && D.ide.focusMRUWin();
    });
    on('browserCreated', (winId, from) => {
      starting = Math.max(0, starting - 1);
      const wp = new D.IPC_WindowProxy(winId, from);
      send(from, 'caption', D.ide.caption);
      D.pwins.push(wp);
      D.IPC_LinkEditor();
    });
    on('Edit', (data) => D.ide.Edit(data));
    on('focusedWin', (id) => {
      const w = D.ide.wins[id];
      D.ide.focusedWin = w;
      w && (w.focusTS = +new Date());
    });
    on('pfKey', (x) => D.ide.pfKey(x));
    on('getStats', () => D.ide.getStats());
    on('getSyntax', (data, from) => {
      send(from, 'syntax', D.syntax);
    });
    on('getUnsavedReply', (data) => {
      if (!D.pendingEdit) return;
      Object.keys(data).forEach((k) => {
        if (data[k] && D.pendingEdit.unsaved[k] === -1) D.pendingEdit.unsaved[k] = data[k];
        else delete D.pendingEdit.unsaved[k];
      });

      if (!Object.values(D.pendingEdit.unsaved).includes(-1)) {
        D.send('Edit', D.pendingEdit);
        delete D.pendingEdit;
      }
    });
    on('getValueTip', (data) => D.ide.getValueTip(...data));
    on('prf', ([k, x]) => { D.prf[k](x); });
    on('switchWin', (data) => D.ide.switchWin(data));
    on('updPW', (data) => D.ide.updPW(data));
    on('unblock', (id) => {
      !!id && D.ide.wins[id].me_resolve(true);
      D.ide.unblock();
    });
    on('mounted', (id) => {
      D.ide.hadErr > 0 && (D.ide.hadErr -= 1);
      D.ide.focusWin(D.ide.wins[id]);
    });
    on('zoom', (z) => D.ide.zoom(z));
    on('ABT', () => D.commands.ABT());
    on('LOG', () => D.commands.LOG());
    on('NEW', () => D.commands.NEW());
    on('OWS', () => D.commands.OWS());
    on('RIDE', ([type, payload]) => D.send(type, payload));
    // content for the message-fed windows
    on('abtGet', (data, from) => {
      send(from, 'abt', { details: D.aboutDetails(), theme: D.theme });
    });
    on('html3500Get', (data, from) => {
      D.html3500 && send(from, 'html3500', D.html3500);
    });
    let logFeed;
    on('logGet', (data, from) => {
      const { cn } = D;
      logFeed && cn.rmLogListener(logFeed);
      logFeed = (x) => send(from, 'logAdd', `${x}`);
      send(from, 'log', {
        caption: D.ide ? D.ide.caption : '',
        text: cn.getLog().filter((x) => x).join('\n'),
      });
      cn.addLogListener(logFeed);
    });
    on('logClose', () => {
      logFeed && D.cn.rmLogListener(logFeed);
      logFeed = null;
    });
    return winsLoaded;
  };
  D.IPC_LinkEditor = function IPCLinkEditor(pe) {
    pe && D.pendingEditors.push(pe);
    if (!D.pendingEditors.length) return;
    let wp = D.prf.floatSingle() ? D.pwins[0] : D.pwins.find((w) => w.id < 0);
    if (!wp) {
      // a window still starting takes the pending editor once it registers
      starting < D.pendingEditors.length && D.IPC_CreateWindow(D.pendingEditors[0].editorOpts.id);
      return;
    }
    if (wp.id > 0) wp = Object.assign(new D.IPC_WindowProxy(), wp);
    D.host.win.show(wp.label);
    if (!D.prf.editWinsRememberPos()) {
      const { label } = wp;
      WindowRect(1 + (wp.bwId - D.pwins[0].bwId), D.prf.editWins()).then((o) => (o.x == null
        ? D.host.win.setContentSize(label, o.width, o.height)
        : D.host.win.setBounds(label, o)))
        .catch((e) => console.error(e)); // eslint-disable-line no-console
    }
    const ped = D.pendingEditors.shift();
    wp.id = ped.editorOpts.id;
    wp.tc = ped.editorOpts.tc;
    wp.focusTS = +new Date();
    D.wins[wp.id] = wp;
    D.host.ipc.send(wp.label, 'pendingEditor', ped);
  };

  // Stands in, in the main window, for an editor living in a floating window.
  // bwId: the window's sequence number (also the "is floating" flag); label: its window label.
  D.IPC_WindowProxy = function IPCWindowProxy(bwId, label) {
    const ed = this;
    ed.bwId = bwId;
    ed.label = label;
    ed.id = -1;
    ed.me = { dyalogCmds: ed };
    ed.me_ready = new Promise((r) => { ed.me_resolve = r; });
    ed.tc = 0;
    ed.focusTS = +new Date();
  };
  D.IPC_WindowProxy.prototype = {
    emit(f, ...x) { D.host.ipc.send(this.label, f, [this.id, ...x]); },
    hasFocus() { return this === D.ide.focusedWin; },
    close() {
      if (this === D.pwins[0] && D.prf.editWinsRememberPos()) {
        D.host.win.getBounds(this.label).then((b) => {
          D.prf.editWins(Object.assign(D.prf.editWins(), b));
        }).catch((e) => console.error(e)); // eslint-disable-line no-console
      }
      this.emit('close');
    },
    setTC(x) { this.emit('setTC', x); this.tc = x; },
    ED() { this.emit('ED'); },
    LN() { D.prf.lineNums.toggle(); },
    TVO() { D.prf.fold.toggle(); },
    TVB() { D.prf.breakPts.toggle(); },
  };
  const handlerFor = (k) => function handler(...x) { this.emit(k, ...x); };
  pm.forEach((k) => {
    D.IPC_WindowProxy.prototype[k] || (D.IPC_WindowProxy.prototype[k] = handlerFor(k));
  });
}
