import AppKit
import ImageIO
import UniformTypeIdentifiers
import WebKit

struct Want: Decodable {
  let at: Double
  let url: String
  let width: Double
  let height: Double
  let shot: Double
  let every: Double
}

struct Show: Decodable {
  let at: Double
  let url: String
}

func now() -> Double { Date().timeIntervalSince1970 * 1000 }

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write("usage: herdr-agent-office <folder>\n".data(using: .utf8)!)
  exit(2)
}
let folder = URL(fileURLWithPath: CommandLine.arguments[1])
let frames = folder.appendingPathComponent("frames")
try? FileManager.default.createDirectory(at: frames, withIntermediateDirectories: true)
let lock = open(folder.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, 0o644)
if lock < 0 || flock(lock, LOCK_EX | LOCK_NB) != 0 { exit(0) }

// Capped at 12 frames a second the office still moves at real speed (it steps at most a tenth
// of a second per frame) and costs a fifth of drawing sixty.
let gate = """
(() => {
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  let gap = 0, last = 0, timer = 0, next = -1;
  const held = new Map();
  const flush = () => { timer = 0; raf(t => { last = t; const all = [...held.values()]; held.clear(); all.forEach(cb => cb(t)); }); };
  window.requestAnimationFrame = cb => {
    if (!gap) return raf(cb);
    const id = next--;
    held.set(id, cb);
    if (!timer) timer = setTimeout(flush, Math.max(0, gap - (performance.now() - last)));
    return id;
  };
  window.cancelAnimationFrame = id => id < 0 ? held.delete(id) : caf(id);
  window.__herdrFps = fps => { gap = fps > 0 ? 1000 / fps : 0; };
})();
"""

// Runs before the page's own handlers, so Esc still closes its DESKS and JOIN panels first.
let escape = """
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && !document.querySelector(".deskmode.open, .join.open")) window.webkit.messageHandlers.herdr.postMessage("close");
}, true);
"""

let backdrop = NSColor(srgbRed: 0x15 / 255.0, green: 0x12 / 255.0, blue: 0x1c / 255.0, alpha: 1)
let encoder = DispatchQueue(label: "agent-office.encode", qos: .userInitiated)

final class Office: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSWindowDelegate {
  let started = now()
  var window: NSWindow!
  var web: WKWebView!
  var activity: NSObjectProtocol?
  var url = ""
  var size = NSSize(width: 1280, height: 720)
  var shown = false
  var asked = 0.0
  var titled = false
  var busy = false
  var encoding = false
  var previous: Data?
  var current: Want?
  var shots: Timer?
  var every = 0.0
  var paced = -1
  var beat = 0.0
  var retry = 0.0
  var state = "loading"
  var detail = ""
  var frame = ""
  var notice: WKNavigation?

