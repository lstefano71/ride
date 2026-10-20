# RIDE

RIDE is a desktop client for the Dyalog APL interpreter. It talks to a running interpreter over the RIDE protocol.

## Language

**Interpreter**:
A running Dyalog APL process that RIDE talks to.
_Avoid_: backend, server

**Connection**:
A link from RIDE to one **Interpreter** over the RIDE protocol, made by connecting to an address the interpreter is serving on.

**Frontend**:
The HTML/JS/CSS user interface of RIDE (session, editors, tracer, dialogs), independent of which **Shell** hosts it.

**Shell**:
The native application that hosts the **Frontend**: either the Electron shell or the Tauri shell.
_Avoid_: host app, wrapper

**Host adapter**:
The single interface through which the **Frontend** reaches platform capabilities (connection, windows, menus, dialogs, storage). Each **Shell** provides one implementation.
_Avoid_: bridge, backend

**Floating window**:
An editor or tool window shown as its own OS window rather than docked in the main window.

**Window label**:
The stable name of one OS window of RIDE (the main window, the preferences window, a floating editor, …), used to address it when windows exchange messages.
_Avoid_: socket, window id

## Relationships

- A **Shell** hosts exactly one **Frontend** and provides one **Host adapter**.
- The **Frontend** uses the **Host adapter** to open a **Connection** to an **Interpreter**.
