# Claude Sessions

A local web app that shows every Claude Code session across every folder — terminal
and VS Code alike — in one list, with search and one-click resume.

Claude Code already writes every session to `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
no matter which surface it started from. This app indexes those files; it doesn't
track anything live and never writes to them.

macOS only — resume drives Terminal.app and VS Code through AppleScript.

## Install

```bash
npm install -g --install-links github:pierreremybalian/claude-sessions
```

That puts a `claude-sessions` command on your PATH. Node 18 or newer.

`--install-links` is not optional: without it npm leaves the package a symlink into a
temp clone it then deletes, and you get no command at all. The built UI ships in the
repo, so nothing compiles at install time.

Or work from a checkout:

```bash
git clone https://github.com/pierreremybalian/claude-sessions.git
cd claude-sessions
npm install
npm start
```

To put a checkout behind the global `claude-sessions` command while you work on it:

```bash
npm link
```

## Run it

```bash
claude-sessions
```

http://localhost:5178, reachable only from this Mac.

```bash
claude-sessions --lan
```

Also binds the local network and prints a link with an access token, plus a QR code
to point a phone at. Everything else:

```
claude-sessions --open              open the browser once the server is up
claude-sessions --port 6000         listen somewhere else
claude-sessions token               print the token and the LAN link
claude-sessions token --reset       issue a new token, invalidating the old one
claude-sessions --help
```

## Menu bar app

```bash
npm run menubar:install
```

Builds `Claude Sessions.app` with `swiftc` (Xcode Command Line Tools), drops it in
`/Applications` and launches it. It runs as a menu bar item with no dock icon:

- **Open Claude Sessions** — the browser, on localhost
- **Share on the Network** — flips the server into LAN mode and back
- **Copy Link for Another Device** / **Show QR Code…** — the tokenized LAN link
- Start, stop, restart, and the server log

It starts the server itself, and notices one you already started in a terminal
instead of fighting it for the port.

To start it at login: System Settings → General → Login Items → **+** → `Claude Sessions.app`.

## Reaching it from another device

`--lan` binds `0.0.0.0` and gates every request with a token stored in
`~/.claude-sessions/token` (mode 0600). Requests from this Mac skip the token; requests
from the network present it once as `?token=…`, then the server sets a cookie and drops
it from the URL. The Bonjour name (`your-mac.local:5178`) survives DHCP handing your Mac
a new IP, so it's the more durable of the two printed links.

**Resume is disabled for remote clients.** Tapping Terminal on your phone would open a
Terminal window on the Mac at your desk, so the remote UI shows the resume command to
copy instead. Turn it back on deliberately:

```bash
claude-sessions --lan --allow-remote-actions
```

Two things this is not: it is plain HTTP with a bearer token, so anyone who can see your
wifi traffic can see your transcripts, and the token is the only thing between a device
on the network and every prompt you have ever typed into Claude Code. Use it on a network
you trust. For access from outside the house, put it behind Tailscale rather than
forwarding a port — the app stays bound to the tailnet and never touches the open
internet.

## What it does

- **Session list** — every session with its folder, git branch, prompt count and
  last-active time. Filter by folder, by source (Terminal / VS Code / SDK), by date;
  sort by recency, prompt count or size.
- **Search** — the toolbar input filters titles and paths. Flip **Search inside
  transcripts** to full-text search the message content of every session (via the
  ripgrep binary bundled with `@vscode/ripgrep`).
- **Transcript viewer** — read a session without resuming it. Markdown rendering,
  tool calls collapsed into expandable rows showing input and result.
- **Resume** — `Terminal` opens a new Terminal.app window in the session's folder
  running `claude --resume <id>`. `Copy` puts that command on your clipboard.

## Two things worth knowing

**First Terminal resume triggers a permission prompt.** macOS asks whether node may
control Terminal. Approve it once, or find it later under System Settings → Privacy &
Security → Automation.

**The VS Code button can't resume inside the extension** — that UI isn't scriptable.
It opens the folder in VS Code and copies `claude --resume <id>` so you can paste it
into the integrated terminal (Ctrl+`).

## Why some sessions say "expired"

Claude Code deletes transcripts older than `cleanupPeriodDays` (the default is 30). Those
sessions are genuinely gone and **cannot be resumed** — but `~/.claude/history.jsonl`
still remembers your prompts, so the app lists them greyed out under **Include expired**
to show what you worked on.

## Development

```bash
npm run dev
```

API on 5178, Vite with HMR on 5177. `npm run build` refreshes `dist/`, which is
committed — rebuild and commit it whenever the UI changes, or installs will ship a
stale interface.

State lives in `~/.claude-sessions/`: the access token, the session index cache, and the
menu bar app's log.

## License

MIT
