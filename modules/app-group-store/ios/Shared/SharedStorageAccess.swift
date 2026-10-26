import Foundation

/// Process-local admission for App Group work. This never unlocks another owner.
/// Closing admission keeps accepted work counted until its actual return.
public final class SharedStorageAccess: @unchecked Sendable {
    public static let shared = SharedStorageAccess()

    public enum AccessError: Error {
        case suspended
    }

    private let lock = NSLock()
    private var accepting = true
    private var epoch: UInt64 = 0
    private var active: [UInt64: Int] = [:]
    private var completions: [(generation: UInt64, finish: () -> Void)] = []

    public init() {}

    public var generation: UInt64 { lock.withLock { epoch } }
    public var isOpen: Bool { lock.withLock { accepting } }

    public func requireOpen() throws {
        try lock.withLock {
            guard accepting else { throw AccessError.suspended }
        }
    }

    public func withAccess<T>(generation: UInt64? = nil, _ work: () throws -> T) throws -> T {
        let acceptedGeneration = try begin(generation)
        defer { end(acceptedGeneration) }
        return try work()
    }

    public func withAccess<T>(generation: UInt64? = nil, _ work: () async throws -> T) async throws -> T {
        let acceptedGeneration = try begin(generation)
        defer { end(acceptedGeneration) }
        return try await work()
    }

    /// A stale expiration cannot close admission reopened by the foreground.
    public func suspend(ifGeneration generation: UInt64? = nil, completion: @escaping () -> Void = {}) {
        let ready = lock.withLock { () -> Bool in
            let target = generation ?? epoch
            if target == epoch { accepting = false }
            guard !active.keys.contains(where: { $0 <= target }) else {
                completions.append((target, completion))
                return false
            }
            return true
        }
        if ready { completion() }
    }

    public func resume() {
        lock.withLock {
            epoch &+= 1
            accepting = true
        }
    }

    private func begin(_ generation: UInt64?) throws -> UInt64 {
        try lock.withLock {
            guard accepting, generation == nil || generation == epoch else { throw AccessError.suspended }
            active[epoch, default: 0] += 1
            return epoch
        }
    }

    private func end(_ generation: UInt64) {
        let ready = lock.withLock { () -> [() -> Void] in
            if active[generation] == 1 { active.removeValue(forKey: generation) }
            else { active[generation, default: 0] -= 1 }
            let ready = completions.filter { pending in
                !active.keys.contains(where: { $0 <= pending.generation })
            }
            completions.removeAll { pending in
                !active.keys.contains(where: { $0 <= pending.generation })
            }
            return ready.map(\.finish)
        }
        ready.forEach { $0() }
    }
}
