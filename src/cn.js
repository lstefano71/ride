// Connect page and interpreter connection. Sets D.cn.
// The socket and message framing live in D.host.conn; the RIDE protocol stays here.
{
  let log;
  let $sel = $(); // $sel:selected item(s)
  let sel; // sel:data associated with the selected item (only if it's unique)
  let q; // a dictionary of DOM elements whose ids start with "cn_", keyed by the rest of the id
  const interpreters = [];
  let interpretersSSH = []; // local interpreters and those listed through ssh
  let clt; // client, a D.host.conn connection to the interpreter
  let child; // a ChildProcess instance, the result from spawn()
  let srv; // server, used to listen for connections from interpreters
  // Node is reachable only in the Electron shell, for starting, listening and SSH, which
  // are out of scope for Tauri and stay Electron-only. Process facts come from D.host.sys.
  const rq = D.el ? nodeRequire : null;
  const fs = rq && rq('fs');
  const cp = rq && rq('child_process');
  const os = rq && rq('os');
  const net = rq && rq('net');
  const path = rq && rq('path');
  const sys = D.desktop ? D.host.sys : { env: {}, argv: [] };
  const penv = sys.env;
  const home = os ? os.homedir() : '';
  // Under Tauri only the loopback names count as local.
  const nets = os ? os.networkInterfaces() : {};
  const localhosts = [
    ...Object.keys(nets).map((intf) => nets[intf].map((k) => k.address)).flat(),
    'localhost', '127.0.0.1', '::1',
  ];
  const untildify = (x) => (x && home ? x.replace(/^~(?=$|\/|\\)/, home) : x);
  const { esc } = D.util;
  const user = penv.USER || penv.USERNAME || '';
  const MIN_V = [15, 0];
  const KV = /^([a-z_]\w*)=(.*)$/i;
  const WS = /^\s*$/; // KV:regexes for parsing env vars
  const HP = /^([^:]+|\[[^\]]+\])?(?::(\d+)?(\+)?)?$/; // regex for parsing host and port
  const pathNotFound = /The system cannot find the path specified/; // regex to check response from ssh exec
  const maxl = 1000;
  let protocolLogFile;
  const defaultProtocolLogFile = D.desktop
    ? `${sys.tempDir}${sys.platform === 'win32' ? '\\' : '/'}Ride-${D.versionInfo.version}-${sys.pid}.log`
    : '';
  const trunc = (x) => (x.length > maxl ? `${x.slice(0, maxl - 3)}...` : x);
  const shEsc = (x) => `'${x.replace(/'/g, "'\\''")}'`; // shell escape
  const sendEach = (x) => {
    if (clt) {
      x.forEach((y) => {
        log(`send ${trunc(y)}`);
        clt.send(y);
      });
    }
  };
  const dyalogArgs = (args) => {
    const i = sys.argv.indexOf('--');
    if (i < 0) return args;
    return sys.argv.slice(1 + i).concat(args);
  };
  // compare two versions of the form [major,minor]
  const cmpVer = (x, y) => x[0] - y[0] || x[1] - y[1] || 0;
  const ls = (x) => fs.readdirSync(x);
  const parseVer = (x) => x.split('.').map((y) => +y);
  const hideDlgs = () => {
    if (q) {
      I.dlg_modal_overlay.hidden = 1;
      q.connecting_dlg.hidden = 1;
      q.listen_dlg.hidden = 1;
      q.fetch.disabled = 0;
    }
  };
  // x: strings for $.err, or an error: a Node Error (SSH, spawn, listen) or a D.host.conn
  // error {name, code, message, hostname}
  const err = (...x) => {
    D.tmr && clearTimeout(D.tmr);
    delete D.tmr;
    hideDlgs();
    const [e] = x;
    if (!e || typeof e !== 'object') {
      $.err(...x);
    } else if (e.code === 'ENOTFOUND') {
      $.err(`The host "${e.hostname}" could not be found.`, 'Host not found');
    } else if (e.errors && e.errors.length > 1) {
      $.err(e.errors.map((y) => y.message).join('\n'), e.code);
    } else if (!['ECONNRESET', 'ETIMEDOUT', 'ABORT'].includes(e.code)) $.err(e.message, e.name);
  };
  const passwdPrompt = (text, title) => {
    setTimeout(() => D.util.stringDialog(
      {
        title,
        text,
        token: 1,
        pass: 1,
      },
      (p) => {
        setTimeout(() => {
          if (p) {
            q.ssh_pass.value = p;
            q.go.click();
          } else {
            $.err('Password and/or key file is required', () => { q.ssh_pass.focus(); });
          }
        }, 10);
      },
    ), 10);
  };
  const formatInterpreters = (interpretersList) => {
    interpretersList
      .sort((x, y) => cmpVer(y.ver, x.ver) || +y.bits - +x.bits
        || (y.edition === 'unicode') - (x.edition === 'unicode')
        || (y.opt > x.opt) - (y.opt < x.opt))
      .forEach((x) => {
        x.supported = cmpVer(x.ver, MIN_V) >= 0;
        x.name = `v${
          x.ver.join('.')}${
          x.bits === 64 ? '' : `, ${x.bits}-bit`}${
          x.edition === 'unicode' ? '' : `, ${x.edition.replace(/^./, (w) => w.toUpperCase())}`}${
          x.opt ? `, ${x.opt}` : ''}${
          x.supported ? '' : ' (unsupported)'}`;
      });
  };
  const getLocalInterpreters = () => { // collect information about installed interpreters
    interpreters.splice(0);
    if (!D.el) return; // starting an interpreter is Electron-only
    try {
      if (/^win/.test(process.platform)) {
        const s = cp.execSync(
          'reg query "HKEY_CURRENT_USER\\Software\\Dyalog" /s /v localdyalogdir',
          { timeout: 4000, encoding: 'UTF8' },
        );
        let b; // b:bits
        let v; // v:version
        let u; // u:edition
        let n; // n:match object
        s && s.split('\r\n').forEach((x) => {
          if (x) {
            if ((n = /^HK.*\\Dyalog APL\/W(-64)? (\d+\.\d+)( Unicode)?$/i.exec(x))) {
              [, b, v, u] = n;
              b = b ? 64 : 32;
              u = u ? 'unicode' : 'classic';
            } else if (v && (n = /^ *localdyalogdir +REG_SZ +(\S.*)$/i.exec(x))) {
              interpreters.push({
                exe: `${n[1]}\\dyalog.exe`,
                ver: parseVer(v),
                bits: b,
                edition: u,
                opt: '',
              });
            } else if (!/^\s*$/.test(x)) {
              b = null;
              v = null;
              u = null;
            }
          }
        });
      } else if (process.platform === 'darwin') {
        const rd = '/Applications';
        ls(rd).forEach((x) => {
          const n = /^Dyalog-(\d+\.\d+)\.app$/.exec(x);
          const exe = `${rd}/${x}/Contents/Resources/Dyalog/mapl`;
          n && fs.existsSync(exe) && interpreters.push({
            exe,
            ver: parseVer(n[1]),
            bits: 64,
            edition: 'unicode',
            opt: '',
          });
        });
      } else {
        const rd = '/opt/mdyalog';
        const sil = (g) => (x) => { try { g(x); } catch (_) { /* exception silencer */ } };
        ls(rd).forEach(sil((v) => {
          if (/^\d+\.\d+/.test(v)) {
            ls(`${rd}/${v}`).forEach(sil((b) => {
              if (b === '32' || b === '64') {
                ls(`${rd}/${v}/${b}`).forEach(sil((u) => {
                  if (u === 'unicode' || u === 'classic') {
                    const exe = `${rd}/${v}/${b}/${u}/mapl`;
                    fs.existsSync(exe) && interpreters.push({
                      exe,
                      ver: parseVer(v),
                      bits: +b,
                      edition: u,
                      opt: '',
                    });
                  }
                }));
              }
            }));
          }
        }));
      }
    } catch (e) { console.error(e); }
    formatInterpreters(interpreters);
  };
  const createPresets = () => {
    const prCr = [...D.prf.presetsCreated()];
    const newInterpreters = interpreters.filter((x) => {
      const inConns = D.conns.findIndex((y) => y.preset && y.exe === x.exe) >= 0;
      const inPrCr = prCr.indexOf(x.exe) >= 0;
      return x.supported && !inConns && !inPrCr;
    });
    const newPresets = newInterpreters.map((int) => ({
      name: int.name,
      type: 'start',
      subtype: 'raw',
      exe: int.exe,
      preset: true,
    }));
    const hasCreated = newPresets.length > 0;
    if (hasCreated) {
      prCr.push(...newPresets.map((x) => x.exe));
      D.prf.presetsCreated(prCr);
      D.conns.push(...newPresets);
    }
    return hasCreated;
  };
  const save = () => {
    const names = $('.name', q.favs).toArray().map((x) => x.innerText);
    const dups = names.filter((a, i) => names.indexOf(a) !== i);
    if (dups.length) {
      $.alert(
        `The following name${dups.length ? 's are' : ' is'} duplicated:\n${dups.join('\n')}`,
        'Duplicate connection names',
        () => {
          $(q.favs).list('select', names.indexOf(dups[0]));
          $(q.fav_name).focus();
        },
      );
      return;
    }
    if (!D.desktop) return;
    const b = [...q.favs.children]
      .map((x) => x.cnData);
    const { store } = D.host;
    const write = () => store.write('connections', JSON.stringify(b))
      .then((t) => { D.conns_modified = t; })
      .catch((e) => toastr.error(`${e.name}: ${e.message}`, 'Save failed'));
    store.mtime('connections').then((t) => {
      if (t == null || t === D.conns_modified) return write();
      return $.confirm(
        'Connections file has been modified, do you want to overwrite with your changes?',
        'Save connections',
        (x) => x && write(),
      );
    }).catch((e) => toastr.error(`${e.name}: ${e.message}`, 'Save failed'));
  };
  const favText = (x) => x.name || 'unnamed';
  const favDOM = (x) => {
    const e = document.createElement('div');
    e.cnData = x;
    e.innerHTML = `<span class="name">${esc(favText(x))}</span>\
    <button class="go tb_btn" title="Start now">\
      <span class="fas fa-play"></span>\
    </button>\
    <button class="cog tb_btn" title="Show config details">\
      <span class="fas fa-cog"></span>\
    </button>`;
    return e;
  };
  const updExes = () => {
    const ssh = q.subtype.value === 'ssh';
    q.exes.innerHTML = (ssh ? interpretersSSH : interpreters)
      .map((x) => `<option value="${esc(x.exe)}"${x.supported ? '' : ' disabled'}>${esc(x.name)}`)
      .join('').concat('<option value="">Other...');
    q.exes.value = q.exe.value;
    if (!q.exes.value) {
      q.exes.selectedIndex = 0;
      q.exe.value = q.exes.value;
    }
    q.exe.disabled = !!q.exes.value;
  };
  const updSubtype = () => {
    const t = q.type.value;
    const s = q.subtype.value;
    sel && (sel.subtype = s);
    q.respawn.hidden = t !== 'listen';
    q.cwd_fld.hidden = !(q.ssh.hidden = s !== 'ssh');
    q.tcp_dtl.hidden = t === 'start' && s === 'raw';
    q.tcp_port.placeholder = q.tcp_dtl.hidden ? 0 : 4502;
    q.ssl.hidden = s !== 'ssl';
    q.fetch.disabled = q.ssh.hidden;
    updExes();
  };
  const updFormDtl = () => {
    q.subtype.hidden = q.type.value === 'listen';
    if (q.type.value === 'listen'
      || (q.type.value === 'start' && q.subtype.value === 'ssl')) q.subtype.value = 'raw';
    updSubtype();
    q.ssl_opt.hidden = q.type.value !== 'connect';
    q.raw_opt.text = q.type.value === 'start' ? 'on this computer' : 'via TCP';
    q.fetch.hidden = q.type.value !== 'start';
    q.start.hidden = q.fetch.hidden;
  };
  const validate = (x) => {
    const t = x.type;
    const p = x.port;
    const ssh = x.subtype === 'ssh';
    if ((t === 'connect' || (t === 'start' && ssh) || t === 'listen')
      && p && (!/^\d*$/.test(p) || +p < (t !== 'listen') || +p > 0xffff)) {
      $.err('Invalid port', () => {
        (ssh ? q.ssh_port : q.tcp_port).select();
      });
      return 0;
    }
    if ((t === 'connect' && ssh) && x.tcp_port
      && (!/^\d*$/.test(x.tcp_port) || +x.tcp_port < 1 || +x.tcp_port > 0xffff)) {
      $.err('Invalid Ride port', () => { q.tcp_port.select(); });
      return 0;
    }
    if (t === 'start') {
      const a = (x.env || '').split('\n');
      const focusEnv = () => { q.env.focus(); };
      for (let i = 0; i < a.length; i++) {
        if (!KV.test(a[i]) && !WS.test(a[i])) {
          $.err('Invalid environment variables', focusEnv);
          return 0;
        }
      }
      if (!x.exe) {
        $.err('"Interpreter" is required', () => { q.exe.focus(); });
        return 0;
      }
      if (!!x.cwd && fs && !fs.existsSync(untildify(x.cwd))) {
        $.err(`${q.cwd.labels[0].innerText} "${untildify(x.cwd)}" does not exist`, () => { q.cwd.focus(); });
        return 0;
      }
      if (ssh) {
        if (!q.ssh_pass.value && !q.ssh_key.value) {
          passwdPrompt(`Password for user ${x.user || user}:`, 'Password');
          return 0;
        }
      }
    }
    return 1;
  };
  // c: a D.host.conn connection; the handshake and protocol run here
  const initInterpreterConn = (c) => {
    clt = c;
    hideDlgs();
    D.el && nodeRequire('electron').ipcRenderer.send('save-win', false);
    let old; // old:have we warned about an old interpreter?
    let handshakeDone = false;
    c.onMessage((m) => {
      log(`recv ${trunc(m)}`);
      if (m[0] === '[') {
        const u = JSON.parse(m);
        D.recv && D.recv(u[0], u[1]);
      } else if (m[0] === '<' && !old) {
        old = 1;
        err('This version of Ride cannot talk to interpreters older than v15.0');
      } else if (/^UsingProtocol=/.test(m)) {
        if (m.slice(m.indexOf('=') + 1) === '2') {
          handshakeDone = true;
        } else {
          err('Unsupported Ride protocol version');
        }
      }
    });
    c.onError((x) => {
      clt && err(x);
      clt = 0;
      D.ide && D.ide.die();
    });
    c.onClose(() => {
      if (handshakeDone) {
        log('interpreter disconnected');
        D.ide && D.ide.die();
      } else {
        err('Either no interpreter is listening on the specified port'
         + ' or the interpreter is already serving another Ride client.', 'Connection rejected');
        D.ide && D.ide.die();
        D.commands.CNC();
      }
      clt = 0;
    });
    sendEach([
      'SupportedProtocols=2', 'UsingProtocol=2',
      '["Identify",{"apiVersion":1,"identity":1}]', '["Connect",{"remoteId":2}]', '["GetWindowLayout",{}]',
    ]);
  };
  const sshExec = (x, cmd, f) => { // f:callback
    try { // see https://github.com/mscdex/ssh2/issues/238#issuecomment-87495628 for why we use tryKeyboard:true
      const c = new (rq('ssh2').Client)();
      const o = {
        host: x.host,
        port: x.port,
        username: x.user,
        tryKeyboard: true,
      };
      if (x.key) {
        o.privateKey = fs.readFileSync(x.key);
        x.pass && (o.passphrase = x.pass);
      } else {
        o.password = x.pass;
      }
      c.on('ready', () => { c.exec(cmd, { pty: { term: 'xterm' } }, f); })
        .on('tcp connection', (_, acc) => {
          initInterpreterConn(D.host.conn.adopt(acc()));
          new D.IDE().setConnInfo(o.host, 'SSH', sel ? sel.name : '');
        })
        .on('keyboard-interactive', (_, _1, _2, _3, fin) => { fin([x.pass]); })
        .on('error', err)
        .connect(o);
      return c;
    } catch (e) {
      if (e.message === 'Encrypted private key detected, but no passphrase given') {
        passwdPrompt(`Passphrase for encrypted key ${x.key}:`, 'Passphrase');
      } else err(e);
    }
    return null;
  };
  const ct = penv.RIDE_CONNECT_TIMEOUT || 60000;
  const cancelOp = (c) => {
    const cancel = (e) => {
      if (e) {
        clearTimeout(D.tmr);
        delete D.tmr;
      } else {
        err('Timed out');
      }
      c && c.end();
      hideDlgs();
      return !1;
    };
    D.tmr = setTimeout(cancel, ct);
    q.connecting_dlg_close.onclick = cancel;
  };
  const connect = (x) => {
    D.isLocalInterpreter = localhosts.includes(x.host.toLowerCase());
    const ac = new AbortController();
    let conn;
    D.host.conn.connect(x, { signal: ac.signal }).then((c) => {
      conn = c;
      // registered before initInterpreterConn's handler, so it reports errors first
      c.onError((e) => {
        log(`connect failed: ${e.message}`);
        if (D.tmr && D.ide && e.code === 'ECONNABORTED') {
          err('The interpreter is already serving another Ride client.', 'Connection closed by interpreter');
          D.ide.die();
          D.commands.CNC();
        } else err(e);
        clt = 0;
      });
      initInterpreterConn(c);
      new D.IDE().setConnInfo(x.host, x.port, sel ? sel.name : '');
    }, (e) => {
      log(`connect failed: ${e.message}`);
      err(e);
    });
    cancelOp({ end: () => (conn ? conn.close() : ac.abort()) });
  };

  const go = (conf) => { // "Go" buttons in the favs or the "Go" button at the bottom
    const x = conf || sel;
    if (!validate(x)) return 0;
    D.prf.defaultConfig(x.name);
    protocolLogFile = x.log;
    D.spawned = 0;
    try {
      switch (x.type || 'connect') {
        case 'connect':
          D.util.dlg(q.connecting_dlg, { modal: true });
          if (x.subtype === 'ssh') {
            const o = {
              host: x.host || 'localhost',
              port: +x.ssh_port || 22,
              user: x.user || user,
            };
            x.ssh_key && (o.key = x.ssh_key);
            x === sel && q.ssh_pass.value && (o.pass = q.ssh_pass.value);
            const c = sshExec(o, '/bin/sh', (e, sm) => {
              if (e) throw e;
              sm.on('close', (code, sig) => { D.ide && D.ide._sshExited({ code, sig }); c.end(); });
              c.forwardOut('', 0, '127.0.0.1', +x.port || 4502, (fe, client) => {
                if (fe) {
                  log('cannot forward out through ssh');
                  clt = 0;
                  err(fe);
                  clearTimeout(D.tmr);
                  delete D.tmr;
                  return;
                }
                const fc = D.host.conn.adopt(client);
                initInterpreterConn(fc);
                new D.IDE().setConnInfo(x.host, x.port, sel ? sel.name : '');
                fc.onError((ce) => {
                  log(`connect failed: ${ce.message}`);
                  clt = 0;
                  err(ce);
                  clearTimeout(D.tmr);
                  delete D.tmr;
                });
              });
            });
            c && c.on('error', () => {
              clearTimeout(D.tmr);
              delete D.tmr;
            });
            cancelOp(c);
          } else {
            connect({
              host: x.host || 'localhost',
              port: +x.port || 4502,
              ssl: x.subtype === 'ssl',
              cert: x.cert,
              key: x.key,
              subj: x.subj,
              rootcertsdir: x.rootcertsdir,
            });
          }
          break;
        case 'listen': {
          D.util.dlg(q.listen_dlg, { modal: true });
          const port = +(x.port || 4502);
          const host = x.host || '';
          q.listen_dlg_host.textContent = host;
          q.listen_dlg_port.textContent = `${port}`;
          q.listen_dlg_cancel.onclick = () => {
            srv && srv.close();
            hideDlgs();
            return !1;
          };
          srv = net.createServer((c) => {
            let t;
            const cHost = c && (t = c.request) && (t = t.connection) && t.remoteAddress;
            log(`interpreter connected from ${cHost}`);
            srv && srv.close();
            srv = 0;
            if (x.respawn) {
              const p = D.el.process.argv;
              cp.spawn(p[0], p.slice(1), {
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
                env: {
                  ...process.env,
                  RIDE_LISTEN: `${host}:${port}+`,
                },
              });
            }
            initInterpreterConn(D.host.conn.adopt(c));
            new D.IDE().setConnInfo(cHost, port, sel ? sel.name : '');
          });
          srv.on('error', (e) => {
            srv = 0;
            err(e);
          });
          srv.listen(port, host, () => {
            const o = srv.address();
            log(`listening on ${o.address}:${o.port}`);
            q.listen_dlg_host.textContent = o.address !== '::' ? o.address : 'host';
            q.listen_dlg_port.textContent = `${o.port}`;
          });
          break;
        }
        case 'start': {
          D.spawned = 1;
          const envusr = {};
          const a = (x.env || '').split('\n');
          for (let i = 0; i < a.length; i++) {
            const [, k, v] = KV.exec(a[i]) || [];
            k && (envusr[k] = v);
          }
          const env = {
            SINGLETRACE: '1',
            ...envusr,
            ...(!D.win || x.subtype === 'ssh') && { APLK0: 'default' },
            AUTOCOMPLETE_PREFIXSIZE: '0',
            CLASSICMODE: '1',
            RIDE_SPAWNED: '1',
          };
          if (x.subtype === 'ssh') {
            D.util.dlg(q.connecting_dlg, { modal: true });
            const o = {
              host: x.host || 'localhost',
              port: +x.ssh_port || 22,
              user: x.user || user,
            };
            x.ssh_key && (o.key = x.ssh_key);
            x === sel && q.ssh_pass.value && (o.pass = q.ssh_pass.value);
            const c = sshExec(o, '/bin/sh', (e, sm) => {
              if (e) throw e;
              let stdout = '';
              sm.on('data', (xx) => { stdout += xx; });
              sm.on('close', (code, sig) => {
                if (pathNotFound.test(stdout)) {
                  err('Remote connections to Windows hosts is not supported', 'Windows host');
                }
                D.ide && D.ide._sshExited({ code, sig });
                c.end();
              });
              c.forwardIn('', +x.port || 0, (fe, rport) => {
                if (fe) throw fe;
                let s0 = '';
                Object.keys(env).forEach((k) => { s0 += `${k}=${shEsc(env[k])} `; });
                const args = x.args ? x.args.replace(/\n$/gm, '').split('\n') : [];
                const s1 = dyalogArgs(args).map(shEsc).join(' ');
                sm.write(`${s0}RIDE_INIT=CONNECT:127.0.0.1:${rport} ${shEsc(x.exe)} ${s1} +s -q -nokbd >/dev/null\n`);
                hideDlgs();
              });
            });
            c && c.on('error', () => {
              clearTimeout(D.tmr);
              delete D.tmr;
            });
            cancelOp(c);
          } else {
            D.isLocalInterpreter = true;
            const onExit = (code, sig) => {
              srv && srv.close();
              srv = 0;
              clt = 0;
              child = 0;
              clearTimeout(D.tmr);
              delete D.tmr;
              if (code !== 0) {
                err(`Interpreter ${code != null ? `exited with code ${code}` : `received ${sig}`}`);
                D.ide && D.ide.die();
              }
            };
            const onError = (y) => {
              srv && srv.close();
              srv = 0;
              clt = 0;
              child = 0;
              clearTimeout(D.tmr);
              delete D.tmr;
              switch (y.code) {
                case 'ENOENT': err('Cannot find the interpreter\'s executable'); return;
                case 'EACCES': err('Access error when starting interpreter executable'); return;
                default: err('Failed to start interpreter');
              }
            };
            const cancel = (e) => {
              if (e) {
                clearTimeout(D.tmr);
                delete D.tmr;
              } else {
                err('Timed out');
              }
              srv && srv.close();
              srv = 0;
              if (child) {
                child.off('exit', onExit);
                child.off('error', onError);
                child.kill();
                child = 0;
              }
              hideDlgs();
              return !1;
            };
            srv = net.createServer((y) => {
              log('spawned interpreter connected');
              const adr = srv.address();
              srv && srv.close();
              srv = 0;
              initInterpreterConn(D.host.conn.adopt(y));
              new D.IDE().setConnInfo(adr.address, adr.port, sel ? sel.name : '');
              D.lastSpawnedExe = x.exe;
            });
            srv.on('error', (e) => {
              log(`listen failed: ${e}`);
              srv = 0;
              clt = 0;
              err(e);
              clearTimeout(D.tmr);
              delete D.tmr;
            });
            srv.listen(0, '127.0.0.1', () => {
              const adr = srv.address();
              const hp = `${adr.address}:${adr.port}`;
              let cwd = untildify(x.cwd || process.cwd());
              if (!x.cwd && (cwd === '/' || cwd === path.dirname(process.execPath))) {
                cwd = home;
              }
              log(`listening for connections from spawned interpreter on ${hp}`);
              log(`spawning interpreter ${JSON.stringify(x.exe)}`);
              let args = ['+s', '-q', '-nokbd'];
              const stdio = ['pipe', 'ignore', 'ignore'];
              if (/^win/i.test(process.platform)) { args = []; stdio[0] = 'ignore'; }
              args = dyalogArgs(args);
              if (x.args) args.push(...x.args.replace(/\n$/gm, '').split('\n'));
              try {
                child = cp.spawn(x.exe, args, {
                  cwd,
                  stdio,
                  detached: true,
                  env: {
                    ...process.env,
                    ...env,
                    RIDE_INIT: `CONNECT:${hp}`,
                  },
                });
              } catch (e) { err(e); return; }
              D.lastSpawnedExe = x.exe;
              child.on('exit', onExit);
              child.on('error', onError);
            });
            D.tmr = setTimeout(cancel, ct);
            q && (q.connecting_dlg_close.onclick = cancel);
          }
          break;
        }
        default:
      }
    } catch (e) { $.err(`${e}`); }
    return !1;
  };
  if (D.el) global.go = go; // test hook
  const setUpMenu = () => {
    D.InitHelp();
    const m = 'Ride'
    + '\n  About Ride=ABT'
    + '\n  -'
    + '\n  Preferences=PRF'
    + '\n  -'
    + '\n  &Quit=QIT'
    + ''
    + '\n&File'
    + '\n  New configuration=CNNW'
    + '\n  Clone configuration=CNCL'
    + '\n  Delete configuration=CNDL'
    + '\n  -'
    + '\n  Re-create preset configurations=CNCP'
    + '\n&Edit'
    + '\n  Undo=UND'
    + '\n  Redo=RDO'
    + '\n  -'
    + '\n  Cut=CT'
    + '\n  Copy=CP'
    + '\n  Paste=PT'
    + '\n  Select All=SA'
    + '\n&Help'
    + '\n  Getting &Started         =https://dyalog.com/introduction.htm'
    + '\n  -'
    + '\n  &Ride User Guide         =RHP'
    + '\n  Dyalog &Help             =DHI'
    + '\n  &Language Elements       =LEL'
    + '\n  &Documentation Centre    =DOX'
    + '\n  -'
    + '\n  Dyalog &Website          =https://dyalog.com/'
    + '\n  &Email Dyalog            =EMD'
    + '\n  -'
    + '\n  Read &Me                 =RME'
    + '\n  &Third Party Licences    =TPL';
    D.installMenu(D.parseMenuDSL(m));
  };
  const readConns = () => { // fill D.conns from connections.json
    D.conns = [];
    if (!D.desktop) return Promise.resolve();
    return D.host.store.read('connections').then((r) => {
      if (!r) return;
      D.conns.push(...JSON.parse(r.text));
      D.conns_modified = r.mtime;
    }).catch((e) => toastr.error(`${e.name}: ${e.message}`, 'Reading connections failed'));
  };
  const showPage = () => { // set up Connect page
    q = J.cn;
    I.cn.hidden = 0;
    // Launch-window layout: main.js's winstate in Electron, defaults elsewhere until
    // window bounds move onto D.host.win
    const winstate = D.el ? D.el.getGlobal('winstate')
      : { dx: 0, launchWin: { expandedWidth: 900, width: 400, expanded: true } };
    if (!D.el) { // starting, listening and SSH are Electron-only
      [q.type, q.subtype].forEach((s) => {
        [...s.options].filter((o) => /^(start|listen|ssh)$/.test(o.value)).forEach((o) => o.remove());
      });
    }
    $(I.cn).splitter().on('splitter-resize', () => {
      winstate.launchWin.width = q.lhs.offsetWidth;
    });
    setTimeout(setUpMenu, 100);
    getLocalInterpreters();
    const hasCreated = createPresets();
    if (!D.conns.length) D.conns.push({ type: 'connect' });
    D.conns.forEach((x) => { q.favs.appendChild(favDOM(x)); });
    if (hasCreated) save();
    I.cn.onkeyup = (x) => {
      const k = D.util.fmtKey(x);
      if (D.desktop && k === 'F12') {
        D.host.sys.toggleDevTools(D.host.win.current());
        return !1;
      }
      return !0;
    };
    q.fav_name.onkeyup = () => {
      const u = sel.name;
      const v = q.fav_name.value || '';
      if (u !== v) {
        v ? (sel.name = v) : delete sel.name;
        $sel.find('.name').text(favText(sel));
      }
    };
    q.fav_name.onchange = q.fav_name.onkeyup;
    const noSpace = (e) => { e.target.value = e.target.value.replace(/\s*/g, ''); };
    q.tcp_host.onchange = noSpace;
    q.tcp_port.onchange = noSpace;
    updFormDtl();
    q.type.onchange = () => {
      sel.type = q.type.value;
      updFormDtl();
      sel.exe = sel.exe || q.exe.value;
    };
    q.subtype.onchange = updSubtype;
    q.respawn_cb.onclick = () => {
      sel.respawn = q.respawn_cb.checked;
    };
    q.ssh_user.placeholder = user;
    const enterConnect = (event) => { if (event.keyCode === 13) { $('#cn_go').click(); } };
    $('#cn_tcp_host').keyup(enterConnect);
    $('#cn_tcp_port').keyup(enterConnect);
    $('#cn_ssh_host').keyup(enterConnect);
    $('#cn_ssh_port').keyup(enterConnect);
    $('#cn_exe').keyup(enterConnect);
    q.fetch.onclick = () => {
      if (!validate($.extend({}, sel, { exe: 'x' }))) return; // validate all except "exe"
      q.fetch.disabled = 1;
      const c = sshExec(
        {
          host: sel.host || 'localhost',
          port: +sel.ssh_port || 22,
          user: sel.user || user,
          pass: q.ssh_pass.value,
          key: q.ssh_key.value,
        },
        'PATH=/ unsetopt NOMATCH 2>/dev/null ; /bin/ls -1 /opt/mdyalog/*/*/*/mapl /opt/mdyalog/*/*/*/*/mapl /Applications/Dyalog-*/Contents/Resources/Dyalog/mapl 2>/dev/null',
        (e, sm) => {
          if (e) throw e;
          let s = '';
          interpretersSSH = [];
          sm.on('data', (x) => { s += x; })
            .on('close', () => {
              if (pathNotFound.test(s)) {
                err('Remote connections to Windows hosts is not supported', 'Windows host');
                c.end();
                return;
              }
              interpretersSSH = s.split(/\r?\n/).filter((x) => x).map((x) => {
                const a = x.split('/');
                return a[1] === 'opt' ? {
                  exe: x,
                  ver: parseVer(a[3]),
                  bits: +a[4],
                  edition: a[5],
                  opt: a[6] === 'mapl' ? '' : a[6],
                } : {
                  exe: x,
                  ver: parseVer(a[2].replace(/^Dyalog-|\.app$/g, '')),
                  bits: 64,
                  edition: 'unicode',
                  opt: '',
                };
              });
              formatInterpreters(interpretersSSH);
              updExes();
              if (sel) {
                sel.exe = q.exe.value;
                sel.exes = interpretersSSH;
              }
              q.fetch.disabled = 0;
              c.end();
              toastr.success(`${interpretersSSH.length} versions found`, 'Available interpreters fetched');
            })
            .on('error', (x) => {
              toastr.error(x.message, x.name);
              updExes();
              q.fetch.disabled = 0;
            });
        },
      );
    };
    q.exe.onkeyup = () => {
      q.exes.value || D.prf.otherExe(q.exe.value);
      sel && (sel.exe = q.exe.value);
    };
    q.exe.onchange = q.exe.onkeyup;
    q.exes.onchange = () => {
      const v = q.exes.value;
      q.exe.value = v || D.prf.otherExe();
      q.exe.disabled = !!v;
      $(q.exe).change();
      v || q.exe.focus();
      D.prf.selectedExe(v); // todo: do we still need this pref?
    };
    q.env_add.onclick = (x) => {
      if (x.target.nodeName !== 'A') return !0;
      const t = x.target.textContent;
      const k = t.split('=')[0];
      let s = q.env.value;
      const n = RegExp(`^${k}=(.*)$`, 'm').exec(s);
      if (n) {
        q.env.setSelectionRange(n.index + k.length + 1, n.index + n[0].length);
      } else {
        s = `${s.replace(/([^\n])$/, '$1\n')}${t}\n`;
        q.env.value = s;
        $(q.env).change();
        q.env.setSelectionRange((s.length - t.length) + k.length, s.length - 1);
      }
      return !1;
    };
    q.log_cb.onchange = () => {
      const noLog = !q.log_cb.checked;
      q.log.disabled = noLog;
      q.log_dots.disabled = noLog;
      q.log.value = noLog ? '' : defaultProtocolLogFile;
      $(q.log).change();
      D.util.elastic(q.log);
    };
    q.cert_cb.onchange = () => {
      const noCert = !q.cert_cb.checked;
      q.cert.disabled = noCert;
      q.key.disabled = noCert;
      q.cert_dots.disabled = noCert;
      q.key_dots.disabled = noCert;
      q.cert.value = '';
      q.key.value = '';
      sel.cert = '';
      sel.key = '';
      D.util.elastic(q.cert);
      D.util.elastic(q.key);
    };
    q.subj_cb.onclick = () => { sel.subj = q.subj_cb.checked ? '1' : ''; };
    q.rootcertsdir_cb.onchange = () => {
      const noCert = !q.rootcertsdir_cb.checked;
      q.rootcertsdir.disabled = noCert;
      q.rootcertsdir_dots.disabled = noCert;
      q.rootcertsdir.value = '';
      sel.rootcertsdir = '';
      D.util.elastic(q.rootcertsdir);
    };
    q.rootcertsdir_cb.onclick = () => {
      q.rootcertsdir_cb.checked && q.rootcertsdir.focus();
    };
    const browse = (x, title, directory) => {
      if (!D.desktop) return !1;
      D.host.dlg.open({ title, defaultPath: x.value, directory }).then((v) => {
        if (!v) return;
        x.value = v;
        D.util.elastic(x);
        $(x).change();
      }, (e) => toastr.error(`${e.name}: ${e.message}`, title));
      return !1;
    };
    q.log_dots.onclick = () => { browse(q.log, 'Protocol log'); };
    q.cert_dots.onclick = () => { browse(q.cert, 'Certificate'); };
    q.key_dots.onclick = () => { browse(q.key, 'Key'); };
    q.ssh_key_dots.onclick = () => { browse(q.ssh_key, 'SSH Key'); };
    q.rootcertsdir_dots.onclick = () => {
      browse(q.rootcertsdir, 'Directory with Root Certificates', true);
    };
    // q.ssh_auth_type.onchange = () => {
    //   const k = q.ssh_auth_type.value === 'key';
    //   q.ssh_pass.hidden = k;
    //   q.ssh_key.hidden = !k;
    //   q.ssh_key_dots.hidden = !k;
    //   sel.ssh_auth_type = q.ssh_auth_type.value;
    // };
    const toggleConfig = (show) => {
      const expanded = (show === undefined) ? !$(q.rhs).is(':visible') : !!show;
      winstate.launchWin.expanded = expanded;
      if (D.el) {
        const { height } = D.elw.getContentBounds();
        const newWidth = expanded ? winstate.launchWin.expandedWidth : winstate.launchWin.width;
        const minwidth = winstate.dx + (expanded ? 885 : 400);
        D.elw.setMinimumSize(minwidth, 400);
        D.elw.setContentSize(newWidth, height);
      }
      setTimeout(() => { I.cn.toggleMaximize(expanded ? winstate.launchWin.width : 0); }, 10);
      D.el && nodeRequire('electron').ipcRenderer.send('save-win', true);
    };
    toggleConfig(winstate.launchWin.expanded);
    $(q.favs).list().sortable({
      cursor: 'move',
      revert: true,
      axis: 'y',
      stop: save,
    })
      .on('click', '.go, .cog', (e) => {
        const t = $(e.currentTarget);
        const i = t.parentsUntil(q.favs).last().index();
        $(q.favs).list('select', i);
        t.hasClass('go') ? q.go.click() : toggleConfig();
      })
      .on('keydown', (x) => {
        switch (D.util.fmtKey(x)) {
          case 'Ctrl-N': q.neu.click(); return !1;
          case 'Delete': q.del.click(); return !1;
          case 'Ctrl-D': q.cln.click(); return !1;
          default: return !0;
        }
      })
      .on('list-order-changed', save)
      .on('list-selection-changed', () => {
        $sel = $('.list_sel', q.favs);
        const u = $sel.length === 1; // is selection unique?
        q.cln.disabled = !u;
        q.del.disabled = !$sel.length;
        q.rhs.hidden = !u;
        sel = u ? $sel[0].cnData : null;
        if (u) {
          $(':checkbox[name]', q.rhs).each((_, x) => { x.checked = !!+sel[x.name]; });
          q.type_dtl.hidden = sel.preset;
          q.exes_dtl.hidden = sel.preset;
          q.type.value = sel.type || 'connect';
          q.subtype.value = sel.subtype || 'raw';
          interpretersSSH = Array.isArray(sel.exes) ? sel.exes : [];
          updFormDtl();
          updExes();
          q.fav_name.value = sel.name || '';
          $(':text[name],textarea[name]', q.rhs).each((_, x) => { x.value = sel[x.name] || ''; });
          q.exes.value = sel.exe;
          q.exes.value || (q.exes.value = ''); // use sel.exe if available, otherwise use "Other..."
          const a = q.rhs.querySelectorAll('input,textarea');
          for (let i = 0; i < a.length; i++) if (/^text(area)?$/.test(a[i].type)) D.util.elastic(a[i]);
          // q.ssh_auth_type.value = sel.ssh_auth_type || 'pass';
          // q.ssh_auth_type.onchange();
          const nol = !sel.log;
          q.log_cb.checked = !nol;
          q.log.disabled = !sel.log;
          q.log_dots.disabled = !sel.log;
          q.cert_cb.checked = !!sel.cert;
          const noc = !sel.cert;
          q.cert.disabled = noc;
          q.key.disabled = noc;
          q.cert_dots.disabled = noc;
          q.key_dots.disabled = noc;
          q.subj_cb.checked = !!sel.subj;
          q.rootcertsdir_cb.checked = !!sel.rootcertsdir;
          q.rootcertsdir.disabled = !sel.rootcertsdir;
          q.rootcertsdir_dots.disabled = !sel.rootcertsdir;
          q.ssh_pass.value = '';
          q.exe.disabled = !!q.exes.value;
          q.exe.onchange();
        }
      });
    { const [a] = q.favs.querySelectorAll('a'); a && a.focus(); }
    D.configNew = () => {
      if ($(q.rhs).is(':hidden')) {
        toggleConfig();
      }
      const $e = $(favDOM({}));
      q.favs.appendChild($e[0]);
      $(q.favs).list('select', $e.index());
      q.fav_name.focus();
    };
    q.neu.onclick = D.configNew;
    D.configClone = () => {
      if (sel) {
        const cnf = favDOM({
          ...sel,
          name: `${sel.name} (copy)`,
          preset: false,
        });
        sel.preset ? q.favs.appendChild(cnf) : q.favs.insertBefore(cnf, $sel[0]);
        save();
        $(q.favs).list('select', $(cnf).index());
        q.fav_name.focus();
      }
    };
    q.cln.onclick = D.configClone;
    D.configDelete = () => {
      const n = $sel.length;
      n && $.confirm(
        `Are you sure you want to delete\nthe selected configuration${n > 1 ? 's' : ''}?`,
        'Confirmation',
        (x) => {
          if (x) {
            const i = Math.min($sel.eq(0).index(), q.favs.children.length - 1);
            $sel.remove();
            const connsInd = D.conns.indexOf($sel[0].cnData);
            if (connsInd >= 0) D.conns.splice(connsInd, 1);
            save();
            $(q.favs).list('select', i);
          }
        },
      );
    };
    q.del.onclick = D.configDelete;
    q.go.onclick = () => { go(); return !1; };
    const a = q.rhs.querySelectorAll('input,textarea');
    for (let i = 0; i < a.length; i++) if (/^text(area)?$/.test(a[i].type)) D.util.elastic(a[i]);
    $(':text[name],textarea[name]', q.rhs).change((e) => {
      const t = e.target;
      const k = t.name;
      const v = t.value;
      v ? (sel[k] = v) : delete sel[k];
      save();
    });
    $(':checkbox[name]', q.rhs).change((e) => {
      const t = e.target;
      t.checked ? (sel[t.name] = 1) : delete sel[t.name];
      save();
    });
    $('select[name]', q.rhs).change(() => {
      save();
    });
    updExes();
    document.title = 'New Session - Ride';
    const conf = penv.RIDE_CONF;
    if (conf) {
      const i = [...q.favs.children].findIndex((x) => x.cnData.name === conf);
      if (i < 0) $.err(`Configuration '${conf}' not found.`);
      else {
        setTimeout(() => {
          $(q.favs).list('select', i);
          q.go.click();
        }, 1);
        return;
      }
    }
    const autoStart = penv.RIDE_AUTO_START ? penv.RIDE_AUTO_START === '1' : D.prf.autoStart();
    let i = 0;
    if (!autoStart) {
      const defcfg = D.prf.defaultConfig();
      i = [...q.favs.children].findIndex((x) => x.cnData.name === defcfg);
      if (i < 0) i = 0;
    }
    setTimeout(() => {
      $(q.favs).list('select', i);
      if (autoStart) q.go.click();
    }, 1);
  };
  D.recreatePresets = () => {
    D.prf.presetsCreated([]);
    const hasCreated = createPresets();
    if (!hasCreated) return;
    const favItems = [...q.favs.children].map((x) => x.cnData);
    D.conns.forEach((x) => {
      if (!favItems.includes(x)) q.favs.appendChild(favDOM(x));
    });
    save();
  };
  // Boot: connect, listen or spawn as the environment and arguments ask, else show the
  // Connect page. Under Tauri those reach cn.js with the D.host.sys snapshot.
  const start = () => {
    D.send = (x, y) => {
      if (D.ide && !D.ide.promptType
        && !/Interrupt$|TreeList|Reply|FormatCode|GetAutocomplete|SaveChanges|CloseWindow|Exit|SetPW/.test(x)) return;
      sendEach([JSON.stringify([x, y])]);
    };
    const a = sys.argv;
    const env = penv;
    const h = { // h:args by name
      c: env.RIDE_CONNECT,
      l: env.RIDE_LISTEN,
      s: env.RIDE_SPAWN || env.ride_spawn,
      log: env.RIDE_LOG,
    };
    if (D.mac && env.DYALOG_SPAWN && D.el) {
      const app = D.el.app.getAppPath();
      h.s = `${app}${env.DYALOG_SPAWN}`;
    }
    for (let i = 1; i < a.length; i++) if (a[i][0] === '-') { h[a[i].slice(1)] = a[i + 1]; i += 1; }
    if (!D.el && (h.l || h.s)) { // listening and starting are Electron-only
      toastr.warning('This build of Ride cannot listen or start an interpreter.', h.l ? 'RIDE_LISTEN ignored' : 'RIDE_SPAWN ignored');
      delete h.l;
      delete h.s;
    }
    if (h.c) {
      q = J.cn;
      const m = HP.exec(h.c); // parse host and port
      m ? go({
        type: 'connect',
        host: m[1],
        port: +m[2] || 4502,
        log: h.log,
      }) : $.err('Invalid $RIDE_CONNECT');
    } else if (h.l) {
      q = J.cn;
      const m = HP.exec(h.l); // parse host and port
      m ? go({
        type: 'listen',
        host: m[1],
        port: +m[2] || 4502,
        respawn: !!m[3],
        log: h.log,
      }) : $.err('Invalid $RIDE_LISTEN');
    } else if (h.s) {
      const cnf = {
        type: 'start',
        exe: h.s,
        log: h.log,
      };
      const openfile = D.el.getGlobal('open_file');
      if (openfile && /(dws|dcfg)$/i.test(openfile)) {
        const qt = /\s/.test(openfile) ? '"' : '';
        cnf.args = `LOAD=${qt}${openfile}${qt}`;
      }
      q = J.cn;
      go(cnf);
    } else { readConns().then(showPage); }
  };

  {
    let i = 0;
    const n = 100;
    const a = Array(n);
    const l = [];
    const t0 = +new Date();
    log = (x) => {
      const msg = `${new Date() - t0} ${x}`;
      if (protocolLogFile && D.desktop) {
        D.host.fs.appendText(protocolLogFile, `${new Date().toISOString()} ${x}\n`)
          .catch((e) => console.error(e));
      }
      a[i] = msg;
      i = (i + 1) % n;
      for (let j = 0; j < l.length; j++) l[j](msg);
    };
    D.cn = {
      start,
      getLog: () => a.slice(i).concat(a.slice(0, i)),
      addLogListener: (x) => { l.push(x); },
      rmLogListener: (x) => { const li = l.indexOf(x); li >= 0 && l.splice(li, 1); },
    };
  }
}
