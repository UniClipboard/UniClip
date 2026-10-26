import Foundation
internal import UcEngineCore

enum KeyboardLanSyncError: LocalizedError {
    case notConfigured
    case missingPassword
    case invalidURL
    case unavailable
    case authenticationFailed
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "No LAN server is configured."
        case .missingPassword: return "The LAN server password is unavailable."
        case .invalidURL: return "The LAN server address is invalid."
        case .unavailable: return "The LAN server is unavailable."
        case .authenticationFailed: return "The LAN server rejected the credentials."
        case .invalidResponse: return "The LAN server returned an invalid response."
        }
    }
}

@MainActor
final class KeyboardLanSyncTransport: KeyboardSyncTransport {
    let channel = SyncChannel.lan

    private struct Configuration: Equatable {
        let server: LanServerProfile
        let password: String
    }

    private let store: SettingsStore
    private lazy var history = HistoryLog(store: store)
    private var configurations: [Configuration] = []
    private var clients: [String: KeyboardLanHttpClient] = [:]
    private var lastSeenRemoteIdentity: [String: String] = [:]
    private var isStopped = false

    init(store: SettingsStore) {
        self.store = store
    }

    func synchronize(_ snapshot: DeviceClipboardSnapshot?) async throws -> KeyboardSyncResult {
        try checkActive()
        let currentClients = try currentClients()
        var delivery: ExtensionDeliveryReport?
        if let snapshot {
            var accepted: UInt64 = 0
            var offline: UInt64 = 0
            var errored: UInt64 = 0
            for (_, client) in currentClients {
                do {
                    try await client.publish(snapshot)
                    try checkActive()
                    try client.checkActive()
                    accepted += 1
                } catch is CancellationError {
                    throw CancellationError()
                } catch KeyboardLanSyncError.unavailable {
                    try checkActive()
                    try client.checkActive()
                    offline += 1
                } catch {
                    try checkActive()
                    try client.checkActive()
                    errored += 1
                }
            }
            delivery = ExtensionDeliveryReport(
                entryId: snapshot.clipboard.contentId ?? snapshot.clipboard.hash ?? UUID().uuidString,
                accepted: accepted,
                duplicate: 0,
                offline: offline,
                errored: errored,
                pending: 0
            )
        }
        let remote = try await pullRemote(using: currentClients, outgoing: snapshot?.clipboard)
        try checkActive()
        for (_, client) in currentClients { try client.checkActive() }
        return KeyboardSyncResult(remoteChange: remote.map(KeyboardRemoteChange.snapshot), delivery: delivery)
    }

    func waitForRemoteChange(timeoutMs: UInt64) async throws -> KeyboardRemoteChange? {
        try checkActive()
        try await Task.sleep(nanoseconds: timeoutMs * 1_000_000)
        try checkActive()
        let remote = try await pullRemote(using: currentClients(), outgoing: nil)
        return remote.map(KeyboardRemoteChange.snapshot)
    }

    func stop() {
        guard !isStopped else { return }
        isStopped = true
        clients.values.forEach { $0.stop() }
        clients = [:]
        configurations = []
        lastSeenRemoteIdentity = [:]
    }

    private func currentClients() throws -> [(String, KeyboardLanHttpClient)] {
        try checkActive()
        let settings = store.loadAppSettings()
        guard settings.syncChannel == .lan, !settings.lanServers.isEmpty else {
            throw KeyboardLanSyncError.notConfigured
        }
        let nextConfigurations = try settings.lanServers.compactMap { server -> Configuration? in
            guard let password = try LanServerCredentialStore.password(serverId: server.id),
                  !password.isEmpty else { return nil }
            return Configuration(server: server, password: password)
        }
        guard !nextConfigurations.isEmpty else { throw KeyboardLanSyncError.missingPassword }
        if configurations != nextConfigurations {
            clients.values.forEach { $0.stop() }
            clients = Dictionary(uniqueKeysWithValues: try nextConfigurations.map { configuration in
                (
                    configuration.server.id,
                    try KeyboardLanHttpClient(
                        server: configuration.server,
                        password: configuration.password
                    )
                )
            })
            configurations = nextConfigurations
            lastSeenRemoteIdentity = [:]
        }
        return settings.lanServers.compactMap { server in
            clients[server.id].map { (server.id, $0) }
        }
    }

