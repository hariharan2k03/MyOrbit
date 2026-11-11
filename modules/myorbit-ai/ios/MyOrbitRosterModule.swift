import ExpoModulesCore
import PDFKit
import UIKit
import Vision

/// Reads the text on a roster photo or PDF entirely on the device (Apple Vision).
/// Returns every recognised line with its position so JavaScript can rebuild
/// the table: x/y/width/height are 0–1 fractions of the page, origin top-left.
/// Later PDF pages are stacked below earlier ones (page 2 starts at y = 1).
public class MyOrbitRosterModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MyOrbitRoster")

    AsyncFunction("recognizeText") { (uri: String, hints: [String]) throws -> [[String: Any]] in
      let images = try loadImages(uri)
      var out: [[String: Any]] = []
      for (page, image) in images.enumerated() {
        out.append(contentsOf: try recognize(image.cgImage, orientation: image.orientation, hints: hints, page: page))
      }
      return out
    }
  }
}

private struct PageImage {
  let cgImage: CGImage
  let orientation: CGImagePropertyOrientation
}

/// The longest edge Vision is given: big enough for small roster text, small enough to stay fast.
private let maxEdge: CGFloat = 3000
private let maxPdfPages = 4

private func loadImages(_ uri: String) throws -> [PageImage] {
  guard let url = URL(string: uri), url.isFileURL || uri.hasPrefix("/") else { throw RosterError("Unsupported file location.") }
  let fileURL = url.isFileURL ? url : URL(fileURLWithPath: uri)

  if fileURL.pathExtension.lowercased() == "pdf" {
    guard let doc = PDFDocument(url: fileURL), doc.pageCount > 0 else { throw RosterError("Couldn’t open that PDF.") }
    return (0..<min(doc.pageCount, maxPdfPages)).compactMap { i in
      guard let page = doc.page(at: i) else { return nil }
      let bounds = page.bounds(for: .mediaBox)
      let scale = min(maxEdge / max(bounds.width, bounds.height), 4)
      let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
      let img = page.thumbnail(of: size, for: .mediaBox)
      guard let cg = img.cgImage else { return nil }
      return PageImage(cgImage: cg, orientation: .up)
    }
  }

  guard let image = UIImage(contentsOfFile: fileURL.path), let cg = image.cgImage else {
    throw RosterError("Couldn’t open that image.")
  }
  return [PageImage(cgImage: downscaled(cg), orientation: CGImagePropertyOrientation(image.imageOrientation))]
}

private func downscaled(_ image: CGImage) -> CGImage {
  let longest = CGFloat(max(image.width, image.height))
  guard longest > maxEdge else { return image }
  let scale = maxEdge / longest
  let w = Int(CGFloat(image.width) * scale), h = Int(CGFloat(image.height) * scale)
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
  ctx.interpolationQuality = .high
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  return ctx.makeImage() ?? image
}

private func recognize(_ image: CGImage, orientation: CGImagePropertyOrientation, hints: [String], page: Int) throws -> [[String: Any]] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  // Correction "fixes" names and times into dictionary words, so it stays off;
  // the JavaScript side matches names loosely instead.
  request.usesLanguageCorrection = false
  request.recognitionLanguages = ["en-AU", "en-US"]
  request.customWords = hints
  request.minimumTextHeight = 0.006

  let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
  try handler.perform([request])

  return (request.results ?? []).compactMap { obs in
    guard let best = obs.topCandidates(1).first else { return nil }
    let text = best.string.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    let box = obs.boundingBox // normalised, origin bottom-left
    return [
      "text": text,
      "x": Double(box.minX),
      "y": Double(1 - box.maxY) + Double(page),
      "width": Double(box.width),
      "height": Double(box.height),
      "page": page,
      "confidence": Double(best.confidence),
    ]
  }
}

private extension CGImagePropertyOrientation {
  init(_ o: UIImage.Orientation) {
    switch o {
    case .up: self = .up
    case .down: self = .down
    case .left: self = .left
    case .right: self = .right
    case .upMirrored: self = .upMirrored
    case .downMirrored: self = .downMirrored
    case .leftMirrored: self = .leftMirrored
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}

final class RosterError: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}
