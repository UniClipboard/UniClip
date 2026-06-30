import Foundation
import OSLog

private let routeLog = Logger(subsystem: "app.uniclipboard", category: "route")

public struct ServerRouteExecutor: Sendable {
    private let store: SettingsStore
    private let probeTimeoutNanoseconds: UInt64

    public init(
        store: SettingsStore = SettingsStore(),
        probeTimeoutNanoseconds: UInt64 = 1_000_000_000
    ) {
        self.store = store
        self.probeTimeoutNanoseconds = probeTimeoutNanoseconds
    }

    public func run<T>(
        server: ServerConfig,
        network: NetworkContext,
        probe: (@Sendable (ServerConfig) async throws -> Void)? = nil,
        operation: (ServerConfig) async throws -> T
    ) async throws -> T {
        let runStarted = timingNow()
        let live = store.loadLiveURL(configId: server.id)
        let urls = server.preferredURLs(live: live, network: network)
        routeLog.error("[route-timing][route-v3] run start server=\(server.id, privacy: .public) wifi=\(network.isWifi, privacy: .public) cellular=\(network.isCellular, privacy: .public) tailscale=\(network.isTailscale, privacy: .public) ssid=\(network.ssid ?? "nil", privacy: .private) live=\(live ?? "nil", privacy: .public) urls=\(urls.joined(separator: " | "), privacy: .public)")
        let routeURLs: [String]
        if let probe, urls.count > 1 {
            let healthy = try await healthyURLs(server: server, urls: urls, probe: probe)
            guard !healthy.isEmpty else {
                store.saveLiveURL(configId: server.id, nil)
                routeLog.error("[route-timing] run failed no healthy route after probe totalMs=\(timingElapsedMilliseconds(since: runStarted), privacy: .public)")
                throw SyncError(kind: .networkUnreachable)
            }
            routeURLs = healthy
        } else {
            routeURLs = urls
            if urls.count <= 1 {
                routeLog.error("[route-timing][route-v3] probe skipped urlCount=\(urls.count, privacy: .public)")
            }
        }
        var lastRetryableError: Error?

        for url in routeURLs {
            let operationStarted = timingNow()
            let routed = routedServer(server, url: url, urls: urls)
            do {
                routeLog.error("[route-timing][route-v3] operation start url=\(url, privacy: .public)")
                let result = try await operation(routed)
                store.saveLiveURL(configId: server.id, url)
                routeLog.error("[route-timing][route-v3] operation success url=\(url, privacy: .public) operationMs=\(timingElapsedMilliseconds(since: operationStarted), privacy: .public) totalMs=\(timingElapsedMilliseconds(since: runStarted), privacy: .public)")
                return result
            } catch {
                guard Self.isRetryable(error) else { throw error }
                routeLog.error("[route-timing][route-v3] operation failed url=\(url, privacy: .public) operationMs=\(timingElapsedMilliseconds(since: operationStarted), privacy: .public) error=\(String(describing: error), privacy: .public), trying next")
                lastRetryableError = error
            }
        }

        store.saveLiveURL(configId: server.id, nil)
        routeLog.error("[route-timing] run failed totalMs=\(timingElapsedMilliseconds(since: runStarted), privacy: .public)")
        throw lastRetryableError ?? SyncError(kind: .networkUnreachable)
    }

    private func healthyURLs(
        server: ServerConfig,
        urls: [String],
        probe: @escaping @Sendable (ServerConfig) async throws -> Void
    ) async throws -> [String] {
        let probeStarted = timingNow()
        routeLog.error("[route-timing][route-v3] probe batch start timeoutMs=\(probeTimeoutNanoseconds / 1_000_000, privacy: .public) urls=\(urls.joined(separator: " | "), privacy: .public)")

        let outcomes = await withTaskGroup(of: ProbeOutcome.self) { group in
            for (index, url) in urls.enumerated() {
                let routed = routedServer(server, url: url, urls: urls)
                group.addTask {
                    let started = timingNow()
                    routeLog.error("[route-timing][route-v3] probe start url=\(url, privacy: .public)")
                    do {
                        try await withProbeTimeout(nanoseconds: probeTimeoutNanoseconds) {
                            try await probe(routed)
                        }
                        let elapsed = timingElapsedMilliseconds(since: started)
                        routeLog.error("[route-timing][route-v3] probe success url=\(url, privacy: .public) ms=\(elapsed, privacy: .public)")
                        return .success(url: url, index: index, milliseconds: elapsed)
                    } catch {
                        routeLog.error("[route-timing][route-v3] probe failed url=\(url, privacy: .public) ms=\(timingElapsedMilliseconds(since: started), privacy: .public) error=\(String(describing: error), privacy: .public)")
                        return .failure(
                            url: url,
                            retryable: Self.isRetryable(error),
                            syncError: error as? SyncError,
                            description: String(describing: error)
                        )
                    }
                }
            }

            var outcomes: [ProbeOutcome] = []
            for await outcome in group {
                outcomes.append(outcome)
            }
            return outcomes
        }

        if case let .failure(_, _, syncError, _)? = outcomes.first(where: {
            if case let .failure(_, retryable, _, _) = $0 { return !retryable }
            return false
        }) {
            throw syncError ?? SyncError(kind: .networkUnreachable)
        }

        let healthy = outcomes.compactMap { outcome -> ProbeSuccess? in
            if case let .success(url, index, milliseconds) = outcome {
                return ProbeSuccess(url: url, index: index, milliseconds: milliseconds)
            }
            return nil
        }
        .sorted {
            if $0.milliseconds == $1.milliseconds { return $0.index < $1.index }
            return $0.milliseconds < $1.milliseconds
        }

        if healthy.isEmpty {
            let retryableErrors = outcomes.compactMap { outcome -> String? in
                if case let .failure(url, _, _, description) = outcome {
                    return "\(url): \(description)"
                }
                return nil
            }
            routeLog.error("[route-timing][route-v3] probe batch no healthy route batchMs=\(timingElapsedMilliseconds(since: probeStarted), privacy: .public) failures=\(retryableErrors.joined(separator: " | "), privacy: .public)")
        } else {
            routeLog.error("[route-timing][route-v3] probe batch selected urls=\(healthy.map { "\($0.url)(\($0.milliseconds)ms)" }.joined(separator: " | "), privacy: .public) batchMs=\(timingElapsedMilliseconds(since: probeStarted), privacy: .public)")
        }

        return healthy.map(\.url)
    }