  func applicationDidFinishLaunching(_ note: Notification) {
    activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Agent Office")
    asked = started - 30000
    let config = WKWebViewConfiguration()
    config.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15"
    config.userContentController.addUserScript(WKUserScript(source: gate, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.addUserScript(WKUserScript(source: escape, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.add(self, name: "herdr")
    web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.contentView = web
    conceal()
    NSEvent.addLocalMonitorForEvents(matching: .keyDown) { self.key($0) }
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      if self.shown && app?.processIdentifier != getpid() { self.conceal() }
    }
    Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in self.tick() }
    tick()
  }

  // Off screen or ordered out, WebKit stops drawing; see-through and click-through, it keeps going.
  func conceal() {
    shown = false
    window.styleMask = [.borderless]
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    window.hasShadow = false
    window.level = .floating
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
    window.setContentSize(size)
    window.setFrameOrigin(NSScreen.main?.visibleFrame.origin ?? .zero)
    window.orderFrontRegardless()
    pace()
    write()
  }

  func present() {
    shown = true
    let area = herdr() ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1400, height: 900)
    window.styleMask = [.titled, .closable, .resizable]
    window.title = "Agent Office"
    window.titlebarAppearsTransparent = true
    window.backgroundColor = backdrop
    window.appearance = NSAppearance(named: .darkAqua)
    if !titled { addButtons() }
    window.alphaValue = 1
    window.ignoresMouseEvents = false
    window.hasShadow = true
    window.level = .normal
    window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
    window.setFrame(area.insetBy(dx: area.width * 0.05, dy: area.height * 0.05), display: true)
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(web)
    pace()
    if state == "offline" { load() }
    write()
  }

  func herdr() -> NSRect? {
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let top = NSScreen.screens.first?.frame.maxY ?? 0
    for info in list where info[kCGWindowOwnerName as String] as? String == "Herdr" && info[kCGWindowLayer as String] as? Int == 0 {
      guard let bounds = info[kCGWindowBounds as String] as? NSDictionary,
            let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.width > 400, rect.height > 300 else { continue }
      return NSRect(x: rect.minX, y: top - rect.maxY, width: rect.width, height: rect.height)
    }
    return nil
  }

  func addButtons() {
    titled = true
    let reload = NSButton(title: "Reload", target: self, action: #selector(reloadPage))
    let browser = NSButton(title: "Open in browser", target: self, action: #selector(openBrowser))
    for button in [reload, browser] {
      button.bezelStyle = .recessed
      button.controlSize = .small
    }
    let row = NSStackView(views: [reload, browser])
    row.spacing = 6
    row.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 10)
    row.setFrameSize(NSSize(width: row.fittingSize.width, height: 28))
    let accessory = NSTitlebarAccessoryViewController()
    accessory.view = row
    accessory.layoutAttribute = .trailing
    window.addTitlebarAccessoryViewController(accessory)
  }

  @objc func reloadPage() { load() }

  @objc func openBrowser() {
    guard let target = URL(string: url) else { return }
    if let firefox = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "org.mozilla.firefox") {
      NSWorkspace.shared.open([target], withApplicationAt: firefox, configuration: NSWorkspace.OpenConfiguration())
    } else {
      NSWorkspace.shared.open(target)
    }
  }

  func key(_ event: NSEvent) -> NSEvent? {
    guard shown, event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command else { return event }
    let actions = ["w": "performClose:", "r": "reloadPage", "c": "copy:", "v": "paste:", "x": "cut:", "a": "selectAll:", "z": "undo:"]
    guard let name = actions[event.charactersIgnoringModifiers ?? ""] else { return event }
    if name == "reloadPage" { load() } else if name == "performClose:" { conceal() } else { NSApp.sendAction(Selector(name), to: nil, from: self) }
    return nil
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    if shown && message.body as? String == "close" { conceal() }
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    conceal()
    return false
  }

  func read<T: Decodable>(_ name: String, as: T.Type) -> T? {
    guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  func tick() {
    let time = now()
    if let show = read("show.json", as: Show.self), show.at > asked {
      asked = show.at
      if show.url != url {
        url = show.url
        load()
      }
      present()
    }
    let want = read("want-mini.json", as: Want.self).flatMap { time - $0.at < 15000 ? $0 : nil }
    guard want != nil || shown else { exit(0) }
    if let want {
      if want.url != url && !shown {
        url = want.url
        load()
      }
      let size = NSSize(width: max(320, want.width.rounded()), height: max(200, want.height.rounded()))
      if size != self.size {
        self.size = size
        if !shown { window.setContentSize(size) }
      }
    }
    if state == "offline" && time >= retry { load() }
    if state == "loading" && time >= retry { failed("The office took too long to answer") }
    if time - beat > 4000 { write() }
    current = want
    pace()
    let interval = want?.every ?? 0
    if interval != every {
      every = interval
      shots?.invalidate()
      shots = nil
      if interval > 0 {
        shots = Timer.scheduledTimer(withTimeInterval: max(0.05, interval / 1000), repeats: true) { _ in self.shoot() }
        shots?.tolerance = 0.01
      }
    }
  }

  func pace() {
    let fps = shown ? 30 : 12
    guard fps != paced else { return }
    paced = fps
    web.evaluateJavaScript("window.__herdrFps && window.__herdrFps(\(fps))", completionHandler: nil)
  }

  func load() {
    guard let target = URL(string: url), target.scheme == "https" || target.scheme == "http" else {
      failed("Not a web address: \(url)")
      retry = .infinity
      return
    }
    state = "loading"
    detail = ""
    retry = now() + 15000
    web.load(URLRequest(url: target))
    write()
  }

  func shoot() {
    guard let want = current, !busy, !encoding, state == "ready" else { return }
    busy = true
    let config = WKSnapshotConfiguration()
    config.snapshotWidth = NSNumber(value: want.shot)
    web.takeSnapshot(with: config) { image, _ in
      self.busy = false
      guard let image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
      let pixels = cg.dataProvider?.data as Data?
      if pixels != nil && pixels == self.previous { return }
      self.previous = pixels
      self.encoding = true
      let name = String(format: "%.0f.png", now())
      encoder.async {
        let saved = save(cg, frames.appendingPathComponent(name))
        DispatchQueue.main.async {
          self.encoding = false
          guard saved else { return }
          self.frame = name
          self.write()
          prune()
        }
      }
    }
  }

  func write() {
    beat = now()
    let body: [String: Any] = [
      "state": state, "detail": detail, "frame": frame, "url": url, "shown": shown,
      "at": beat, "pid": Int(getpid()), "width": size.width, "height": size.height,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
    let tmp = folder.appendingPathComponent(".status.json")
    if (try? data.write(to: tmp)) != nil {
      rename(tmp.path, folder.appendingPathComponent("status.json").path)
    }
  }

  func office(_ page: URL?) -> Bool {
    guard let page, let home = URL(string: url) else { return false }
    return page.host == home.host && page.path != "/login" && !page.path.hasPrefix("/auth/")
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    paced = -1
    pace()
    guard navigation !== notice, state != "offline" else { return }
    state = office(webView.url) ? "ready" : "signin"
    write()
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    if navigationResponse.isForMainFrame, let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 500 {
      failed("The office answered \(http.statusCode)")
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  func failed(_ error: Error) {
    let code = (error as NSError).code
    guard code != NSURLErrorCancelled, code != 102 else { return }
    failed(error.localizedDescription)
  }

  func failed(_ message: String) {
    state = "offline"
    detail = message
    retry = now() + 10000
    write()
    guard shown else { return }
    let host = URL(string: url)?.host ?? url
    let text = "<p style='font-size:16px;color:#eeeae2'>Can't reach \(host)</p><p>\(message)</p><p>Trying again every 10 seconds.</p>"
    let page = "<body style='margin:0;height:100vh;display:grid;place-content:center;text-align:center;background:#15121c;color:#a9a4b8;font:13px -apple-system'>\(text)</body>"
    notice = web.loadHTMLString(page, baseURL: nil)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    load()
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if action.targetFrame == nil { webView.load(action.request) }
    return nil
  }
}

func save(_ image: CGImage, _ to: URL) -> Bool {
  let tmp = to.deletingLastPathComponent().appendingPathComponent("." + to.lastPathComponent)
  guard let out = CGImageDestinationCreateWithURL(tmp as CFURL, UTType.png.identifier as CFString, 1, nil) else { return false }
  CGImageDestinationAddImage(out, image, nil)
  guard CGImageDestinationFinalize(out) else { return false }
  return rename(tmp.path, to.path) == 0
}

func prune() {
  let names = ((try? FileManager.default.contentsOfDirectory(atPath: frames.path)) ?? [])
    .filter { !$0.hasPrefix(".") && $0.hasSuffix(".png") }
    .sorted()
  for name in names.dropLast(4) {
    try? FileManager.default.removeItem(at: frames.appendingPathComponent(name))
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let office = Office()
app.delegate = office
app.run()
