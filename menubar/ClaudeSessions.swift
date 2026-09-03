import Cocoa

// A menu bar front end for the claude-sessions server: start it, stop it, open it,
// and hand the LAN link to a phone without typing a 48-character token.

let defaultPort = 5178

func configDir() -> String {
    (NSHomeDirectory() as NSString).appendingPathComponent(".claude-sessions")
}

func readTrimmed(_ path: String) -> String? {
    guard let s = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : t
}

/// Where the checkout lives. Baked in at build time, with a written-down fallback
/// so a moved app can be pointed at a new checkout without rebuilding.
func installRoot() -> String? {
    if let baked = Bundle.main.object(forInfoDictionaryKey: "CSInstallRoot") as? String,
       FileManager.default.fileExists(atPath: (baked as NSString).appendingPathComponent("bin/claude-sessions.js")) {
        return baked
    }
    if let saved = readTrimmed((configDir() as NSString).appendingPathComponent("root")),
       FileManager.default.fileExists(atPath: (saved as NSString).appendingPathComponent("bin/claude-sessions.js")) {
        return saved
    }
    return nil
}

/// Apps launched from Finder inherit a bare PATH, so ask a login shell where node is.
func nodePath() -> String? {
    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
    }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-lc", "command -v node"]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    try? p.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    let out = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return out.isEmpty ? nil : out
}

