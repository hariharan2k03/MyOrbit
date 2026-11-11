import CommonCrypto
import ExpoModulesCore

/// Native PBKDF2 for backup passwords. The same derivation in JavaScript takes
/// close to a minute on Hermes at 310,000 iterations; CommonCrypto takes well
/// under a second. Output is identical, so backups stay interchangeable.
public class MyOrbitCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MyOrbitCrypto")

    /// PBKDF2-HMAC-SHA256. Returns the derived key as lowercase hex.
    AsyncFunction("pbkdf2Sha256") { (password: String, saltHex: String, iterations: Int, keyLength: Int) throws -> String in
      guard iterations > 0, iterations <= 10_000_000, keyLength > 0, keyLength <= 64, let salt = Data(hex: saltHex) else {
        throw CryptoError("Invalid key derivation parameters.")
      }
      let pw = Array(password.utf8)
      var key = [UInt8](repeating: 0, count: keyLength)
      let status = salt.withUnsafeBytes { saltBytes in
        CCKeyDerivationPBKDF(
          CCPBKDFAlgorithm(kCCPBKDF2),
          pw, pw.count,
          saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
          CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
          UInt32(iterations),
          &key, keyLength
        )
      }
      guard status == kCCSuccess else { throw CryptoError("Key derivation failed.") }
      return key.map { String(format: "%02x", $0) }.joined()
    }
  }
}

final class CryptoError: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

private extension Data {
  init?(hex: String) {
    guard hex.count % 2 == 0 else { return nil }
    var bytes = [UInt8]()
    bytes.reserveCapacity(hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      guard let b = UInt8(hex[index..<next], radix: 16) else { return nil }
      bytes.append(b)
      index = next
    }
    self.init(bytes)
  }
}