    private func pullRemote(
        using clients: [(String, KeyboardLanHttpClient)],
        outgoing: Clipboard?
    ) async throws -> DeviceClipboardSnapshot? {
        for (serverId, client) in clients {
            try checkActive()
            let remote: DeviceClipboardSnapshot?
            do {
                remote = try await client.pull()
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                try checkActive()
                try client.checkActive()
                continue
            }
            try checkActive()
            try client.checkActive()
            guard let remote else { continue }
            let identity = Self.identity(remote.clipboard)
            if identity == lastSeenRemoteIdentity[serverId] { continue }
            lastSeenRemoteIdentity[serverId] = identity
            if let outgoing, Self.sameContent(remote.clipboard, outgoing) { continue }
            if let hash = remote.clipboard.hash,
               history.headHash()?.caseInsensitiveCompare(hash) == .orderedSame {
                continue
            }
            return remote
        }
        return nil
    }

    private func checkActive() throws {
        try Task.checkCancellation()
        guard !isStopped else { throw CancellationError() }
    }

    private static func identity(_ clipboard: Clipboard) -> String {
        clipboard.contentId ?? clipboard.hash ?? "\(clipboard.type.rawValue):\(clipboard.text)"
    }

    private static func sameContent(_ lhs: Clipboard, _ rhs: Clipboard) -> Bool {
        if let left = lhs.contentId, let right = rhs.contentId, left == right { return true }
        if let left = lhs.hash, let right = rhs.hash,
           left.caseInsensitiveCompare(right) == .orderedSame { return true }
        return lhs.type == rhs.type
            && lhs.text == rhs.text
            && lhs.dataName == rhs.dataName
            && lhs.size == rhs.size
    }
}

private final class KeyboardLanHttpClient: @unchecked Sendable {
    private let server: LanServerProfile
    private let authorization: String
    private let session: URLSession
    // Task creation and invalidation must share one synchronous boundary.
    private let sessionLock = NSLock()
    private var isStopped = false

    init(server: LanServerProfile, password: String) throws {
        let urls = try server.urls.map(Self.normalizedBaseURL)
        guard !urls.isEmpty else { throw KeyboardLanSyncError.invalidURL }
        self.server = LanServerProfile(
            id: server.id,
            name: server.name,
            urls: urls.map(\.absoluteString),
            username: server.username,
            allowInsecureTls: server.allowInsecureTls
        )
        authorization = "Basic " + Data("\(server.username):\(password)".utf8).base64EncodedString()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 5 * 60
        session = URLSession(
            configuration: configuration,
            delegate: server.allowInsecureTls ? KeyboardLanTrustDelegate() : nil,
            delegateQueue: nil
        )
    }

