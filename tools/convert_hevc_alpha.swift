import AVFoundation
import Foundation

let actions = ["idle", "run", "happy", "rest"]

func usage() -> Never {
    fputs("Usage: swift -module-cache-path /private/tmp/swift-module-cache tools/convert_hevc_alpha.swift <pet-dir> [output-dir]\n", stderr)
    exit(2)
}

guard CommandLine.arguments.count >= 2 else {
    usage()
}

let inputDir = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let outputDir: URL
if CommandLine.arguments.count >= 3 {
    outputDir = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
} else {
    outputDir = inputDir.appendingPathComponent("hevc", isDirectory: true)
}

try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

func exportHEVCAlpha(inputURL: URL, outputURL: URL) throws {
    try? FileManager.default.removeItem(at: outputURL)

    let asset = AVURLAsset(url: inputURL)
    guard let exporter = AVAssetExportSession(
        asset: asset,
        presetName: AVAssetExportPresetHEVCHighestQualityWithAlpha
    ) else {
        throw NSError(
            domain: "GaoTaHEVCAlpha",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "HEVC with Alpha export is not supported for \(inputURL.path)"]
        )
    }

    exporter.outputURL = outputURL
    exporter.outputFileType = .mov
    exporter.shouldOptimizeForNetworkUse = true

    let semaphore = DispatchSemaphore(value: 0)
    exporter.exportAsynchronously {
        semaphore.signal()
    }
    semaphore.wait()

    if exporter.status != .completed {
        throw exporter.error ?? NSError(
            domain: "GaoTaHEVCAlpha",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Export failed for \(inputURL.lastPathComponent)"]
        )
    }
}

for action in actions {
    let inputURL = inputDir.appendingPathComponent("\(action).mov")
    let outputURL = outputDir.appendingPathComponent("\(action).mov")

    guard FileManager.default.fileExists(atPath: inputURL.path) else {
        print("Skipping \(action): \(inputURL.path) not found")
        continue
    }

    print("Converting \(action) to HEVC with Alpha...")
    do {
        try exportHEVCAlpha(inputURL: inputURL, outputURL: outputURL)
        let size = (try? FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? NSNumber)?.int64Value ?? 0
        print("Done \(action): \(outputURL.path) (\(size) bytes)")
    } catch {
        fputs("Failed \(action): \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}
