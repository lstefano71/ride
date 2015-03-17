# Preferences UI
$d = null # dialogue instance, lazily initialized

ok = ->
  pk = $('#prefs-prefixKey').val(); wt = $('#prefs-windowTitle').val()
  # validate
  if pk.length != 1 then $.alert('Invalid prefix key', 'Error', -> $pk.focus(); return); return
  # apply changes
  prefs.prefixKey pk; prefs.windowTitle wt
  $d.dialog 'close'; false

D.prefs = prefs = module.exports = (tabName) ->
  if !$d # the dialogue, lazily initialized
    $d = $ """
      <div id="prefs">
        <ul id="prefs-tabs-nav">
          <li><a href="#prefs-tab-keyboard">Keyboard</a></li>
          <li><a href="#prefs-tab-title">Title</a></li>
        </ul>
        <div id="prefs-tab-keyboard">
          <label>Prefix key: <input id="prefs-prefixKey" class="text-field" size="1"></label>
        </div>
        <div id="prefs-tab-title">
          Window title:
          <input id="prefs-windowTitle" class="text-field">
          <pre>#{'''
            <a href='#'>{WSID}</a>            workspace name
            <a href='#'>{HOST}</a>:<a href='#'>{PORT}</a>     interpreter's TCP endpoint
            <a href='#'>{PID}</a>             PID of the interpreter process
            <a href='#'>{CHARS}</a>           Unicode or Classic
            <a href='#'>{BITS}</a>            64 or 32
            <a href='#'>{VER}</a>             interpreter version
              <a href='#'>{VER_A}</a>           major
              <a href='#'>{VER_B}</a>           minor
              <a href='#'>{VER_C}</a>           svn revision
            <a href='#'>{RIDE_VER}</a>        RIDE version
              <a href='#'>{RIDE_VER_A}</a>      major
              <a href='#'>{RIDE_VER_B}</a>      minor
              <a href='#'>{RIDE_VER_C}</a>      git commit number
          '''}</pre>
        </div>
      </div>
    """
      .tabs()
      .on 'keydown', 'input', 'return', ok
      .dialog modal: 1, autoOpen: 0, title: 'Preferences', minWidth: 600, minHeight: 400, buttons: [
        {text: 'OK', click: ok}
        {text: 'Cancel', click: -> $d.dialog 'close'; return}
      ]
    $('#prefs-tab-title pre a').attr 'title', 'Insert'
    $('#prefs-tab-title').on 'click', 'pre a', (e) ->
      $i = $ '#prefs-windowTitle'; s = $i.val(); p = $i[0].selectionStart; u = $(e.target).text(); $i.val s[...p] + u + s[p..]
      $i[0].selectionStart = $i[0].selectionEnd = p + u.length; return

  $d.dialog('option', 'position', at: 'center').dialog 'open'
  if tabName then $d.tabs active: $("#prefs-tabs-nav a[href='#prefs-tab-#{tabName}']").parent().index()

  # load current values
  $('#prefs-prefixKey').val prefs.prefixKey()
  $('#prefs-windowTitle').val prefs.windowTitle()
  return

# Preferences API -- localStorage should be accessed only through it
# Usage:
#   prefs.foo()                 # getter
#   prefs.foo(123)              # setter
#   prefs.foo (newValue) -> ... # add "on change" listener
#   prefs.foo.toggle()          # convenience function for booleans (numbers 0 and 1)
#   prefs.foo.getDefault()      # retrieve default value
prefs = module.exports
[ # name                    default
  ['favs',                  [host: '127.0.0.1', port: 4502]]
  ['floatingWindowInfos',   {}]
  ['floatNewEditors',       0]
  ['lineNumbersInDebugger', 0]
  ['lineNumbersInEditor',   1]
  ['prefixKey',             '`']
  ['sessionLineWrapping',   0]
  ['showLanguageBar',       1]
  ['theme',                 '']
  ['windowTitle',           '{WSID} - {HOST}:{PORT} (PID: {PID})']
  ['zoom',                  0]
]
.forEach ([k, d]) ->       # k: preference name, d: default value
  t = typeof d; l = []     # t: type, l: listeners
  str = if t == 'object' then JSON.stringify else (x) -> '' + x
  sd = str d               # sd: default value "d" converted to a string
  prefs[k] = p = (x) ->
    if typeof x == 'function'
      l.push x; return
    else if arguments.length
      if t == 'number' then x = +x else if t == 'string' then x = '' + x # coerce to type "t"
      sx = str x # sx: "x" converted to a string; localStorage values can only be strings
      if l.length then old = prefs[k]()
      if sx == sd then delete localStorage[k] else localStorage[k] = sx # avoid recording if it's at its default
      for f in l then f x, old # notify listeners
      x
    else
      if !(r = localStorage[k])? then d
      else if t == 'number' then +r
      else if t == 'object' then JSON.parse r
      else r
  p.getDefault = -> d
  p.toggle = -> p !p()
  return