    private func routedServer(_ server: ServerConfig, url: String, urls: [String]) -> ServerConfig {
        var routed = server
        routed.urls = [url] + urls.filter { $0 != url }
        return routed
    }

    fileprivate static func isRetryable(_ error: Error) -> Bool {
        guard let syncError = error as? SyncError else { return true }
        switch syncError.kind {
        case .connectTimeout, .receiveTimeout, .networkUnreachable, .cancelled:
            return true
        case .authFailed, .notFound, .protocolError, .serverError, .decodingFailed, .hashMismatch, .invalidURL:
            return false
        }
    }
}

private enum ProbeOutcome: Sendable {
    case success(url: String, index: Int, milliseconds: UInt64)
    case failure(url: String, retryable: Bool, syncError: SyncError?, description: String)
}

private struct ProbeSuccess: Sendable {
    let url: String
    let index: Int
    let milliseconds: UInt64
}

private func withProbeTimeout(
    nanoseconds: UInt64,
    operation: @escaping @Sendable () async throws -> Void
) async throws {
    let race = TimeoutRace()
    try await withTaskCancellationHandler {
        try await withCheckedThrowingContinuation { continuation in
            race.start(continuation: continuation)
            let operationTask = Task {
                do {
                    try await operation()
                    race.succeed()
                } catch {
                    race.fail(error)
                }
            }
            let timeoutTask = Task {
                try? await Task.sleep(nanoseconds: nanoseconds)
                guard !Task.isCancelled else { return }
                race.fail(SyncError(kind: .connectTimeout))
            }
            race.setTasks([operationTask, timeoutTask])
        }
    } onCancel: {
        race.cancelAll()
    }
}

private final class TimeoutRace: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    private var tasks: [Task<Void, Never>] = []
    private var isFinished = false

    func start(continuation: CheckedContinuation<Void, Error>) {
        lock.lock()
        self.continuation = continuation
        lock.unlock()
    }

    func setTasks(_ tasks: [Task<Void, Never>]) {
        lock.lock()
        if isFinished {
            lock.unlock()
            for task in tasks { task.cancel() }
            return
        }
        self.tasks = tasks
        lock.unlock()
    }

    func succeed() {
        let completion = finish(returning: ())
        complete(completion)
    }

    func fail(_ error: Error) {
        let completion = finish(throwing: error)
        complete(completion)
    }

    func cancelAll() {
        let completion = finish(throwing: SyncError(kind: .cancelled))
        complete(completion)
    }

    private func finish(returning value: Void) -> Completion {
        lock.lock()
        guard !isFinished else {
            lock.unlock()
            return .none
        }
        isFinished = true
        let continuation = self.continuation
        self.continuation = nil
        let tasks = self.tasks
        lock.unlock()
        return .returning(continuation, tasks)
    }

    private func finish(throwing error: Error) -> Completion {
        lock.lock()
        guard !isFinished else {
            lock.unlock()
            return .none
        }
        isFinished = true
        let continuation = self.continuation
        self.continuation = nil
        let tasks = self.tasks
        lock.unlock()
        return .throwing(error, continuation, tasks)
    }

    private func complete(_ completion: Completion) {
        switch completion {
        case .none:
            return
        case .returning(let continuation, let tasks):
            for task in tasks { task.cancel() }
            continuation?.resume()
        case .throwing(let error, let continuation, let tasks):
            for task in tasks { task.cancel() }
            continuation?.resume(throwing: error)
        }
    }

    private enum Completion {
        case none
        case returning(CheckedContinuation<Void, Error>?, [Task<Void, Never>])
        case throwing(Error, CheckedContinuation<Void, Error>?, [Task<Void, Never>])
    }
}

private func timingNow() -> UInt64 {
    DispatchTime.now().uptimeNanoseconds
}

private func timingElapsedMilliseconds(since start: UInt64) -> UInt64 {
    (DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
}
