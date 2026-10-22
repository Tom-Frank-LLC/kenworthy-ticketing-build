import Foundation
import UIKit
import CoreLocation
import CoreBluetooth
import Capacitor
import SquareMobilePaymentsSDK
import MockReaderUI

/// The box-office Square Stand, for the Staff POS.
///
/// A thin bridge over Square's Mobile Payments SDK: the server decides what to
/// charge (the amount, the Square Order and the reference; `square-terminal`
/// `start_sale` with `reader: "stand"`), and this only takes the card and
/// reports what Square said. Nothing here confirms a sale. The server reads the
/// payment back from Square before it does.
///
/// See docs/briefs/BRIEF-ios-stand-reader.md.
@objc(StandReaderPlugin)
public class StandReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StandReaderPlugin"
    public let jsName = "StandReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deauthorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startPayment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelPayment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showMockReader", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideMockReader", returnType: CAPPluginReturnPromise),
    ]

    /// Called from AppDelegate's didFinishLaunching, as Square requires: before
    /// any other SDK call. The application id comes from Info.plist
    /// (`SquareApplicationID`, filled from `SQUARE_APPLICATION_ID` in
    /// ios/Version.xcconfig by scripts/stamp-ios-build.mjs, which picks it from
    /// the backend the bundle was built against).
    public static func initializeSDK(launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
        guard let appId = Bundle.main.object(forInfoDictionaryKey: "SquareApplicationID") as? String,
              !appId.isEmpty, !appId.hasPrefix("$(") else {
            NSLog("[StandReader] no SquareApplicationID in Info.plist; the Stand is off")
            return
        }
        MobilePaymentsSDK.initialize(applicationLaunchOptions: launchOptions, squareApplicationID: appId)
        initialized = true
    }
    private static var initialized = false

    private var sdk: SDKManager? { StandReaderPlugin.initialized ? MobilePaymentsSDK.shared : nil }
    private var paymentCall: CAPPluginCall?
    private var paymentHandle: PaymentHandle?
    private var mockReader: MockReaderUI?
    private var locationManager: CLLocationManager?
    private var bluetooth: CBCentralManager?
    private var observing = false

    override public func load() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let sdk = self.sdk, !self.observing else { return }
            sdk.readerManager.add(self)
            self.observing = true
        }
    }

    // MARK: status

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let sdk = self.sdk else {
                call.resolve(["available": false])
                return
            }
            let auth = sdk.authorizationManager
            call.resolve([
                "available": true,
                "environment": sdk.settingsManager.sdkSettings.environment == .production ? "production" : "sandbox",
                "sdkVersion": sdk.settingsManager.sdkSettings.version,
                "authorized": auth.state == .authorized,
                "locationId": auth.location?.id ?? NSNull(),
                "locationName": auth.location?.name ?? NSNull(),
                "location": Self.locationStatus(),
                "readers": sdk.readerManager.readers.map(Self.describe),
            ])
        }
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Square checks the country on every payment, so it needs location;
            // creating a central manager is how iOS asks for Bluetooth, which
            // Square's docs require for the Stand as for its readers.
            if self.locationManager == nil { self.locationManager = CLLocationManager() }
            if self.locationManager?.authorizationStatus == .notDetermined {
                self.locationManager?.requestWhenInUseAuthorization()
            }
            if self.bluetooth == nil { self.bluetooth = CBCentralManager(delegate: nil, queue: nil) }
            call.resolve(["location": Self.locationStatus()])
        }
    }

    private static func locationStatus() -> String {
        switch CLLocationManager().authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    // MARK: authorization

    @objc func authorize(_ call: CAPPluginCall) {
        guard let token = call.getString("accessToken"), !token.isEmpty,
              let locationId = call.getString("locationId"), !locationId.isEmpty else {
            call.reject("accessToken and locationId are required")
            return
        }
        DispatchQueue.main.async {
            guard let sdk = self.sdk else { call.reject("The Square SDK is not set up in this build", "UNAVAILABLE"); return }
            let auth = sdk.authorizationManager
            // Authorized for another location is not authorized for ours.
            if auth.state == .authorized, auth.location?.id == locationId {
                call.resolve(["authorized": true])
                return
            }
            let go = {
                auth.authorize(withAccessToken: token, locationID: locationId) { error in
                    if let error = error {
                        call.reject(error.localizedDescription, Self.code(error))
                    } else {
                        call.resolve(["authorized": true])
                    }
                }
            }
            if auth.state == .authorized { auth.deauthorize { go() } } else { go() }
        }
    }

    @objc func deauthorize(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let sdk = self.sdk else { call.resolve(); return }
            sdk.authorizationManager.deauthorize { call.resolve() }
        }
    }

    // MARK: payment

    @objc func startPayment(_ call: CAPPluginCall) {
        guard let cents = call.getInt("amountCents"), cents > 0,
              let attemptId = call.getString("paymentAttemptId"), !attemptId.isEmpty,
              let referenceId = call.getString("referenceId"), !referenceId.isEmpty else {
            call.reject("amountCents, paymentAttemptId and referenceId are required")
            return
        }
        DispatchQueue.main.async {
            guard let sdk = self.sdk else { call.reject("The Square SDK is not set up in this build", "UNAVAILABLE"); return }
            guard self.paymentCall == nil else { call.reject("A payment is already in progress", "IN_PROGRESS"); return }
            guard let vc = self.bridge?.viewController else { call.reject("No view to present the payment on"); return }

            // Online only: an offline payment has no id until it syncs, and the
            // server cannot confirm a sale it cannot read back from Square.
            let params = PaymentParameters(
                paymentAttemptID: attemptId,
                amountMoney: Money(amount: UInt(cents), currency: .USD),
                processingMode: .onlineOnly
            )
            params.referenceID = referenceId
            if let orderId = call.getString("orderId"), !orderId.isEmpty { params.orderID = orderId }
            if let note = call.getString("note"), !note.isEmpty { params.note = note }

            self.paymentCall = call
            let handle = sdk.paymentManager.startPayment(
                params,
                promptParameters: PromptParameters(mode: .default, additionalMethods: AdditionalPaymentMethods()),
                from: vc,
                delegate: self
            )
            // A refusal to start is normally reported through didFail, which
            // has already settled the call. If it was not, settle it here so
            // the POS is not left waiting on a payment that never began.
            if handle == nil, self.paymentCall === call {
                self.paymentCall = nil
                call.resolve(["status": "failed", "errorMessage": "The card reader did not start the payment."])
            } else {
                self.paymentHandle = handle
            }
        }
    }

    @objc func cancelPayment(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["canceled": self.paymentHandle?.cancelPayment() ?? false])
        }
    }

    private func finish(_ payment: Payment?, status: String, error: Error? = nil) {
        guard let call = paymentCall else { return }
        paymentCall = nil
        paymentHandle = nil
        var result: [String: Any] = ["status": status]
        if let p = payment {
            result["payment"] = Self.describe(p)
        }
        if let error = error {
            result["errorCode"] = Self.code(error)
            result["errorMessage"] = error.localizedDescription
        }
        call.resolve(result)
    }

    // MARK: settings and the sandbox mock reader

    @objc func showSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let sdk = self.sdk, let vc = self.bridge?.viewController else { call.reject("Unavailable", "UNAVAILABLE"); return }
            sdk.settingsManager.presentSettings(with: vc) { error in
                if let error = error { call.reject(error.localizedDescription, Self.code(error)) } else { call.resolve() }
            }
        }
    }

    @objc func showMockReader(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let sdk = self.sdk, sdk.settingsManager.sdkSettings.environment == .sandbox else {
                call.reject("The mock reader exists only in the sandbox", "PRODUCTION")
                return
            }
            do {
                if self.mockReader == nil { self.mockReader = try MockReaderUI(for: sdk) }
                try self.mockReader?.present()
                call.resolve()
            } catch {
                call.reject(error.localizedDescription, Self.code(error))
            }
        }
    }

    @objc func hideMockReader(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.mockReader?.dismiss()
            call.resolve()
        }
    }

    // MARK: description helpers

    private static func code(_ error: Error) -> String {
        let e = error as NSError
        return "\(e.domain)#\(e.code)"
    }

    private static func describe(_ reader: ReaderInfo) -> [String: Any] {
        let model: String
        switch reader.model {
        case .stand: model = "stand"
        case .contactlessAndChip: model = "contactless_and_chip"
        case .magstripe: model = "magstripe"
        case .tapToPay: model = "tap_to_pay"
        default: model = "unknown"
        }
        let status: String
        switch reader.statusInfo.status {
        case .ready: status = "ready"
        case .connectingToDevice: status = "connecting_to_device"
        case .connectingToSquare: status = "connecting_to_square"
        case .faulty: status = "faulty"
        default: status = "unavailable"
        }
        return [
            "id": reader.id,
            "name": reader.name,
            "serialNumber": reader.serialNumber ?? NSNull(),
            "model": model,
            "status": status,
            "embedded": reader.connectionType == .embedded,
        ]
    }

    private static func describe(_ payment: Payment) -> [String: Any] {
        var out: [String: Any] = [
            "id": payment.id ?? NSNull(),
            "amountCents": payment.amountMoney.amount,
            "totalCents": payment.totalMoney.amount,
            "referenceId": payment.referenceID ?? NSNull(),
            "orderId": payment.orderID ?? NSNull(),
            "locationId": payment.locationID ?? NSNull(),
        ]
        if let online = payment as? OnlinePayment {
            out["online"] = true
            switch online.status {
            case .completed: out["paymentStatus"] = "COMPLETED"
            case .approved: out["paymentStatus"] = "APPROVED"
            case .canceled: out["paymentStatus"] = "CANCELED"
            case .failed: out["paymentStatus"] = "FAILED"
            case .pending: out["paymentStatus"] = "PENDING"
            default: out["paymentStatus"] = "UNKNOWN"
            }
            if let card = online.cardDetails?.card {
                out["last4"] = card.last4 ?? NSNull()
            }
        } else {
            out["online"] = false
        }
        return out
    }
}

extension StandReaderPlugin: PaymentManagerDelegate {
    public func paymentManager(_ paymentManager: PaymentManager, didFinish payment: Payment) {
        finish(payment, status: "finished")
    }

    public func paymentManager(_ paymentManager: PaymentManager, didFail payment: Payment, withError error: Error) {
        finish(payment, status: "failed", error: error)
    }

    public func paymentManager(_ paymentManager: PaymentManager, didCancel payment: Payment) {
        finish(payment, status: "canceled")
    }
}

extension StandReaderPlugin: ReaderObserver {
    public func readerWasAdded(_ readerInfo: ReaderInfo) {
        notifyListeners("readersChanged", data: ["reader": Self.describe(readerInfo), "change": "added"])
    }

    public func readerWasRemoved(_ readerInfo: ReaderInfo) {
        notifyListeners("readersChanged", data: ["reader": Self.describe(readerInfo), "change": "removed"])
    }

    public func readerDidChange(_ readerInfo: ReaderInfo, change: ReaderChange) {
        notifyListeners("readersChanged", data: ["reader": Self.describe(readerInfo), "change": "changed"])
    }
}
