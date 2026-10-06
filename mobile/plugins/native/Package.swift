// swift-tools-version: 5.9
import PackageDescription

// 9jaCut's native iPhone plugin. The FFmpeg frameworks and the FFmpegKit
// Swift sources are not in git: `npm run ios:ffmpeg` downloads them from the
// ffmpeg-ios-lgpl-* GitHub release (built by build-ffmpeg-ios.yml) into
// ios/Frameworks and ios/Sources/{FFmpegKit,CFFmpegBridge}.
let ffmpegFrameworks = [
    "ffmpegkit", "libavcodec", "libavdevice", "libavfilter",
    "libavformat", "libavutil", "libswresample", "libswscale",
]

let package = Package(
    name: "NinejacutNative",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "NinejacutNative", targets: ["NineJaCutNativePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: ffmpegFrameworks.map { name in
        .binaryTarget(name: "\(name)Binary", path: "ios/Frameworks/\(name).xcframework")
    } + [
        .target(
            name: "CFFmpegBridge",
            path: "ios/Sources/CFFmpegBridge",
            publicHeadersPath: "include"),
        .target(
            name: "FFmpegKit",
            dependencies: ["CFFmpegBridge"] + ffmpegFrameworks.map { .target(name: "\($0)Binary") },
            path: "ios/Sources/FFmpegKit"),
        .target(
            name: "NineJaCutNativePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "FFmpegKit",
            ],
            path: "ios/Sources/NineJaCutNativePlugin"),
    ]
)