func lanAddress() -> String? {
    var addrs: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&addrs) == 0, let first = addrs else { return nil }
    defer { freeifaddrs(addrs) }
    var best: String?
    for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
        let flags = Int32(ptr.pointee.ifa_flags)
        guard flags & IFF_UP == IFF_UP, flags & IFF_LOOPBACK == 0 else { continue }
        guard let sa = ptr.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        guard getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count),
                          nil, 0, NI_NUMERICHOST) == 0 else { continue }
        let name = String(cString: ptr.pointee.ifa_name)
        let ip = String(cString: host)
        if name == "en0" { return ip }
        if best == nil { best = ip }
    }
    return best
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var server: Process?
    private var healthTimer: Timer?
    private var isUp = false
    private var isShared = false   // what the running server actually did, which may
                                   // be a terminal-started one this app merely adopted
    private var qrWindow: NSWindow?

    private var lanMode: Bool {
        get { UserDefaults.standard.bool(forKey: "lanMode") }
        set { UserDefaults.standard.set(newValue, forKey: "lanMode") }
    }
    private var port: Int {
        let saved = UserDefaults.standard.integer(forKey: "port")
        return saved > 0 ? saved : defaultPort
    }
    private var localURL: String { "http://localhost:\(port)" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // A second copy would put a second icon in the menu bar and fight over the
        // port, so the newcomer steps aside.
        let id = Bundle.main.bundleIdentifier ?? ""
        if NSRunningApplication.runningApplications(withBundleIdentifier: id).count > 1 {
            NSApp.terminate(nil)
            return
        }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "clock.arrow.circlepath", accessibilityDescription: "Claude Sessions")
            button.image?.isTemplate = true
        }
        rebuildMenu()
        // A server started from a terminal already owns the port — adopt it rather
        // than binding a second one alongside it.
        checkHealth { [weak self] alreadyUp in
            if !alreadyUp { self?.startServer() }
        }
        healthTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.checkHealth()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.terminate()
    }

    // MARK: - Menu

    private func rebuildMenu() {
        let menu = NSMenu()
        let status = NSMenuItem(title: statusLine(), action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())

        menu.addItem(item("Open Claude Sessions", #selector(openUI), key: "o"))

        let share = item("Share on the Network", #selector(toggleLan), key: "")
        share.state = lanMode ? .on : .off
        menu.addItem(share)

        if isShared {
            menu.addItem(item("Copy Link for Another Device", #selector(copyLanLink), key: "c"))
            menu.addItem(item("Show QR Code…", #selector(showQr), key: ""))
        }

        menu.addItem(.separator())
        menu.addItem(item(server == nil ? "Start Server" : "Stop Server", #selector(toggleServer), key: ""))
        menu.addItem(item("Restart Server", #selector(restartServer), key: "r"))
        menu.addItem(item("Open Log", #selector(openLog), key: ""))
        menu.addItem(.separator())
        menu.addItem(item("Quit", #selector(quit), key: "q"))
        statusItem.menu = menu
    }

    private func item(_ title: String, _ action: Selector, key: String) -> NSMenuItem {
        let mi = NSMenuItem(title: title, action: action, keyEquivalent: key)
        mi.target = self
        return mi
    }

    private func statusLine() -> String {
        if isUp { return isShared ? "Running on :\(port) — shared" : "Running on :\(port)" }
        return server == nil ? "Stopped" : "Starting…"
    }

    // MARK: - Server lifecycle

    private var logPath: String { (configDir() as NSString).appendingPathComponent("menubar.log") }

    private func startServer() {
        guard server == nil else { return }
        guard let root = installRoot() else {
            warn("Can't find the claude-sessions checkout.",
                 "Rebuild the app with `npm run menubar:install`, or write the path into ~/.claude-sessions/root.")
            return
        }
        guard let node = nodePath() else {
            warn("Node.js not found.", "Install Node 18 or newer, then restart this app.")
            return
        }

        try? FileManager.default.createDirectory(atPath: configDir(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        let log = FileHandle(forWritingAtPath: logPath)
        log?.seekToEndOfFile()

        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        var args = [(root as NSString).appendingPathComponent("bin/claude-sessions.js"), "--no-qr"]
        if lanMode { args.append("--lan") }
        p.arguments = args
        p.currentDirectoryURL = URL(fileURLWithPath: root)
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(port)
        p.environment = env
        if let log { p.standardOutput = log; p.standardError = log }
        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.server = nil
                self?.isUp = false
                self?.rebuildMenu()
            }
        }
        do {
            try p.run()
            server = p
        } catch {
            warn("Could not start the server.", error.localizedDescription)
        }
        rebuildMenu()
    }

    private func stopServer() {
        server?.terminate()
        server = nil
        isUp = false
        rebuildMenu()
    }

    @objc private func toggleServer() {
        server == nil ? startServer() : stopServer()
    }

    @objc private func restartServer() {
        stopServer()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.startServer() }
    }

    @objc private func toggleLan() {
        lanMode.toggle()
        restartServer()
    }

    /// The port may also be held by a server someone started in a terminal — that
    /// still counts as up, and the menu says so rather than fighting over the port.
    private func checkHealth(_ completion: ((Bool) -> Void)? = nil) {
        guard let url = URL(string: "\(localURL)/api/health") else { completion?(false); return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            var shared = false
            if ok, let data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let caps = json["capabilities"] as? [String: Any] {
                shared = caps["lan"] as? Bool ?? false
            }
            DispatchQueue.main.async {
                if let self, self.isUp != ok || self.isShared != shared {
                    self.isUp = ok
                    self.isShared = shared
                    self.rebuildMenu()
                }
                completion?(ok)
            }
        }.resume()
    }

    // MARK: - Actions

    @objc private func openUI() {
        NSWorkspace.shared.open(URL(string: localURL)!)
    }

    @objc private func openLog() {
        NSWorkspace.shared.open(URL(fileURLWithPath: logPath))
    }

    private func lanLink() -> String? {
        guard let ip = lanAddress() else { return nil }
        guard let token = readTrimmed((configDir() as NSString).appendingPathComponent("token")) else { return nil }
        return "http://\(ip):\(port)/?token=\(token)"
    }

    @objc private func copyLanLink() {
        guard let link = lanLink() else {
            warn("No network link yet.", "Turn on Share on the Network and give the server a moment to start.")
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link, forType: .string)
    }

    @objc private func showQr() {
        guard let link = lanLink(), let image = qrImage(from: link) else {
            warn("No network link yet.", "Turn on Share on the Network and give the server a moment to start.")
            return
        }
        let size = 280.0
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: size, height: size + 44),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Scan to open Claude Sessions"
        window.isReleasedWhenClosed = false

        let imageView = NSImageView(frame: NSRect(x: 0, y: 44, width: size, height: size))
        imageView.image = image
        imageView.imageScaling = .scaleProportionallyUpOrDown
        window.contentView?.addSubview(imageView)

        let label = NSTextField(labelWithString: link.replacingOccurrences(of: "?token=", with: "?token=…").prefix(48).description)
        label.frame = NSRect(x: 12, y: 12, width: size - 24, height: 20)
        label.alignment = .center
        label.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
        label.textColor = .secondaryLabelColor
        window.contentView?.addSubview(label)

        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        qrWindow = window
    }

    private func qrImage(from string: String) -> NSImage? {
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(string.data(using: .utf8), forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)) else { return nil }
        let rep = NSCIImageRep(ciImage: output)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        return image
    }

    @objc private func quit() {
        stopServer()
        NSApp.terminate(nil)
    }

    private func warn(_ message: String, _ info: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = info
        alert.alertStyle = .warning
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
