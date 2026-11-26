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
  let signin: Double?
  let reload: Double?
}

func now() -> Double { Date().timeIntervalSince1970 * 1000 }

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write("usage: view <folder>\n".data(using: .utf8)!)
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
let encoder = DispatchQueue(label: "agent-office.encode", qos: .userInitiated)

final class Office: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
  let started = now()
  var window: NSWindow!
  var web: WKWebView!
  var activity: NSObjectProtocol?
  var url = ""
  var size = NSSize.zero
  var signin = 0.0
  var reload = 0.0
  var signing = false
  var busy = false
  var encoding = false
  var current: Want?
  var shots: Timer?
  var every = 0.0
  var paced = -1
  var beat = 0.0
  var retry = 0.0
  var state = "loading"
  var detail = ""
  var frame = ""

  func applicationDidFinishLaunching(_ note: Notification) {
    activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Agent Office frames")
    signin = started - 30000
    reload = started - 30000
    let config = WKWebViewConfiguration()
    config.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15"
    config.userContentController.addUserScript(WKUserScript(source: gate, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 720), configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 720), styleMask: [.borderless], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.contentView = web
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
    conceal()
    Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in self.tick() }
    tick()
  }

  // Off screen or ordered out, WebKit stops drawing; see-through and click-through, it keeps going.
  func conceal() {
    window.styleMask = [.borderless]
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    window.hasShadow = false
    window.level = .floating
    window.setContentSize(size == .zero ? NSSize(width: 1280, height: 720) : size)
    let screen = NSScreen.main?.visibleFrame ?? .zero
    window.setFrameOrigin(screen.origin)
    window.orderFrontRegardless()
  }

  func want(_ name: String) -> Want? {
    guard let data = try? Data(contentsOf: folder.appendingPathComponent("want-\(name).json")) else { return nil }
    return try? JSONDecoder().decode(Want.self, from: data)
  }

  func tick() {
    let time = now()
    guard let want = ["modal", "mini"].compactMap(want).first(where: { time - $0.at < 15000 }) else { exit(0) }
    if want.url != url {
      url = want.url
      load()
    }
    let size = NSSize(width: max(320, want.width.rounded()), height: max(200, want.height.rounded()))
    if size != self.size {
      self.size = size
      if !signing { window.setContentSize(size) }
    }
    if let asked = want.signin, asked > signin {
      signin = asked
      openSignin()
    }
    if let asked = want.reload, asked > reload {
      reload = asked
      load()
    }
    if state == "offline" && time >= retry { load() }
    if state == "loading" && time >= retry { failed("The office took too long to answer") }
    if time - beat > 4000 { write() }
    current = want
    let fps = want.every <= 150 ? 30 : 12
    if fps != paced {
      paced = fps
      web.evaluateJavaScript("window.__herdrFps && window.__herdrFps(\(fps))", completionHandler: nil)
    }
    if want.every != every {
      every = want.every
      shots?.invalidate()
      shots = Timer.scheduledTimer(withTimeInterval: max(0.05, every / 1000), repeats: true) { _ in self.shoot() }
      shots?.tolerance = 0.01
    }
  }

  func load() {
    guard let target = URL(string: url), target.scheme == "https" || target.scheme == "http" else {
      state = "offline"
      detail = "Not a web address: \(url)"
      retry = .infinity
      write()
      return
    }
    state = "loading"
    detail = ""
    retry = now() + 15000
    web.load(URLRequest(url: target))
    write()
  }

  func shoot() {
    guard let want = current, !signing, !busy, !encoding, state == "ready" else { return }
    busy = true
    let config = WKSnapshotConfiguration()
    config.snapshotWidth = NSNumber(value: want.shot)
    web.takeSnapshot(with: config) { image, _ in
      self.busy = false
      guard let image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
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
      "state": signing ? "signing-in" : state, "detail": detail, "frame": frame, "url": url,
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

  func openSignin() {
    if signing {
      NSApp.activate(ignoringOtherApps: true)
      window.makeKeyAndOrderFront(nil)
      return
    }
    signing = true
    window.styleMask = [.titled, .closable, .resizable]
    window.title = "Sign in to Agent Office"
    window.alphaValue = 1
    window.ignoresMouseEvents = false
    window.hasShadow = true
    window.setContentSize(NSSize(width: 960, height: 720))
    window.center()
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
    if office(web.url) || state != "signin" { load() }
    write()
  }

  func closeSignin() {
    signing = false
    conceal()
    NSApp.deactivate()
    write()
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if signing { closeSignin() }
    return false
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    paced = -1
    guard state != "offline" else { return }
    state = office(webView.url) ? "ready" : "signin"
    if signing && state == "ready" { closeSignin() }
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
