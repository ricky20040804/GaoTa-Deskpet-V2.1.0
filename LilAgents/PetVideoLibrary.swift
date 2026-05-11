import AVFoundation
import Foundation

enum PetAction: String, CaseIterable {
    case idle
    case run
    case happy
    case rest
}

struct PetVideoLibrary {
    let petID: String

    static let current = PetVideoLibrary(petID: "current")

    var petDirectory: URL {
        if let projectURL = Self.projectPetDirectory(petID: petID) {
            return projectURL
        }

        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("custompet/generated/\(petID)", isDirectory: true)
    }

    func url(for action: PetAction) -> URL? {
        if let generatedURL = generatedURL(for: action) {
            return generatedURL
        }

        return fallbackURL(for: action)
    }

    private func generatedURL(for action: PetAction) -> URL? {
        let candidates = Self.candidatePetDirectories(petID: petID).flatMap { directory in
            [
                directory.appendingPathComponent("\(action.rawValue).mov"),
                directory.appendingPathComponent("\(action.rawValue).mp4")
            ]
        } + [
            petDirectory.appendingPathComponent("\(action.rawValue).mov"),
            petDirectory.appendingPathComponent("\(action.rawValue).mp4")
        ]

        return candidates.first {
            FileManager.default.fileExists(atPath: $0.path) && AVURLAsset(url: $0).isPlayable
        }
    }

    private func fallbackURL(for action: PetAction) -> URL? {
        switch action {
        case .idle, .run, .happy, .rest:
            return nil
        }
    }

    private static func candidatePetDirectories(petID: String) -> [URL] {
        var directories: [URL] = []
        let fileManager = FileManager.default
        let projectSuffix = "custompet/generated/\(petID)"

        directories.append(URL(fileURLWithPath: fileManager.currentDirectoryPath).appendingPathComponent(projectSuffix, isDirectory: true))
        directories.append(URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Desktop/GaoTa-Deskpet/\(projectSuffix)", isDirectory: true))

        if let bundleURL = Bundle.main.resourceURL {
            var cursor = bundleURL
            for _ in 0..<12 {
                directories.append(cursor.appendingPathComponent(projectSuffix, isDirectory: true))
                cursor.deleteLastPathComponent()
            }
        }

        return directories
    }

    private static func projectPetDirectory(petID: String) -> URL? {
        candidatePetDirectories(petID: petID).first {
            FileManager.default.fileExists(atPath: $0.path)
        }
    }
}
