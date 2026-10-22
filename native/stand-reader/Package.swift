// swift-tools-version: 5.9
import PackageDescription

// The Square Mobile Payments SDK, pinned exactly: Square retires old SDK
// versions, so a bump is a deliberate act, tested on the Stand.
let package = Package(
    name: "KenworthyStandReader",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "KenworthyStandReader", targets: ["StandReaderPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/square/mobile-payments-sdk-ios.git", exact: "2.6.0")
    ],
    targets: [
        .target(
            name: "StandReaderPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "SquareMobilePaymentsSDK", package: "mobile-payments-sdk-ios"),
                .product(name: "MockReaderUI", package: "mobile-payments-sdk-ios")
            ],
            path: "ios/Sources/StandReaderPlugin"
        )
    ]
)
