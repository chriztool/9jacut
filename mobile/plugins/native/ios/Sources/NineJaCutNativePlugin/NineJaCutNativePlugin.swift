import Foundation
import UIKit
import Photos
import PhotosUI
import UniformTypeIdentifiers
import Capacitor
import FFmpegKit

/// 9jaCut's native layer on iPhone (window.Capacitor.Plugins.NineJaCutNative).
///
/// - runs ffmpeg commands (FFmpegKit, App Store-safe LGPL build) and streams
///   their console output back to the page, so the desktop export code works
///   unchanged (see mobile/export/)
/// - imports videos, photos and music into the app's own storage, so they are
///   real files ffmpeg can read and they are still there next time
/// - saves finished videos to Photos
@objc(NineJaCutNativePlugin)
public class NineJaCutNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NineJaCutNativePlugin"
    public let jsName = "NineJaCutNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPaths", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeTextFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeBase64", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolveMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "run", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveToPhotos", returnType: CAPPluginReturnPromise),
    ]

    private let fileManager = FileManager.default
    private var sessions: [String: Int64] = [:]           // jobId -> FFmpegKit session id
    private let sessionsLock = NSLock()
    private var activePicker: NSObject?                    // keeps a picker delegate alive

    // MARK: Folders

    private var documents: URL { fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    private var mediaFolder: URL { documents.appendingPathComponent("Media", isDirectory: true) }
    private var exportsFolder: URL { documents.appendingPathComponent("Exports", isDirectory: true) }
    private var webFolder: URL { Bundle.main.bundleURL.appendingPathComponent("public", isDirectory: true) }

    public override func load() {
        // ffmpeg prints media info (used for probing) at the "info" level.
        FFmpegKitConfig.setLogLevel(32)
        FFmpegKitConfig.enableRedirection()
        for folder in [mediaFolder, exportsFolder] {
            try? fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        }
    }

    @objc func getPaths(_ call: CAPPluginCall) {
        call.resolve([
            "web": webFolder.path,
            "tmp": NSTemporaryDirectory(),
            "documents": documents.path,
            "media": mediaFolder.path,
            "exports": exportsFolder.path,
            // CI launches the app with this flag to run an export self-test.
            "selfTest": ProcessInfo.processInfo.arguments.contains("-NineJaCutSelfTest"),
        ])
    }

    // MARK: Files

    @objc func writeTextFiles(_ call: CAPPluginCall) {
        let files = (call.getArray("files") ?? []).compactMap { $0 as? JSObject }
        do {
            for file in files {
                guard let path = file["path"] as? String else { continue }
                let text = file["text"] as? String ?? ""
                let url = URL(fileURLWithPath: path)
                try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try text.write(to: url, atomically: true, encoding: .utf8)
            }
            call.resolve()
        } catch {
            call.reject("Could not write a file: \(error.localizedDescription)")
        }
    }

    /// Saves bytes from the page (e.g. a voiceover recording) as a file in Media.
    @objc func writeBase64(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let base64 = call.getString("data"),
              let data = Data(base64Encoded: base64) else {
            call.reject("Missing name or data")
            return
        }
        let url = mediaFolder.appendingPathComponent(uniqueName(name))
        do {
            try data.write(to: url)
            call.resolve(["path": url.path])
        } catch {
            call.reject("Could not save the recording: \(error.localizedDescription)")
        }
    }

    @objc func removeFiles(_ call: CAPPluginCall) {
        for path in (call.getArray("paths") ?? []).compactMap({ $0 as? String }) {
            try? fileManager.removeItem(atPath: path)
        }
        call.resolve()
    }

    /// The app's folder moves when it is updated, so a path saved in a
    /// project can go stale. Finds each file again by name in Media.
    @objc func resolveMedia(_ call: CAPPluginCall) {
        let paths = (call.getArray("paths") ?? []).compactMap { $0 as? String }
        let resolved: [Any] = paths.map { (path: String) -> Any in
            if fileManager.fileExists(atPath: path) { return path }
            let again = mediaFolder.appendingPathComponent((path as NSString).lastPathComponent).path
            return fileManager.fileExists(atPath: again) ? again : NSNull()
        }
        call.resolve(["paths": resolved])
    }

    // MARK: ffmpeg

    @objc func run(_ call: CAPPluginCall) {
        guard let jobId = call.getString("jobId") else {
            call.reject("Missing jobId")
            return
        }
        let args = (call.getArray("args") ?? []).compactMap { $0 as? String }
        if let output = args.last, output.hasPrefix("/") {
            try? fileManager.createDirectory(
                at: URL(fileURLWithPath: output).deletingLastPathComponent(), withIntermediateDirectories: true)
        }

        // ffmpeg logs come in many tiny pieces; send them to the page a few
        // times a second instead of one event each.
        let buffer = LogBuffer { [weak self] text in
            self?.notifyListeners("ffmpegLog", data: ["jobId": jobId, "text": text])
        }

        let session = FFmpegKit.executeWithArgumentsAsync(
            args,
            withCompleteCallback: { [weak self] session in
                buffer.flush()
                self?.forget(jobId)
                let code = session.getReturnCode()?.getValue() ?? 1
                call.resolve(["returnCode": Int(code)])
            },
            withLogCallback: { log in
                buffer.append(log.getMessage())
            },
            withStatisticsCallback: { stats in
                // The export code reads progress from "time=" in the log.
                buffer.append(String(format: "\ntime=%@\n", Self.clock(stats.getTime() / 1000)))
            }
        )
        sessionsLock.lock()
        sessions[jobId] = session.getSessionId()
        sessionsLock.unlock()
    }

    @objc func cancel(_ call: CAPPluginCall) {
        if let jobId = call.getString("jobId") {
            sessionsLock.lock()
            let id = sessions[jobId]
            sessionsLock.unlock()
            if let id { FFmpegKitConfig.cancel(id) }
        }
        call.resolve()
    }

    private func forget(_ jobId: String) {
        sessionsLock.lock()
        sessions.removeValue(forKey: jobId)
        sessionsLock.unlock()
    }

    private static func clock(_ seconds: Double) -> String {
        let s = max(0, seconds)
        return String(format: "%02d:%02d:%05.2f", Int(s) / 3600, (Int(s) % 3600) / 60, s.truncatingRemainder(dividingBy: 60))
    }

    // MARK: Importing media

    /// kind: "video", "image", "visual" (photos and videos) or "audio".
    @objc func pickMedia(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "video"
        let multiple = call.getBool("multiple") ?? true
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("The picker could not open")
                return
            }
            if kind == "audio" {
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.audio], asCopy: true)
                picker.allowsMultipleSelection = multiple
                let delegate = AudioPickerDelegate(plugin: self, call: call)
                picker.delegate = delegate
                self.activePicker = delegate
                presenter.present(picker, animated: true)
                return
            }
            var config = PHPickerConfiguration()
            config.selectionLimit = multiple ? 0 : 1
            config.preferredAssetRepresentationMode = .current
            switch kind {
            case "image": config.filter = .images
            case "visual": config.filter = .any(of: [.images, .videos])
            default: config.filter = .videos
            }
            let picker = PHPickerViewController(configuration: config)
            let delegate = PhotoPickerDelegate(plugin: self, call: call)
            picker.delegate = delegate
            self.activePicker = delegate
            presenter.present(picker, animated: true)
        }
    }

    fileprivate func pickerFinished() { activePicker = nil }

    fileprivate func uniqueName(_ name: String) -> String {
        let clean = name.replacingOccurrences(of: "/", with: "_")
        let base = (clean as NSString).deletingPathExtension
        let ext = (clean as NSString).pathExtension
        var candidate = clean
        var n = 2
        while fileManager.fileExists(atPath: mediaFolder.appendingPathComponent(candidate).path) {
            candidate = ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"
            n += 1
        }
        return candidate
    }

    /// Moves or copies an imported file into Media. Returns its new path.
    fileprivate func keep(_ source: URL, suggestedName: String?) -> String? {
        let name = uniqueName(suggestedName ?? source.lastPathComponent)
        let target = mediaFolder.appendingPathComponent(name)
        do {
            try fileManager.copyItem(at: source, to: target)
            return target.path
        } catch {
            return nil
        }
    }

    fileprivate func keep(jpeg data: Data, suggestedName: String) -> String? {
        let target = mediaFolder.appendingPathComponent(uniqueName(suggestedName))
        return (try? data.write(to: target)) != nil ? target.path : nil
    }

    // MARK: Photos

    @objc func saveToPhotos(_ call: CAPPluginCall) {
        let paths = (call.getArray("paths") ?? []).compactMap { $0 as? String }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.resolve(["saved": 0, "denied": true])
                return
            }
            PHPhotoLibrary.shared().performChanges({
                for path in paths {
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: URL(fileURLWithPath: path))
                }
            }) { ok, error in
                if ok {
                    call.resolve(["saved": paths.count])
                } else {
                    call.reject("Could not save to Photos: \(error?.localizedDescription ?? "unknown error")")
                }
            }
        }
    }
}

