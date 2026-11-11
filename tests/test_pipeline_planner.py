import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pipeline_planner", ROOT / "mods/pipeline/planner.py")
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)

PLAN = {"summary": "A first.", "order": ["T-1"], "tasks": [{"id": "T-1", "waits": [], "reason": "Only one."}]}


def fake(folder, name, events, last=None, code=0):
    script = Path(folder) / name
    lines = "\n".join(json.dumps(event) for event in events)
    write_last = ""
    if last is not None:
        write_last = 'while [ $# -gt 0 ]; do if [ "$1" = -o ]; then printf %%s %s > "$2"; fi; shift; done\n' % json.dumps(json.dumps(last)).replace("$", "\\$")
    script.write_text("#!/bin/sh\nprintf '%%s' \"$*\" > \"%s/%s.args\"\ncat <<'EOF'\n%s\nEOF\n%sexit %d\n" % (folder, name, lines, write_last, code))
    script.chmod(0o755)


class PlannerTest(unittest.TestCase):
    def run_with(self, agent, events, last=None, code=0):
        with tempfile.TemporaryDirectory() as folder:
            folder = os.path.realpath(folder)
            events = json.loads(json.dumps(events).replace("%CWD%", folder))
            fake(folder, agent, events, last, code)
            with patch.dict(os.environ, {"PATH": folder + os.pathsep + os.environ["PATH"]}):
                result = planner.run({"agent": agent, "args": ["-p"] if agent == "claude" else ["--sandbox", "read-only"], "schema": {"type": "object"},
                                      "prompt": "Plan the queue.", "cwd": folder})
            args = (Path(folder) / (agent + ".args")).read_text()
        return result, args

    def test_claude_reads_are_noted_and_its_structured_result_is_the_plan(self):
        result, args = self.run_with("claude", [
            {"type": "system", "subtype": "init"},
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": "%CWD%/src/math.js"}}]}},
            {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": ""}, {"type": "tool_use", "name": "Grep", "input": {"pattern": "add", "path": "%CWD%/test"}}]}},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "T-1 is alone."}, {"type": "tool_use", "name": "StructuredOutput", "input": PLAN}]}},
            {"type": "result", "structured_output": PLAN, "total_cost_usd": 0.003, "usage": {"input_tokens": 10, "cache_read_input_tokens": 900, "output_tokens": 90}},
        ])
        self.assertEqual(result["plan"], PLAN)
        self.assertEqual(result["trace"], ["Reads src/math.js", "Searches for “add” in test", "Says: T-1 is alone."])
        self.assertEqual((result["cost"], result["tokens"], result["error"]), (0.003, 1000, None))
        self.assertTrue(args.startswith("-p --output-format stream-json --verbose --json-schema {\"type\": \"object\"}") and args.endswith("Plan the queue."))

    def test_codex_commands_are_noted_and_its_last_message_is_the_plan(self):
        result, args = self.run_with("codex", [
            {"type": "item.completed", "item": {"type": "reasoning", "text": "Looking at the files."}},
            {"type": "item.completed", "item": {"type": "command_execution", "command": "/bin/zsh -lc \"rg -n 'add' src\""}},
            {"type": "item.completed", "item": {"type": "agent_message", "text": json.dumps(PLAN)}},
            {"type": "turn.completed", "usage": {"input_tokens": 3000, "cached_input_tokens": 2000, "output_tokens": 100}},
        ], last=PLAN)
        self.assertEqual(result["plan"], PLAN)
        self.assertEqual(result["trace"], ["Thinks: Looking at the files.", "Runs rg -n 'add' src"])
        self.assertEqual(result["tokens"], 3100)
        self.assertTrue(args.startswith("exec --json --output-schema ") and args.endswith("--sandbox read-only Plan the queue."))

    def test_an_error_without_a_plan_keeps_what_was_seen(self):
        result, _ = self.run_with("claude", [
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Glob", "input": {"pattern": "**/*.js"}}]}},
            {"type": "result", "is_error": True, "result": "Credit balance is too low"}], code=1)
        self.assertEqual((result["plan"], result["error"], result["trace"]), (None, "Credit balance is too low", ["Lists **/*.js"]))

    def test_a_missing_agent_says_so(self):
        with patch.dict(os.environ, {"PATH": "/nonexistent"}):
            result = planner.run({"agent": "codex", "args": [], "schema": {}, "prompt": "p", "cwd": "/"})
        self.assertEqual(result["error"], "The planner needs Codex, and it isn't installed on that machine.")


if __name__ == "__main__":
    unittest.main()
