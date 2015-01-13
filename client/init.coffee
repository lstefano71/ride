do ->
  if window.require?
    nww = require('nw.gui').Window.get()
    $ -> # font size control in node-webkit
      $(document)
        .on 'keydown', '*', 'ctrl++ ctrl+=', -> nww.zoomLevel++;   false
        .on 'keydown', '*', 'ctrl+-',        -> nww.zoomLevel--;   false
        .on 'keydown', '*', 'ctrl+0',        -> nww.zoomLevel = 0; false
      return
  Dyalog.urlParams = {}
  for kv in (location + '').replace(/^[^\?]*($|\?)/, '').split '&'
    [_, k, v] = /^([^=]*)=?(.*)$/.exec kv; Dyalog.urlParams[unescape(k or '')] = unescape(v or '')
  if opener && (win = Dyalog.urlParams.win)? # are we running in a floating editor window?
    $ ->
      wins = opener.Dyalog.wins
      $('body').html('<div class="ui-layout-center"></div>').layout
        defaults: enableCursorHotkey: 0
        center: onresize: -> ed?.updateSize(); return
        fxName: ''
      ed0 = wins[win]; ed = wins[win] = Dyalog.Editor $('.ui-layout-center'), ed0.getOpts()
      ed.setValue ed0.getValue(); ed.setCursorIndex ed0.getCursorIndex(); ed.updateSize(); ed.focus()
      return
  else
    if window.require? # are we running under node-webkit?
      class FakeSocket
        emit: (e, a...) -> @other.onevent e: e, data: a
        onevent: ({e, data}) -> (for f in @[e] or [] then f data...); return
        on: (e, f) -> (@[e] ?= []).push f; @
      socket = new FakeSocket; socket1 = new FakeSocket; socket.other = socket1; socket1.other = socket
      require('./proxy').Proxy()(socket1)
      Dyalog.quit = -> require('nw.gui').Window.get().close(); return
    else
      socket = io()
      Dyalog.quit = close
    Dyalog.socket = socket
    $ -> Dyalog.connectPage(); return

  $ -> $(document).on 'keydown', '*', 'shift+f1', -> Dyalog.about(); false
  return
