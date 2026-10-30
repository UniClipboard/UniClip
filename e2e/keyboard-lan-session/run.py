#!/usr/bin/env python3
"""Exercise the real Swift LAN transport against synthetic loopback HTTP."""
import argparse
import difflib
import hashlib
import http.server
import json
import pathlib
import signal
import subprocess
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SOURCE = "targets/keyboard/KeyboardLanSyncTransport.swift"
CASES = ["cancel-stop", "single", "pull", "stop", "cancel", "pre-stop", "pre-cancel",
         "receive-sleep", "reopen", "replace", "payload-put", "payload-get",
         "healthy", "fallback", "auth", "admission-race", "multi-server"]
CANCEL_CASES = set(CASES) - {"healthy", "fallback", "auth", "receive-sleep"}


def instrument(source):
    modified = source.replace("internal import UcEngineCore\n", "")
    modified = modified.replace("private let session: URLSession", "private let session: URLSession\n    private let traceSessionID = UUID().uuidString")
    probes = [
        ("session.invalidateAndCancel()", 'trace("session.invalidate", ["session": objectID(session)])\n        session.invalidateAndCancel()'),
        ("return try await operation(baseURL)", 'trace("candidate.enter", ["url": baseURL.absoluteString, "session": objectID(session)])\n                return try await operation(baseURL)'),
        ("let (data, response) = try await self.session.data(for: request)", 'trace("task.create", ["url": request.url!.absoluteString, "method": request.httpMethod ?? "", "session": objectID(self.session)])\n            let (data, response) = try await self.session.data(for: request)'),
        ("let (data, response) = try await session.data(for: request)", 'trace("task.create", ["url": request.url!.absoluteString, "method": request.httpMethod ?? "", "session": objectID(session)])\n            let (data, response) = try await session.data(for: request)'),
        ("let task = session.dataTask(with: request)", 'trace("task.create", ["url": request.url!.absoluteString, "method": request.httpMethod ?? "", "session": objectID(session)])\n                    let task = session.dataTask(with: request)'),
    ]
    for original, replacement in probes:
        modified = modified.replace(original, replacement)
    modified = modified.replace("objectID(self.session)", "self.traceSessionID").replace("objectID(session)", "traceSessionID")
    if 'trace("task.create"' not in modified:
        raise RuntimeError("No task creation probe matched")
    return modified