// MARK: - Helpers

/// Collects log text and hands it on in batches.
private final class LogBuffer {
    private var pending = ""
    private let lock = NSLock()
    private var scheduled = false
    private let send: (String) -> Void

    init(send: @escaping (String) -> Void) { self.send = send }

    func append(_ text: String) {
        lock.lock()
        pending += text
        let schedule = !scheduled
        scheduled = true
        lock.unlock()
        if schedule {
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.flush() }
        }
    }

    func flush() {
        lock.lock()
        let text = pending
        pending = ""
        scheduled = false
        lock.unlock()
        if !text.isEmpty { send(text) }
    }
}

private func describe(_ path: String, _ name: String, _ mime: String) -> JSObject {
    ["path": path, "name": name, "mime": mime]
}

private final class PhotoPickerDelegate: NSObject, PHPickerViewControllerDelegate {
    private weak var plugin: NineJaCutNativePlugin?
    private let call: CAPPluginCall

    init(plugin: NineJaCutNativePlugin, call: CAPPluginCall) {
        self.plugin = plugin
        self.call = call
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let plugin else { return }
        let group = DispatchGroup()
        let lock = NSLock()
        var picked: [(Int, JSObject)] = []

        for (index, result) in results.enumerated() {
            let provider = result.itemProvider
            let name = provider.suggestedName ?? "media-\(index + 1)"
            if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, _ in
                    defer { group.leave() }
                    // The temporary file only exists inside this callback.
                    guard let url else { return }
                    let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
                    if let path = plugin.keep(url, suggestedName: "\(name).\(ext)") {
                        lock.lock(); picked.append((index, describe(path, "\(name).\(ext)", "video/quicktime"))); lock.unlock()
                    }
                }
            } else if provider.canLoadObject(ofClass: UIImage.self) {
                // Photos are often HEIC; store JPEG so ffmpeg can read them.
                group.enter()
                provider.loadObject(ofClass: UIImage.self) { object, _ in
                    defer { group.leave() }
                    guard let image = object as? UIImage, let data = image.jpegData(compressionQuality: 0.92) else { return }
                    if let path = plugin.keep(jpeg: data, suggestedName: "\(name).jpg") {
                        lock.lock(); picked.append((index, describe(path, "\(name).jpg", "image/jpeg"))); lock.unlock()
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak plugin] in
            let files = picked.sorted { $0.0 < $1.0 }.map { $0.1 }
            self.call.resolve(["files": files])
            plugin?.pickerFinished()
        }
    }
}

private final class AudioPickerDelegate: NSObject, UIDocumentPickerDelegate {
    private weak var plugin: NineJaCutNativePlugin?
    private let call: CAPPluginCall

    init(plugin: NineJaCutNativePlugin, call: CAPPluginCall) {
        self.plugin = plugin
        self.call = call
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        var files: [JSObject] = []
        for url in urls {
            if let path = plugin?.keep(url, suggestedName: url.lastPathComponent) {
                files.append(describe(path, url.lastPathComponent, "audio/\(url.pathExtension.lowercased())"))
            }
        }
        call.resolve(["files": files])
        plugin?.pickerFinished()
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        call.resolve(["files": []])
        plugin?.pickerFinished()
    }
}
