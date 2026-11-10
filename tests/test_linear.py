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

    def test_only_read_tools_can_be_called(self):
        with self.assertRaises(reader.LinearError):
            reader.call("token", "update_issue", {})

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
