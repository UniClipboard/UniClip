import ExpoModulesCore
import ImageIO
import Photos
import UIKit
import UniformTypeIdentifiers

public class DocumentExporterModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DocumentExporter")

    // Present the system document picker in export mode so the user chooses
    // where to save the file. Resolves with the saved file URL string, or
    // `nil` if the user cancelled. Rejects on invalid input / missing source.
    AsyncFunction("exportFileAsync") { (fileUri: String, fileName: String?, promise: Promise) in
      Task { @MainActor in
        self.presentExporter(fileUri: fileUri, fileName: fileName, promise: promise)
      }
    }

    AsyncFunction("saveImageToPhotoLibraryAsync") {
      (fileUri: String, fileName: String?, promise: Promise) in
      self.saveImageToPhotoLibrary(fileUri: fileUri, fileName: fileName, promise: promise)
    }
  }

  @MainActor
  private func presentExporter(fileUri: String, fileName: String?, promise: Promise) {
    let source = Self.fileURL(from: fileUri)

    guard FileManager.default.fileExists(atPath: source.path) else {
      promise.reject("ERR_NOT_FOUND", "Source file does not exist: \(source.path)")
      return
    }

    // Payloads are content-addressed on disk (e.g. `File-<hash>`), so stage a
    // temp copy under the real name the user expects. If no rename is needed,
    // export the source directly.
    var tempDir: URL?
    let exportURL: URL
    if let name = fileName, !name.isEmpty, name != source.lastPathComponent {
      let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      do {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(name, isDirectory: false)
        try FileManager.default.copyItem(at: source, to: dest)
        exportURL = dest
        tempDir = dir
      } catch {
        promise.reject("ERR_STAGE", "Failed to stage temp copy: \(error.localizedDescription)")
        return
      }
    } else {
      exportURL = source
    }

    guard let topVC = Self.topViewController() else {
      promise.reject("ERR_NO_VC", "Cannot find a view controller to present from")
      if let dir = tempDir { try? FileManager.default.removeItem(at: dir) }
      return
    }

    // asCopy: true — copy into the chosen location, leave the source payload
    // untouched (the source is our on-disk cache, not a throwaway).
    let picker = UIDocumentPickerViewController(forExporting: [exportURL], asCopy: true)
    let coordinator = ExportCoordinator(promise: promise, tempDir: tempDir)
    picker.delegate = coordinator
    // Keep the coordinator alive for the lifetime of the picker.
    objc_setAssociatedObject(picker, "coordinator", coordinator, .OBJC_ASSOCIATION_RETAIN)

    topVC.present(picker, animated: true)
  }

  private func saveImageToPhotoLibrary(fileUri: String, fileName: String?, promise: Promise) {
    let source = Self.fileURL(from: fileUri)
    guard FileManager.default.fileExists(atPath: source.path) else {
      promise.reject("ERR_NOT_FOUND", "Source image does not exist")
      return
    }

    let preferredName = Self.safeFileName(fileName) ?? source.lastPathComponent
    let fileExtension = URL(fileURLWithPath: preferredName).pathExtension
    guard
      !fileExtension.isEmpty,
      let declaredType = UTType(filenameExtension: fileExtension),
      declaredType.conforms(to: .image)
    else {
      promise.reject("ERR_UNSUPPORTED_IMAGE", "Image filename has an unsupported extension")
      return
    }

    let imageData: Data
    do {
      imageData = try Data(contentsOf: source, options: .mappedIfSafe)
    } catch {
      promise.reject("ERR_IMAGE_READ", "Failed to read source image")
      return
    }

    guard
      let imageSource = CGImageSourceCreateWithData(imageData as CFData, nil),
      let detectedIdentifier = CGImageSourceGetType(imageSource) as String?,
      let detectedType = UTType(detectedIdentifier),
      detectedType.conforms(to: .image)
    else {
      promise.reject("ERR_UNSUPPORTED_IMAGE", "Source data is not a supported image")
      return
    }

    let options = PHAssetResourceCreationOptions()
    options.originalFilename = preferredName
    options.uniformTypeIdentifier = detectedType.identifier

    PHPhotoLibrary.shared().performChanges {
      let request = PHAssetCreationRequest.forAsset()
      request.addResource(with: .photo, data: imageData, options: options)
    } completionHandler: { saved, error in
      if saved {
        promise.resolve()
      } else {
        let errorCode = (error as NSError?)?.code ?? 0
        promise.reject(
          "ERR_PHOTO_SAVE_\(errorCode)",
          "Photo library rejected the image with error code \(errorCode)"
        )
      }
    }
  }

  private static func fileURL(from fileUri: String) -> URL {
    if let parsed = URL(string: fileUri), parsed.isFileURL {
      return parsed
    }
    return URL(fileURLWithPath: fileUri)
  }

  private static func safeFileName(_ fileName: String?) -> String? {
    guard let fileName, !fileName.isEmpty else { return nil }
    let name = URL(fileURLWithPath: fileName).lastPathComponent
    return name.isEmpty ? nil : name
  }

  @MainActor
  private static func topViewController() -> UIViewController? {
    guard let root = UIApplication.shared
      .connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })
      .first(where: { $0.isKeyWindow })?
      .rootViewController else {
      return nil
    }
    var top = root
    while let presented = top.presentedViewController {
      top = presented
    }
    return top
  }
}

private class ExportCoordinator: NSObject, UIDocumentPickerDelegate {
  private let promise: Promise
  private let tempDir: URL?
  private var settled = false

  init(promise: Promise, tempDir: URL?) {
    self.promise = promise
    self.tempDir = tempDir
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    settle { self.promise.resolve(urls.first?.absoluteString) }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    // nil signals "user cancelled" to JS — not an error.
    settle { self.promise.resolve(nil) }
  }

  private func settle(_ resolvePromise: () -> Void) {
    guard !settled else { return }
    settled = true
    resolvePromise()
    if let dir = tempDir {
      try? FileManager.default.removeItem(at: dir)
    }
  }
}
