// two menu implementations -- one native (through D.host.menu) and one in html
let menuGen = 0; // bumped per native menu, so pref listeners of replaced menus go quiet
D.installMenu = function Menu(mx) {
  if (D.desktop) {
    const pk = D.prf.keys();
    const k = {}; // k:a map of all keyboard shortcuts
    for (let i = 0; i < D.cmds.length; i++) {
      const [c,, d] = D.cmds[i];
      [k[c]] = (pk[c] || d);
    } // c:code, d:defaults
    menuGen += 1;
    const gen = menuGen;
    const acts = {}; // id → DSL item
    const prefs = []; // [id, checkBoxPref]
    let n = 0;
    const render = (x) => {
      if (x[''] === '-') return { type: 'separator' };
      const id = `m${gen}.${n}`;
      n += 1;
      acts[id] = x;
      const h = {
        id,
        label: x[''],
        accelerator: x.cmd && k[x.cmd] ? k[x.cmd].replace(/-(.)/g, '+$1') : null,
      };
      if (x.group) {
        h.type = 'radio';
        h.checked = !!x.checked;
      } else if (x.checkBoxPref) {
        h.type = 'checkbox';
        h.checked = !!x.checkBoxPref();
        prefs.push([id, x.checkBoxPref]);
      }
      const roles = {
        cut: 0,
        copy: 0,
        paste: 0,
        togglefullscreen: 0,
        window: 0,
        help: 0,
        hide: 0,
        hideothers: 0,
        showall: 'unhide',
      };
      const r = x[''].replace(/[& ]/g, '').toLowerCase();
      if (r in roles) h.role = roles[r] || r;
      if (x.items) h.items = x.items.map(render);
      return h;
    };
    const template = mx.map(render);
    const onClick = (id, checked) => {
      const x = acts[id];
      if (!x || !x.action) return;
      x.checkBoxPref ? x.action(checked) : x.action();
    };
    D.host.menu.setApp(template, onClick).then((m) => {
      prefs.forEach(([id, p]) => {
        gen === menuGen && m.setChecked(id, !!p());
        p((v) => { gen === menuGen && m.setChecked(id, !!v); });
      });
    }, (e) => { console.error(e); }); // eslint-disable-line no-console
  } else {
    const arg = mx;
    // DOM structure:
    // ┌.menu───────────────────────────────────────────┐
    // │┌div.m-sub────────────────────────────────┐     │
    // ││            ┌div.m-box──────────────────┐│     │
    // ││┌a.m-opener┐│┌a─────┐┌a─────┐┌div.m-sub┐││     │
    // │││┌span┐    │││┌span┐││┌span┐││         │││     │
    // ││││File│    ││││Open││││Save│││   ...   │││ ... │
    // │││└────┘    │││└────┘││└────┘││         │││     │
    // ││└──────────┘│└──────┘└──────┘└─────────┘││     │
    // ││            └───────────────────────────┘│     │
    // │└─────────────────────────────────────────┘     │
    // └────────────────────────────────────────────────┘
    // Top-level ".m-opener"-s also have class ".m-top"
    let $o; // original focused element
    let $m;
    const mFocus = (anchor) => {
      $m.find('.m-open').removeClass('m-open');
      if (!anchor) { $o && $o.focus(); $o = null; return; }
      $o || ($o = $(':focus'));
      const $a = $(anchor);
      $a.parentsUntil('.menu').addClass('m-open');
      $a.is('.m-top') ? $a.closest('.m-sub').find('a').eq(1).focus() : $a.focus();
    };
    const render = (x) => {
      if (!x) return null;
      if (x[''] === '-') return $('<hr>');
      let acc;
      const name = x[''].replace(/&(.)/g, (_, k) => {
        const r = acc || k === '&' ? k : `<u>${acc = k}</u>`;
        return r;
      }); // acc:access key
      const $a = $(`<a href=#><span>${name}</span></a>`);
      x.cmd && $a.append(`<span class=m-shc data-cmd=${x.cmd}>`);
      if (x.group) {
        $a.addClass(`m-group-${x.group}`)
          .toggleClass('m-checked', !!x.checked)
          .on('mousedown mouseup click', (e) => {
            const $e = $(e.currentTarget);
            $e.closest('.menu').find(`.m-group-${x.group}`).removeClass('m-checked');
            $e.addClass('m-checked');
            mFocus(null);
            x.action && x.action();
            return !1;
          });
      } else if (x.checkBoxPref) {
        x.checkBoxPref((v) => { $a.toggleClass('m-checked', !!v); });
        $a.toggleClass('m-checked', !!x.checkBoxPref())
          .on('mousedown mouseup click', (e) => {
            mFocus(null);
            x.action && x.action($(e.currentTarget).hasClass('m-checked'));
            return !1;
          });
      } else {
        x.action && $a.on('mousedown mouseup click', () => { mFocus(null); x.action(); return !1; });
      }
      if (!x.items) return $a;
      const $b = $('<div class=m-box>');
      return $('<div class=m-sub>')
        .append($a.addClass('m-opener'), $b.append(...x.items.map(render)));
    };
    const leftRight = (d, $e) => { // d: +1 or -1, $e: target element
      if (d > 0 && $e.is('.m-opener')) {
        mFocus($e.next('.m-box').find('a').first());
      } else if (d < 0 && !$e.is('.m-opener') && $e.parents('.m-sub').length > 1) {
        mFocus($e.closest('.m-sub').find('.m-opener').first());
      } else {
        const $t = $m.children();
        const n = $t.length;
        const i = $e.parentsUntil('.menu').last().index();
        mFocus($t.eq((i + d + n) % n).find('a').eq(1));
      }
      return !1;
    };
    const upDown = (d, $e) => { // d: +1 or -1, $e: target element
      if ($e.is('.m-top')) {
        mFocus($e.parent().find(':not(hr)').eq(1));
      } else {
        const $s = $e.closest('.m-box').children(':not(hr)');
        const i = $s.index($e);
        const n = $s.length;
        const $f = $s.eq((i + d + n) % n);
        mFocus($f.is('a') ? $f : $f.find('a').first());
      }
      return !1;
    };
    $m = $('div[class=menu]');
    $m.length || ($m = $('<div class=menu>').prependTo('body'));
    $m.empty()
      .addClass('menu')
      .append(arg.map(render));
    $m.find('>.m-sub>.m-opener').addClass('m-top');
    $m.on('mouseover', 'a', (e) => {
      const t = e.currentTarget;
      $(t).closest('.menu').children().is('.m-open') && mFocus(t);
    });
    $m.on('mousedown click', 'a', (e) => {
      const t = e.currentTarget;
      mFocus($(t).parentsUntil('.menu').last().is('.m-open') && e.type === 'mousedown' ? null : t);
      return !1;
    });
    $m.keydown((e) => {
      switch (e.key) {
        case 'ArrowLeft': leftRight(-1, $(e.target)); break;
        case 'ArrowRight': leftRight(1, $(e.target)); break;
        case 'ArrowUp': upDown(-1, $(e.target)); break;
        case 'ArrowDown': upDown(1, $(e.target)); break;
        case 'Escape': case 'F10': mFocus(null); return !1;
        default:
      }
      return !0;
    });
    $(document).mousedown((e) => { $(e.target).closest('.menu').length || mFocus(null); });
    const updShcs = (h) => {
      const k = {};
      for (let i = 0; i < D.cmds.length; i++) {
        const [c,, d] = D.cmds[i];
        [k[c]] = (h[c] || d);
      } // c:code, d:defaults
      $('.m-shc').each((e) => {
        const $e = $(e.currentTarget);
        $e.text(k[$e.data('cmd')] || '');
      });
    };
    updShcs(D.prf.keys()); D.prf.keys(updShcs);
  }
};