    func publish(_ snapshot: DeviceClipboardSnapshot) async throws {
        try await withCandidate { baseURL in
            if snapshot.clipboard.hasData,
               let dataName = snapshot.clipboard.dataName,
               let payload = snapshot.payload {
                try await self.put(payload, name: dataName, baseURL: baseURL)
            }
            var request = URLRequest(url: baseURL.appendingPathComponent("SyncClipboard.json"))
            request.httpMethod = "PUT"
            request.setValue(self.authorization, forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(snapshot.clipboard)
            _ = try await self.perform(request)
        }
    }

    func pull() async throws -> DeviceClipboardSnapshot? {
        try await withCandidate { baseURL in
            var request = URLRequest(url: baseURL.appendingPathComponent("SyncClipboard.json"))
            request.httpMethod = "GET"
            request.setValue(self.authorization, forHTTPHeaderField: "Authorization")
            let (data, response) = try await self.requestData(request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            if status == 404 { return nil }
            try self.validate(status: status)
            guard let clipboard = try? JSONDecoder().decode(Clipboard.self, from: data) else {
                throw KeyboardLanSyncError.invalidResponse
            }
            let payload: Data?
            if clipboard.hasData, let dataName = clipboard.dataName {
                payload = try await self.getFile(name: dataName, baseURL: baseURL)
            } else {
                payload = nil
            }
            return DeviceClipboardSnapshot(clipboard: clipboard, payload: payload)
        }
    }

    func stop() {
        sessionLock.withLock {
            guard !isStopped else { return }
            isStopped = true
            session.invalidateAndCancel()
        }
    }

    private func withCandidate<T: Sendable>(
        _ operation: (URL) async throws -> T
    ) async throws -> T {
        var lastError: Error = KeyboardLanSyncError.unavailable
        for rawURL in server.urls {
            try checkActive()
            guard let baseURL = URL(string: rawURL) else { continue }
            do {
                let result = try await operation(baseURL)
                try checkActive()
                return result
            } catch is CancellationError {
                throw CancellationError()
            } catch KeyboardLanSyncError.authenticationFailed {
                throw KeyboardLanSyncError.authenticationFailed
            } catch {
                try checkActive()
                lastError = error
            }
        }
        throw lastError
    }

    private func put(_ data: Data, name: String, baseURL: URL) async throws {
        guard !name.isEmpty, !name.contains("/"), !name.contains("\\") else {
            throw KeyboardLanSyncError.invalidResponse
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("file").appendingPathComponent(name))
        request.httpMethod = "PUT"
        request.setValue(authorization, forHTTPHeaderField: "Authorization")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        _ = try await perform(request)
    }

    private func getFile(name: String, baseURL: URL) async throws -> Data {
        guard !name.isEmpty, !name.contains("/"), !name.contains("\\") else {
            throw KeyboardLanSyncError.invalidResponse
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("file").appendingPathComponent(name))
        request.httpMethod = "GET"
        request.setValue(authorization, forHTTPHeaderField: "Authorization")
        return try await perform(request)
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        do {
            let (data, response) = try await requestData(request)
            try validate(status: (response as? HTTPURLResponse)?.statusCode ?? -1)
            return data
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as KeyboardLanSyncError {
            throw error
        } catch {
            throw KeyboardLanSyncError.unavailable
        }
    }

    func checkActive() throws {
        try Task.checkCancellation()
        try sessionLock.withLock {
            guard !isStopped else { throw CancellationError() }
        }
    }

    private func requestData(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try checkActive()
        let cancellation = KeyboardLanRequestCancellation()
        do {
            let result: (Data, URLResponse) = try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    sessionLock.withLock {
                        guard !isStopped, !Task.isCancelled else {
                            continuation.resume(throwing: CancellationError())
                            return
                        }
                        // Keep task creation synchronous with session invalidation.
                        let task = session.dataTask(with: request) { data, response, error in
                            if let error {
                                continuation.resume(throwing: error)
                            } else if let data, let response {
                                continuation.resume(returning: (data, response))
                            } else {
                                continuation.resume(throwing: KeyboardLanSyncError.invalidResponse)
                            }
                        }
                        cancellation.start(task)
                    }
                }
            } onCancel: {
                cancellation.cancel()
            }
            try checkActive()
            return result
        } catch {
            if error is CancellationError || (error as? URLError)?.code == .cancelled {
                throw CancellationError()
            }
            try checkActive()
            throw error
        }
    }

    private func validate(status: Int) throws {
        switch status {
        case 200...299: return
        case 401, 403: throw KeyboardLanSyncError.authenticationFailed
        default: throw KeyboardLanSyncError.unavailable
        }
    }

    private static func normalizedBaseURL(_ raw: String) throws -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = trimmed.hasSuffix("/") ? trimmed : trimmed + "/"
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              url.host?.isEmpty == false else {
            throw KeyboardLanSyncError.invalidURL
        }
        return url
    }
}

// Cancellation can arrive before the URLSession task is installed.
private final class KeyboardLanRequestCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var task: URLSessionDataTask?
    private var isCancelled = false

    func start(_ task: URLSessionDataTask) {
        lock.withLock {
            self.task = task
            if isCancelled { task.cancel() }
            task.resume()
        }
    }

    func cancel() {
        lock.withLock {
            isCancelled = true
            task?.cancel()
        }
    }
}

private final class KeyboardLanTrustDelegate: NSObject, URLSessionDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @Sendable @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
