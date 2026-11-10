import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error


SOURCE = Path(__file__).resolve().parents[1] / "mods/linear/herdr-linear"
loader = importlib.machinery.SourceFileLoader("linear_reader", str(SOURCE))
spec = importlib.util.spec_from_loader(loader.name, loader)
reader = importlib.util.module_from_spec(spec)
loader.exec_module(reader)


class LinearTest(unittest.TestCase):
    def test_json_and_streamable_http_responses(self):
        response = {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": '{"issues":[]}'}]}}
        self.assertEqual(reader.parse_rpc(json.dumps(response)), {"issues": []})
        stream = 'event: message\r\ndata: {"jsonrpc":"2.0","method":"progress"}\r\n\r\n'
        stream += "event: message\r\ndata: " + json.dumps(response) + "\r\n\r\n"
        self.assertEqual(reader.parse_rpc(stream), {"issues": []})

    def test_errors_never_echo_transport_or_credentials(self):
        for response in [{"error": {"message": "secret-token"}}, {"result": {"isError": True, "content": [{"text": "secret-token"}]}}]:
            with self.assertRaises(reader.LinearError) as caught:
                reader.parse_rpc(json.dumps(response))
            self.assertNotIn("secret-token", str(caught.exception))
        for status, kind in [(401, "auth"), (403, "auth"), (429, "rate_limit"), (500, "request")]:
            with patch.object(reader.urllib.request, "urlopen", side_effect=urllib.error.HTTPError(reader.ENDPOINT, status, "secret-token", {}, None)):
                with self.assertRaises(reader.LinearError) as caught:
                    reader.call("secret-token", "list_issues", {})
            self.assertEqual(caught.exception.kind, kind)
            self.assertNotIn("secret-token", str(caught.exception))

    def test_server_search_scope_project_and_pagination(self):
        with patch.object(reader, "credential", return_value=("secret-token", "test")), patch.object(reader, "call", return_value={"issues": []}) as call:
            result = reader.request("/app", {"scope": "unassigned", "query": "search text", "project": "project-id", "cursor": "next"})
            args = call.call_args.args[2]
            self.assertEqual(args["assignee"], "null")
            self.assertEqual(args["query"], "search text")
            self.assertEqual(args["project"], "project-id")
            self.assertEqual(args["cursor"], "next")
            self.assertNotIn("secret-token", json.dumps(result))
            reader.request("/app", {"scope": "mine"})
            self.assertEqual(call.call_args.args[2]["assignee"], "me")
            reader.request("/app", {"scope": "all"})
            self.assertNotIn("assignee", call.call_args.args[2])

    def test_open_tickets_details_and_states_merge_team_workflows_by_name(self):
        with patch.object(reader, "credential", return_value=("secret-token", "test")), patch.object(reader, "call", side_effect=lambda _t, _n, args: {"id": args["id"], "title": "T"} if args["id"] != "gone" else {}) as call:
            data = reader.request("/app", {"op": "details", "ids": ["A-1", "gone", ""] + [f"B-{n}" for n in range(20)]})["data"]
            self.assertEqual([issue["id"] for issue in data["issues"]][:2], ["A-1", "B-0"])
            self.assertEqual(call.call_count, 10)
            self.assertEqual({c.args[1] for c in call.call_args_list}, {"get_issue"})
            self.assertTrue(all(c.args[2]["includeRelations"] for c in call.call_args_list), "blockers come with the details")
        pages = {"started": [{"id": "A-1", "uuid": "1"}], "unstarted": [{"id": "A-2", "uuid": "2"}, {"id": "A-1", "uuid": "1"}], "backlog": []}
        with patch.object(reader, "credential", return_value=("secret-token", "test")), patch.object(reader, "call", side_effect=lambda _t, _n, args: {"issues": pages[args["state"]]}) as call:
            data = reader.request("/app", {"scope": "mine", "open": True, "state": "ignored"})["data"]
            self.assertEqual([issue["id"] for issue in data["issues"]], ["A-1", "A-2"])
            self.assertEqual([c.args[2]["state"] for c in call.call_args_list], ["started", "unstarted", "backlog"])
        teams = {"Core": [{"id": "a", "type": "unstarted", "name": "Todo"}, {"id": "b", "type": "started", "name": "In Progress"}],
                 "Web": [{"id": "c", "type": "unstarted", "name": "Todo"}, {"id": "d", "type": "unstarted", "name": "Ready for agent"}, "junk"]}
        with patch.object(reader, "credential", return_value=("secret-token", "test")), patch.object(reader, "call", side_effect=lambda _t, name, args: teams[args["team"]]) as call:
            states = reader.request("/app", {"op": "states", "teams": ["Core", "Web", ""]})["data"]["states"]
            self.assertEqual([(state["id"], state["type"]) for state in states], [("Todo", "unstarted"), ("In Progress", "started"), ("Ready for agent", "unstarted")])
            self.assertEqual({c.args[1] for c in call.call_args_list}, {"list_issue_statuses"})

    def test_only_read_tools_and_the_two_allowed_writes_can_be_called(self):
        for name, args in [("update_issue", {}), ("save_issue", {"id": "A-1", "title": "x"}), ("save_issue", {"id": "A-1", "state": "Done", "assignee": "me"}),
                           ("save_issue", {"title": "new", "team": "Core"}), ("save_comment", {"issueId": "A-1", "body": "x"}), ("create_attachment", {"issue": "A-1"}),
                           ("delete_attachment", {"id": "x"})]:
            with patch.object(reader.urllib.request, "urlopen") as urlopen:
                with self.assertRaises(reader.LinearError):
                    reader.call("token", name, args)
                urlopen.assert_not_called()
        reply = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"structuredContent": {"id": "A-1"}}}).encode()
        for args in [{"id": "A-1", "state": "Done"}, {"id": "A-1", "links": [{"url": "https://x.test", "title": "x"}]}]:
            with patch.object(reader.urllib.request, "urlopen") as urlopen:
                urlopen.return_value.__enter__.return_value.read.return_value = reply
                self.assertEqual(reader.call("token", "save_issue", args), {"id": "A-1"})

    def test_state_updates_and_links_read_the_ticket_first_and_skip_what_it_already_has(self):
        issue = {"id": "u-1", "status": {"name": "In Progress"}, "attachments": [{"url": "https://github.test/o/r/pull/12", "title": "PR #12: Fix"}]}
        def call(_token, name, args):
            calls.append((name, args))
            return issue if name == "get_issue" else {"id": "u-1"}
        with patch.object(reader, "credential", return_value=("secret-token", "test")) as credential, patch.object(reader, "call", side_effect=call):
            calls = []
            self.assertEqual(reader.request("/app", {"op": "update_state", "id": "u-1", "state": "in progress"})["data"], {"changed": False})
            self.assertEqual([name for name, _ in calls], ["get_issue"])
            self.assertTrue(credential.call_args.args[1], "writes ask for a credential that can write")
            calls = []
            self.assertEqual(reader.request("/app", {"op": "update_state", "id": "u-1", "state": "Done"})["data"], {"changed": True})
            self.assertEqual(calls[-1], ("save_issue", {"id": "u-1", "state": "Done"}))
            calls = []
            self.assertEqual(reader.request("/app", {"op": "add_link", "id": "u-1", "url": "https://github.test/o/r/pull/12/", "title": "PR #12: Fix"})["data"], {"changed": False})
            self.assertEqual([name for name, _ in calls], ["get_issue"])
            self.assertEqual(reader.request("/app", {"op": "add_link", "id": "u-1", "url": "https://github.test/o/r/pull/13", "title": "PR #13: Fix"})["data"], {"changed": True})
            self.assertEqual(calls[-1], ("save_issue", {"id": "u-1", "links": [{"url": "https://github.test/o/r/pull/13", "title": "PR #13: Fix"}]}))
            for payload in [{"op": "add_link", "id": "u-1", "url": "file:///etc/passwd"}, {"op": "update_state", "id": "u-1", "state": ""}]:
                with self.assertRaises(reader.LinearError):
                    reader.request("/app", payload)

    def test_a_connection_without_write_access_says_so_and_unconfirmed_writes_are_distinct(self):
        denied = {"jsonrpc": "2.0", "id": 1, "result": {"isError": True, "content": [{"type": "text", "text": "Invalid scope: write required secret-token"}]}}
        with self.assertRaises(reader.LinearError) as caught:
            reader.parse_rpc(json.dumps(denied), write=True)
        self.assertEqual((caught.exception.kind, str(caught.exception)), ("write_access", reader.WRITE_ACCESS))
        with self.assertRaises(reader.LinearError) as caught:
            reader.parse_rpc(json.dumps(denied))
        self.assertNotEqual(caught.exception.kind, "write_access", "reads keep their own message")
        refused = {"jsonrpc": "2.0", "id": 1, "result": {"isError": True, "content": [{"type": "text", "text": "State not found secret-token"}]}}
        with self.assertRaises(reader.LinearError) as caught:
            reader.parse_rpc(json.dumps(refused), write=True)
        self.assertEqual(caught.exception.kind, "request")
        self.assertNotIn("secret-token", str(caught.exception))
        args = {"id": "A-1", "state": "Done"}
        for error, kind in [(urllib.error.HTTPError(reader.ENDPOINT, 403, "x", {}, None), "write_access"), (urllib.error.HTTPError(reader.ENDPOINT, 502, "x", {}, None), "uncertain"), (TimeoutError(), "uncertain")]:
            with patch.object(reader.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(reader.LinearError) as caught:
                    reader.call("token", "save_issue", args)
            self.assertEqual(caught.exception.kind, kind)
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / ".credentials.json").write_text(json.dumps({"mcpOAuth": {"linear": {"serverUrl": reader.ENDPOINT + "/readonly", "accessToken": "read-token"}}}))
            with patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": folder, "LINEAR_API_KEY": ""}), patch.object(reader.sys, "platform", "linux"):
                self.assertEqual(reader.credential(folder), ("read-token", "Claude login"))
                with self.assertRaises(reader.LinearError) as caught:
                    reader.credential(folder, write=True)
            self.assertEqual(caught.exception.kind, "write_access")

    def test_existing_claude_login_is_read_without_modification(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".credentials.json"
            contents = json.dumps({"mcpOAuth": {"linear": {"serverUrl": reader.ENDPOINT, "accessToken": "secret-token"}}})
            path.write_text(contents)
            with patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": folder, "LINEAR_API_KEY": ""}), patch.object(reader.sys, "platform", "linux"):
                self.assertEqual(reader.credential(folder), ("secret-token", "Claude login"))
            self.assertEqual(path.read_text(), contents)

    def test_connect_validates_then_saves_private_key_atomically(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(reader.getpass, "getpass", return_value="new-key"), patch.object(reader, "call", return_value={"id": "me"}), patch("builtins.input", return_value=""), patch("builtins.print"):
                reader.connect(folder)
            path = Path(folder) / "linear/credentials.json"
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), {"apiKey": "new-key"})
            before = path.read_text()
            with patch.object(reader.getpass, "getpass", return_value="invalid"), patch.object(reader, "call", side_effect=reader.LinearError("Invalid")), patch("builtins.print"):
                with self.assertRaises(reader.LinearError):
                    reader.connect(folder)
            self.assertEqual(path.read_text(), before)


if __name__ == "__main__":
    unittest.main()
