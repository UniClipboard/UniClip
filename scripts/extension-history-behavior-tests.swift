// Native storage integration check with the production writer and real SQLite.
// Failure modes: missing identities, replacement of a concurrent row, identity
// changes on resurface, revived pulled tombstones, and failure on older schemas.
import Foundation
import SQLite3

@main
struct ExtensionHistoryBehaviorTests {
    static func main() throws {
        let schema = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        var results: [[String: Any]] = []
        var failed = false
        func check(_ passed: Bool, _ name: String) {
            results.append(["name": name, "passed": passed])
            print("\(passed ? "PASS" : "FAIL") \(name)")
            if !passed { failed = true }
        }
        for version in [1, 4, 5] {
            let container = output.appendingPathComponent("schema-\(version)", isDirectory: true)
            if FileManager.default.fileExists(atPath: container.path) {
                try FileManager.default.removeItem(at: container)
            }
            let directory = container.appendingPathComponent("Databases", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let path = directory.appendingPathComponent("uniclipboard.db").path
            var db: OpaquePointer?
            guard sqlite3_open(path, &db) == SQLITE_OK else { fatalError("open fixture") }
            defer { sqlite3_close(db) }
            func execute(_ sql: String) {
                guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
                    fatalError(String(cString: sqlite3_errmsg(db)))
                }
            }
            func scalar(_ sql: String) -> String? {
                var stmt: OpaquePointer?
                guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
                    fatalError(String(cString: sqlite3_errmsg(db)))
                }
                defer { sqlite3_finalize(stmt) }
                guard sqlite3_step(stmt) == SQLITE_ROW, let text = sqlite3_column_text(stmt, 0) else { return nil }
                return String(cString: text)
            }
            execute(schema)
            if version >= 4 { execute("ALTER TABLE clipboard_history ADD COLUMN contentId TEXT") }
            if version == 5 { execute("ALTER TABLE clipboard_history ADD COLUMN incarnationId TEXT") }
            execute("PRAGMA user_version = \(version)")
            guard let writer = HistoryDatabase(containerURL: container) else { fatalError("open production writer") }
            let entry = Clipboard(type: .text, hash: "AABB", text: "synthetic", hasData: false, contentId: "blake3v1:synthetic")
            check(writer.record(entry: entry, direction: .local), "v\(version) inserts")
            check(writer.loadRecent(limit: 10).count == 1, "v\(version) reads")
            if version == 4 {
                // The app can migrate while an extension keeps its writer open.
                execute("ALTER TABLE clipboard_history ADD COLUMN incarnationId TEXT; PRAGMA user_version=5")
                let next = Clipboard(type: .text, hash: "CCDD", text: "after migration", hasData: false)
                check(writer.record(entry: next, direction: .local), "open v4 writer inserts after migration")
                check(scalar("SELECT incarnationId FROM clipboard_history WHERE profileHash='CCDD'").flatMap(UUID.init(uuidString:)) != nil, "open writer detects newly added identity column")
            }
            if version == 5 {
                let id = scalar("SELECT incarnationId FROM clipboard_history")
                check(id.flatMap(UUID.init(uuidString:)) != nil, "v5 allocates identity")
                execute("UPDATE clipboard_history SET starred=1, version=7")
                check(writer.record(entry: entry, direction: .local), "v5 resurfaces")
                writer.touch(profileHash: "AABB")
                check(scalar("SELECT incarnationId FROM clipboard_history") == id, "resurface and touch preserve identity")
                check(scalar("SELECT version || ':' || starred FROM clipboard_history") == "7:1", "resurface preserves revision and preference")
                execute("DELETE FROM clipboard_history")
                check(writer.record(entry: entry, direction: .local), "recreates row")
                check(scalar("SELECT incarnationId FROM clipboard_history") != id, "recreation changes identity")
                for pulled in [false, true] {
                    execute("DELETE FROM clipboard_history")
                    // A competing writer wins after existingState reads absent.
                    // The trigger inserts that row immediately before our INSERT.
                    execute("""
                    CREATE TRIGGER competing_insert BEFORE INSERT ON clipboard_history
                    WHEN NOT EXISTS (SELECT 1 FROM clipboard_history WHERE profileHash=NEW.profileHash)
                    BEGIN
                      INSERT INTO clipboard_history(profileHash,type,text,incarnationId,version,starred,isDeleted)
                      VALUES(NEW.profileHash,'Text','winner','winner-id',9,1,\(pulled ? 1 : 0));
                    END;
                    """)
                    let recorded = writer.record(entry: entry, direction: pulled ? .pulled : .local)
                    check(recorded == !pulled, "concurrent \(pulled ? "pulled tombstone" : "local row") result")
                    check(scalar("SELECT incarnationId || ':' || version || ':' || starred FROM clipboard_history") == "winner-id:9:1", "concurrent writer identity and metadata survive (pulled=\(pulled))")
                    check(scalar("SELECT isDeleted FROM clipboard_history") == (pulled ? "1" : "0"), "concurrent tombstone policy (pulled=\(pulled))")
                    execute("DROP TRIGGER competing_insert")
                }
            }
        }
        let data = try JSONSerialization.data(withJSONObject: ["checks": results, "passed": !failed], options: [.prettyPrinted, .sortedKeys])
        try data.write(to: output.appendingPathComponent("results.json"), options: .atomic)
        if failed { exit(1) }
    }
}