def execute(binary, case, mode):
    marker = case / "request.marker"
    events = []
    event_lock = threading.Lock()

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def handle_request(self):
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            with event_lock:
                events.append({"event": "request", "ns": time.monotonic_ns(),
                               "method": self.command, "path": self.path})
            first = self.path.startswith("/a/")
            payload_get = mode == "payload-get"
            trigger = first and ("/file/" in self.path if payload_get else True)
            if trigger:
                marker.touch()
                time.sleep(0.2)
            status = 503 if first and mode == "fallback" else 401 if first and mode == "auth" else 200
            body = b""
            if self.command == "GET" and status == 200:
                if payload_get and self.path.endswith("SyncClipboard.json"):
                    body = json.dumps({"type": "text", "text": "synthetic", "contentId": "remote",
                                       "dataName": "fixture.bin", "size": 3}).encode()
                elif "/file/" in self.path:
                    body = bytes([1, 2, 3])
                else:
                    status = 404
            try:
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        do_GET = handle_request
        do_PUT = handle_request

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    # Join handler threads before the next case to avoid leaking a case's state.
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    thread.start()
    try:
        with (case / "trace.jsonl").open("w") as stdout, (case / "stderr.txt").open("w") as stderr:
            proc = subprocess.Popen([str(binary), mode, f"http://127.0.0.1:{server.server_port}",
                                     str(marker)], stdout=stdout, stderr=stderr)
            try:
                code = proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                code = proc.wait()
                events.append({"event": "harness.timeout"})
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    (case / "server.json").write_text(json.dumps(events, indent=2))
    rows = [json.loads(line) for line in (case / "trace.jsonl").read_text().splitlines()]
    failures = []
    if code != 0:
        failures.append(f"process exit {code}")
    if not any(r["event"] == "harness.complete" for r in rows):
        failures.append("missing completion")
    invalidations = [r for r in rows if r["event"] == "session.invalidate"]
    creates = [r for r in rows if r["event"] == "task.create"]
    after_close = [r for r in creates if any(
        i["session"] == r["session"] and int(i["ns"]) < int(r["ns"]) for i in invalidations)]
    if after_close:
        failures.append("task created after invalidation")
    if mode in CANCEL_CASES:
        if not any(r["event"] == "sync.error" and r.get("cancellation") == "true" for r in rows):
            failures.append("cancellation did not propagate")
        if mode not in {"reopen", "replace"}:
            boundary = [r for r in rows if r["event"] in {"task.cancel", "owner.hide"}]
            if boundary and any(int(r["ns"]) > int(boundary[0]["ns"]) for r in creates):
                failures.append("request admitted after cancel/hide")
    if mode in {"pre-stop", "pre-cancel", "receive-sleep"} and creates:
        failures.append("pre-canceled or stopped work admitted")
    if mode == "receive-sleep" and not any(
            r["event"] == "receive.error" and r.get("cancellation") == "true" for r in rows):
        failures.append("receive cancellation did not propagate")
    if mode == "reopen":
        if not any(r["event"] == "reuse.error" and r.get("cancellation") == "true" for r in rows):
            failures.append("stopped transport reopened")
        if not any(r["event"] == "fresh.return" for r in rows):
            failures.append("fresh transport failed")
    if mode == "replace" and not any(r["event"] == "replacement.return" for r in rows):
        failures.append("replacement client failed")
    requests = [r for r in events if r["event"] == "request"]
    if mode in {"healthy", "fallback", "auth"}:
        result = next((r for r in rows if r["event"] == "sync.return"), {})
        if result.get("accepted") != ("0" if mode == "auth" else "1"):
            failures.append("unexpected delivery result")
        if not any(r["method"] == "GET" for r in requests):
            failures.append("healthy pull missing")
        if mode == "fallback" and not any(r["path"].startswith("/b/") for r in requests):
            failures.append("ordinary failure did not fall back")
        if mode == "auth" and any(r["path"].startswith("/b/") for r in requests):
            failures.append("authentication failure fell back")
    return {"case": mode, "returncode": code,
            "signal": signal.Signals(-code).name if code < 0 else None,
            "failures": failures, "task_creation_after_invalidate": len(after_close),
            "exceptions": [r for r in rows if r["event"] == "objc.exception"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", required=True)
    ap.add_argument("--revision", help="Use an immutable git revision instead of the working source")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--cases", nargs="+", choices=CASES, default=CASES)
    args = ap.parse_args()
    if args.repeat < 1:
        ap.error("--repeat must be positive")
    out = pathlib.Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=False)
    source = (subprocess.check_output(["git", "show", f"{args.revision}:{SOURCE}"], cwd=REPO).decode()
              if args.revision else (REPO / SOURCE).read_text())
    modified = instrument(source)
    (out / "Original.swift").write_text(source)
    (out / "Transport.swift").write_text(modified)
    (out / "instrumentation.diff").write_text("".join(difflib.unified_diff(
        source.splitlines(True), modified.splitlines(True), fromfile="product", tofile="instrumented")))
    binary = out / "Probe"
    build = subprocess.run(["xcrun", "swiftc", "-swift-version", "5", "-warnings-as-errors",
                            "-g", "-parse-as-library", str(ROOT / "Fixture.swift"),
                            str(out / "Transport.swift"), "-o", str(binary)], capture_output=True, text=True)
    (out / "build.stdout").write_text(build.stdout)
    (out / "build.stderr").write_text(build.stderr)
    if build.returncode:
        raise SystemExit("Harness build failed; inspect build.stderr")
    results = []
    for mode in args.cases:
        for iteration in range(args.repeat):
            case = out / f"{mode}-{iteration:02}"
            case.mkdir()
            result = execute(binary, case, mode)
            result["iteration"] = iteration
            results.append(result)
    summary = {"source_revision": args.revision or "working-tree",
               "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO).decode().strip(),
               "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
               "os": subprocess.check_output(["sw_vers"]).decode(),
               "swift": subprocess.check_output(["xcrun", "swiftc", "--version"], stderr=subprocess.STDOUT).decode(),
               "results": results, "passed": all(not r["failures"] for r in results)}
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({"passed": summary["passed"], "cases": len(results),
                      "failures": [{"case": r["case"], "iteration": r["iteration"],
                                    "failures": r["failures"]} for r in results if r["failures"]]}, indent=2))
    raise SystemExit(0 if summary["passed"] else 1)


if __name__ == "__main__":
    main()
