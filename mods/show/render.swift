import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Shape: Decodable {
  let t: String
  let c: String
  let w: Double?
  let size: Double?
  let pts: [[Double]]
  let text: String?
  let n: Int?
}

struct Spec: Decodable {
  let src: String
  let out: String
  let shapes: [Shape]
}

func color(_ hex: String) -> NSColor {
  var s = hex.trimmingCharacters(in: .whitespaces)
  if s.hasPrefix("#") { s.removeFirst() }
  var v: UInt64 = 0
  Scanner(string: s).scanHexInt64(&v)
  let hasAlpha = s.count == 8
  let r = Double((v >> (hasAlpha ? 24 : 16)) & 0xff) / 255
  let g = Double((v >> (hasAlpha ? 16 : 8)) & 0xff) / 255
  let b = Double((v >> (hasAlpha ? 8 : 0)) & 0xff) / 255
  let a = hasAlpha ? Double(v & 0xff) / 255 : 1
  return NSColor(srgbRed: r, green: g, blue: b, alpha: a)
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

guard CommandLine.arguments.count == 2 else { fail("usage: render <spec.json>") }
let specData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let spec = try JSONDecoder().decode(Spec.self, from: specData)

guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: spec.src) as CFURL, nil),
      let base = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("cannot read \(spec.src)") }
let width = base.width, height = base.height
guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpace(name: CGColorSpace.sRGB)!,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("cannot allocate canvas") }
ctx.draw(base, in: CGRect(x: 0, y: 0, width: width, height: height))
ctx.translateBy(x: 0, y: CGFloat(height))
ctx.scaleBy(x: 1, y: -1)
NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)

func pt(_ p: [Double]) -> CGPoint { CGPoint(x: p[0], y: p[1]) }

for s in spec.shapes {
  let col = color(s.c)
  ctx.setStrokeColor(col.cgColor)
  ctx.setFillColor(col.cgColor)
  ctx.setLineWidth(CGFloat(s.w ?? 4))
  switch s.t {
  case "pen":
    guard let first = s.pts.first else { continue }
    ctx.beginPath()
    ctx.move(to: pt(first))
    for p in s.pts.dropFirst() { ctx.addLine(to: pt(p)) }
    ctx.strokePath()
  case "arrow":
    guard s.pts.count == 2 else { continue }
    let a = pt(s.pts[0]), b = pt(s.pts[1])
    let angle = atan2(b.y - a.y, b.x - a.x)
    let head = max(CGFloat(s.w ?? 4) * 4, 14), spread = CGFloat.pi / 6.5
    ctx.beginPath()
    ctx.move(to: a)
    ctx.addLine(to: b)
    ctx.move(to: CGPoint(x: b.x - head * cos(angle - spread), y: b.y - head * sin(angle - spread)))
    ctx.addLine(to: b)
    ctx.addLine(to: CGPoint(x: b.x - head * cos(angle + spread), y: b.y - head * sin(angle + spread)))
    ctx.strokePath()
  case "ellipse", "box":
    guard s.pts.count == 2 else { continue }
    let a = pt(s.pts[0]), b = pt(s.pts[1])
    let rect = CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y))
    if s.t == "ellipse" { ctx.strokeEllipse(in: rect) } else { ctx.stroke(rect) }
  case "pin":
    guard let p = s.pts.first else { continue }
    let r = CGFloat(s.size ?? 14)
    ctx.fillEllipse(in: CGRect(x: p[0] - r, y: p[1] - r, width: r * 2, height: r * 2))
    let label = NSAttributedString(string: String(s.n ?? 1), attributes: [
      .font: NSFont.boldSystemFont(ofSize: r * 1.15), .foregroundColor: NSColor.white])
    let size = label.size()
    label.draw(at: CGPoint(x: p[0] - size.width / 2, y: p[1] - size.height / 2))
  case "text":
    guard let p = s.pts.first, let text = s.text, !text.isEmpty else { continue }
    let font = NSFont.boldSystemFont(ofSize: CGFloat(s.size ?? 18))
    let halo = NSAttributedString(string: text, attributes: [
      .font: font, .strokeColor: NSColor.white.withAlphaComponent(0.9), .strokeWidth: 18])
    halo.draw(at: pt(p))
    NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: col]).draw(at: pt(p))
  default:
    continue
  }
}

guard let result = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: spec.out) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fail("cannot write \(spec.out)") }
CGImageDestinationAddImage(dest, result, nil)
guard CGImageDestinationFinalize(dest) else { fail("cannot write \(spec.out)") }
print(spec.out)
