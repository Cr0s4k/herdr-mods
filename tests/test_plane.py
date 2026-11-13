import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import urllib.error


SOURCE = Path(__file__).resolve().parents[1] / "mods/plane/herdr-plane"
loader = importlib.machinery.SourceFileLoader("plane_adapter", str(SOURCE))
spec = importlib.util.spec_from_loader(loader.name, loader)
plane = importlib.util.module_from_spec(spec)
loader.exec_module(plane)
PROJECT = {"id": "11111111-1111-4111-8111-111111111111", "name": "Herdr Mods", "identifier": "HMOD"}
ITEM_ID = "22222222-2222-4222-8222-222222222222"
CONFIG = {"baseUrl": "https://plane.example.test", "workspace": "herdr", "apiKey": "secret-token"}


def item(**changes):
    return {"id": ITEM_ID, "name": "Capture task", "sequence_id": 12,
            "description_html": "<p>Full <strong>requirements</strong></p>",
            "state": {"name": "Review", "group": "started"}, "assignees": [], "priority": "high", **changes}


class PlaneTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        plane.private_json(self.home / "plane/credentials.json", CONFIG)
        self.environment = patch.dict(os.environ, {"PLANE_API_KEY": "", "PLANE_BASE_URL": "", "PLANE_WORKSPACE": ""})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_configuration_stays_private_and_connection_response_never_contains_key(self):
        self.assertEqual((self.home / "plane/credentials.json").stat().st_mode & 0o777, 0o600)
        connection = plane.request(self.home, {"op": "connection"})
        self.assertEqual(connection, {"baseUrl": CONFIG["baseUrl"], "workspace": "herdr", "workspaces": ["herdr"]})
        self.assertNotIn("secret-token", json.dumps(connection))
        for base in ["file:///etc/passwd", "https://user:password@example.test", "https://example.test/?token=secret"]:
            with patch.dict(os.environ, {"PLANE_BASE_URL": base}):
                with self.assertRaises(plane.PlaneError):
                    plane.configuration(self.home)

    def test_html_preserves_requirements_lists_code_and_links_without_executing_markup(self):
        source = '<h2>Acceptance</h2><ul><li>Keep <strong>all</strong> requirements</li></ul><pre><code>a &lt; b\nnext()</code></pre><a href="https://example.test/spec">Spec</a><script>secret</script><a href="javascript:alert(1)">Text</a>'
        text = plane.markdown(source)
        for expected in ["## Acceptance", "- Keep **all** requirements", "```\na < b\nnext()\n```", "[Spec](https://example.test/spec)", "Text"]:
            self.assertIn(expected, text)
        self.assertNotIn("secret", text)
        self.assertNotIn("javascript", text)

    def test_normalization_keeps_identity_workflow_and_full_description(self):
        result = plane.normalized(item(state={"name": "Cancelled", "group": "cancelled"},
            assignees=[{"id": "me", "display_name": "Sam"}]), PROJECT, CONFIG)
        self.assertEqual(result["uuid"], f"plane:{PROJECT['id']}:{ITEM_ID}")
        self.assertEqual(result["identifier"], "HMOD-12")
        self.assertEqual(result["statusType"], "canceled")
        self.assertEqual(result["assignee"], "Sam")
        self.assertIn("**requirements**", result["description"])
        self.assertTrue(result["url"].startswith(CONFIG["baseUrl"] + "/herdr/"))

    def test_procedure_order_nested_requirements_and_code_delimiters_survive_handoff(self):
        source = '<ol start="3"><li><p>Start DB</p><ul><li><p>Wait for ready</p></li></ul></li><li><p>Run migration</p></li></ol>'
        text = plane.markdown(source)
        self.assertIn("3. Start DB", text)
        self.assertIn("   - Wait for ready", text)
        self.assertIn("4. Run migration", text)
        self.assertEqual(plane.markdown('<code>a`b</code>'), '``a`b``')
        self.assertEqual(plane.markdown('<code>`wrapped`</code>'), '`` `wrapped` ``')
        self.assertEqual(plane.markdown('<pre><code>```\nexample</code></pre>'), '````\n```\nexample\n````')

    def test_search_and_assignment_filter_actual_rows_when_v1_ignores_query_parameters(self):
        records = [item(), item(id="other", name="Scheduler", assignees=[{"id": "me"}], description_html="<p>Run tomorrow</p>")]
        def call(_config, path, params=None, **_kwargs):
            if path == "users/me/":
                return {"id": "me"}
            if path.endswith("work-items/"):
                return {"results": records, "next_page_results": False}
            return PROJECT
        with patch.object(plane, "call", side_effect=call):
            for scope, query, titles in [("mine", "", ["Scheduler"]), ("unassigned", "", ["Capture task"]),
                                          ("all", "tomorrow", ["Scheduler"]), ("all", "no-such-task", [])]:
                response = plane.request(self.home, {"op": "issues", "project": PROJECT["id"], "scope": scope, "query": query})
                self.assertEqual([i["title"] for i in response["issues"]], titles)

    def test_states_list_the_project_workflow_and_issues_filter_by_state(self):
        ready = "33333333-3333-4333-8333-333333333333"
        records = [item(), item(id="other", name="Ready one", state={"id": ready, "name": "Ready", "group": "unstarted"}), item(id="third", name="Plain id", state=ready)]
        def call(_config, path, params=None, **_kwargs):
            if path.endswith("states/"):
                return {"results": [{"id": ready, "name": "Ready", "group": "unstarted"}, {"id": "x", "name": "Gone", "group": "cancelled"}, "junk"]}
            if path.endswith("work-items/"):
                return {"results": records, "next_page_results": False}
            return PROJECT
        with patch.object(plane, "call", side_effect=call):
            states = plane.request(self.home, {"op": "states", "project": PROJECT["id"]})["states"]
            self.assertEqual(states, [{"id": ready, "name": "Ready", "group": "unstarted"}, {"id": "x", "name": "Gone", "group": "canceled"}])
            response = plane.request(self.home, {"op": "issues", "project": PROJECT["id"], "state": ready})
            self.assertEqual([i["title"] for i in response["issues"]], ["Ready one", "Plain id"])
            self.assertEqual({i["stateId"] for i in response["issues"]}, {ready})

    def test_sparse_search_follows_pages_then_returns_a_bounded_continuation_without_skipping_rows(self):
        def call(_config, _path, params):
            page = int(params.get("cursor") or "0")
            return {"results": [item(name="Match" if page == 4 else "Other", sequence_id=page)],
                    "next_page_results": page < 4, "next_cursor": str(page + 1)}
        with patch.object(plane, "call", side_effect=call) as transport:
            found, cursor, more = plane.scan(CONFIG, "path", None, lambda i: i["name"] == "Match")
            self.assertEqual(found, [])
            self.assertEqual(cursor, "3")
            self.assertTrue(more)
            self.assertEqual(transport.call_count, 3)
            found, cursor, more = plane.scan(CONFIG, "path", cursor, lambda i: i["name"] == "Match")
            self.assertEqual([i["sequence_id"] for i in found], [4])
            self.assertFalse(more)

    def test_mapping_is_shared_by_subfolders_and_worktrees_and_scoped_to_connection(self):
        repo = self.home / "repo"
        repo.mkdir()
        def git(*args):
            return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)
        git("init", "-q")
        (repo / "file").write_text("base")
        (repo / "nested").mkdir()
        git("add", ".")
        git("-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "base")
        worktree = self.home / "worktree"
        git("worktree", "add", "--detach", str(worktree))
        root_key = plane.mapping_key({"context": {"cwd": str(repo)}})
        self.assertEqual(root_key, plane.mapping_key({"context": {"cwd": str(repo / "nested")}}))
        self.assertEqual(root_key, plane.mapping_key({"context": {"cwd": str(worktree)}}))
        self.assertNotEqual(root_key, plane.mapping_key({"context": {"cwd": str(repo), "on": "remote"}}))
        with patch.object(plane, "call", return_value=PROJECT):
            plane.request(self.home, {"op": "map", "project": PROJECT["id"], "context": {"cwd": str(repo)}})
        mappings = json.loads((self.home / "plane/projects.json").read_text())
        self.assertEqual(mappings[CONFIG["baseUrl"] + "/herdr"][root_key], PROJECT["id"])
        with patch.dict(os.environ, {"PLANE_WORKSPACE": "different"}):
            self.assertTrue(plane.request(self.home, {"op": "issues", "context": {"cwd": str(repo)}})["needsProject"])

    def test_each_repository_links_a_project_in_its_own_workspace(self):
        other = {"id": "33333333-3333-4333-8333-333333333333", "name": "Client site", "identifier": "SITE"}
        paths = []
        def call(config, path, params=None, **_kwargs):
            paths.append(path)
            if path.endswith("/work-items/"):
                return {"results": [item()], "next_page_results": False}
            if path.endswith("/projects/"):
                return {"results": [other], "next_page_results": False}
            return other if other["id"] in path else PROJECT
        with patch.object(plane, "call", side_effect=call):
            with self.assertRaises(plane.PlaneError):
                plane.request(self.home, {"op": "projects", "workspace": "client"})
            with self.assertRaises(plane.PlaneError):
                plane.request(self.home, {"op": "add_workspace", "workspace": "bad slug"})
            self.assertEqual(plane.request(self.home, {"op": "add_workspace", "workspace": "https://plane.example.test/client/"}), {"workspace": "client"})
            self.assertEqual(plane.request(self.home, {"op": "connection"})["workspaces"], ["herdr", "client"])
            listed = plane.request(self.home, {"op": "projects", "workspace": "client"})
            self.assertEqual(listed["projects"][0]["workspace"], "client")
            self.assertIn("workspaces/client/projects/", paths)
            plane.request(self.home, {"op": "map", "project": PROJECT["id"], "context": {"cwd": str(self.home)}})
            plane.request(self.home, {"op": "map", "project": other["id"], "workspace": "client", "context": {"cwd": str(self.home)}})
            mappings = json.loads((self.home / "plane/projects.json").read_text())
            self.assertEqual(mappings[CONFIG["baseUrl"] + "/herdr"], {})
            self.assertEqual(list(mappings[CONFIG["baseUrl"] + "/client"].values()), [other["id"]])
            listed = plane.request(self.home, {"op": "issues", "context": {"cwd": str(self.home)}})
            self.assertEqual(listed["project"]["workspace"], "client")
            self.assertTrue(listed["issues"][0]["url"].startswith(CONFIG["baseUrl"] + "/client/browse/SITE-12"))
            paths.clear()
            plane.request(self.home, {"op": "detail", "id": f"plane:{other['id']}:{ITEM_ID}"})
            self.assertTrue(all(path.startswith("workspaces/client/") for path in paths))
        with patch("builtins.input", side_effect=["", ""]), patch.object(plane.getpass, "getpass", return_value="new"), \
                patch.object(plane, "call", return_value={"results": []}):
            plane.connect(self.home)
        self.assertEqual(plane.configuration(self.home)["workspaces"], ["herdr", "client"])

    def test_capture_escapes_html_and_never_follows_a_successful_write_with_another_request(self):
        calls = []
        def call(_config, path, params=None, method="GET", body=None):
            calls.append((path, method, body))
            return item() if method == "POST" else PROJECT
        with patch.object(plane, "call", side_effect=call):
            result = plane.request(self.home, {"op": "create", "project": PROJECT["id"], "title": " New task ",
                "description": '<script>example</script>\n**literal**', "priority": "high"})
        self.assertEqual(result["identifier"], "HMOD-12")
        self.assertEqual([method for _, method, _ in calls], ["GET", "POST"])
        self.assertEqual(calls[-1][2]["name"], "New task")
        self.assertIn("&lt;script&gt;", calls[-1][2]["description_html"])
        self.assertNotIn("<script>", calls[-1][2]["description_html"])

    def test_transport_errors_are_redacted_and_unconfirmed_writes_are_distinct(self):
        for code, expected in [(401, "auth"), (403, "auth"), (429, "rate_limit"), (500, "request")]:
            error = urllib.error.HTTPError("https://secret-token", code, "secret-token", {}, None)
            with patch.object(plane.urllib.request.OpenerDirector, "open", side_effect=error):
                with self.assertRaises(plane.PlaneError) as caught:
                    plane.call(CONFIG, "users/me/")
            self.assertEqual(caught.exception.kind, expected)
            self.assertNotIn("secret-token", str(caught.exception))
        with patch.object(plane.urllib.request.OpenerDirector, "open", side_effect=TimeoutError()):
            with self.assertRaises(plane.PlaneError) as caught:
                plane.call(CONFIG, "work-items/", method="POST", body={"name": "Task"})
            self.assertEqual(caught.exception.kind, "uncertain")

    def test_connect_validates_before_replacing_existing_credentials(self):
        before = (self.home / "plane/credentials.json").read_text()
        with patch("builtins.input", side_effect=["", ""]), patch.object(plane.getpass, "getpass", return_value="invalid"), \
                patch.object(plane, "call", side_effect=plane.PlaneError("Denied", "auth")):
            with self.assertRaises(plane.PlaneError):
                plane.connect(self.home)
        self.assertEqual((self.home / "plane/credentials.json").read_text(), before)


    def test_blockers_name_each_blocking_work_item_and_whether_it_closed(self):
        other_project = {"id": "44444444-4444-4444-8444-444444444444", "name": "Platform", "identifier": "PLAT"}
        open_id, done_id, gone_id, elsewhere_id = ("55555555-5555-4555-8555-55555555555" + str(n) for n in range(4))
        items = {open_id: item(id=open_id, name="Schema", sequence_id=3, state={"name": "Todo", "group": "unstarted"}),
                 done_id: item(id=done_id, name="Old", sequence_id=4, state={"name": "Done", "group": "completed"}),
                 elsewhere_id: item(id=elsewhere_id, name="Auth", sequence_id=9, state={"name": "Cancelled", "group": "cancelled"})}
        def call(_config, path, params=None, **_kwargs):
            if path.endswith(ITEM_ID + "/relations/"):
                return {"blocked_by": [open_id, {"id": done_id}, gone_id, {"issue_id": elsewhere_id, "project_id": other_project["id"]}, "junk"], "blocking": [open_id]}
            if "/relations/" in path:
                raise plane.PlaneError("Plane could not find this workspace, project or task.", "missing")
            if "/work-items/" in path:
                found = items.get(path.rstrip("/").split("/")[-1])
                if not found:
                    raise plane.PlaneError("Plane could not find this workspace, project or task.", "missing")
                return found
            return other_project if other_project["id"] in path else PROJECT
        old = "66666666-6666-4666-8666-666666666666"
        with patch.object(plane, "call", side_effect=call):
            found = plane.request(self.home, {"op": "blockers", "ids": [f"plane:{PROJECT['id']}:{ITEM_ID}", f"plane:{PROJECT['id']}:{old}"]})["blockers"]
        rows = found[f"plane:{PROJECT['id']}:{ITEM_ID}"]
        self.assertEqual([(row["key"], row["closed"]) for row in rows], [("HMOD-3", False), ("HMOD-4", True), (None, None), ("PLAT-9", True)])
        self.assertEqual(rows[0]["uuid"], f"plane:{PROJECT['id']}:{open_id}")
        self.assertEqual(found[f"plane:{PROJECT['id']}:{old}"], [], "an instance without relations has no blockers")

    def test_state_updates_and_links_read_the_ticket_first_and_skip_what_it_already_has(self):
        ticket, done = f"plane:{PROJECT['id']}:{ITEM_ID}", "77777777-7777-4777-8777-777777777777"
        calls, links = [], [{"id": "l1", "url": "https://github.test/o/r/pull/12"}]
        def call(_config, path, params=None, method="GET", body=None):
            calls.append((path.removeprefix("workspaces/herdr/projects/" + PROJECT["id"] + "/"), method, body))
            if path.endswith("/links/") and method == "GET":
                return {"results": links, "next_page_results": False}
            return item(state=done) if path.endswith(ITEM_ID + "/") else PROJECT
        with patch.object(plane, "call", side_effect=call):
            self.assertEqual(plane.request(self.home, {"op": "update_state", "id": ticket, "state": done}), {"changed": False})
            self.assertNotIn("PATCH", [method for _, method, _ in calls])
            calls.clear()
            other = "88888888-8888-4888-8888-888888888888"
            self.assertEqual(plane.request(self.home, {"op": "update_state", "id": ticket, "state": other}), {"changed": True})
            self.assertEqual(calls[-1], (f"work-items/{ITEM_ID}/", "PATCH", {"state": other}))
            calls.clear()
            self.assertEqual(plane.request(self.home, {"op": "add_link", "id": ticket, "url": "https://github.test/o/r/pull/12/", "title": "PR #12: Fix"}), {"changed": False})
            self.assertNotIn("POST", [method for _, method, _ in calls])
            self.assertEqual(plane.request(self.home, {"op": "add_link", "id": ticket, "url": "https://github.test/o/r/pull/13", "title": "PR #13: Fix"}), {"changed": True})
            self.assertEqual(calls[-1], (f"work-items/{ITEM_ID}/links/", "POST", {"url": "https://github.test/o/r/pull/13", "title": "PR #13: Fix"}))
            for payload in [{"op": "add_link", "id": ticket, "url": "javascript:alert(1)"}, {"op": "update_state", "id": ticket, "state": "Done"},
                            {"op": "update_state", "id": "linear:x", "state": done}]:
                with self.assertRaises(plane.PlaneError):
                    plane.request(self.home, payload)

    def test_an_unconfirmed_update_is_reported_once_and_never_retried(self):
        ticket, writes = f"plane:{PROJECT['id']}:{ITEM_ID}", []
        def call(_config, path, params=None, method="GET", body=None):
            if method != "GET":
                writes.append(path)
                raise plane.PlaneError("Plane could not confirm the save. Check the task in Plane before trying again.", "uncertain")
            return item(state="99999999-9999-4999-8999-999999999999") if path.endswith(ITEM_ID + "/") else PROJECT
        with patch.object(plane, "call", side_effect=call):
            with self.assertRaises(plane.PlaneError) as caught:
                plane.request(self.home, {"op": "update_state", "id": ticket, "state": "77777777-7777-4777-8777-777777777777"})
        self.assertEqual(caught.exception.kind, "uncertain")
        self.assertEqual(len(writes), 1)
        error = urllib.error.HTTPError("https://plane.example.test", 502, "secret-token", {}, None)
        with patch.object(plane.urllib.request.OpenerDirector, "open", side_effect=error):
            with self.assertRaises(plane.PlaneError) as caught:
                plane.call(CONFIG, "work-items/x/", method="PATCH", body={"state": "x"})
        self.assertEqual(caught.exception.kind, "uncertain")


if __name__ == "__main__":
    unittest.main()
