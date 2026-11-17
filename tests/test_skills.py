import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


READER = Path(__file__).resolve().parents[1] / 'mods/skills/discover.py'
spec = importlib.util.spec_from_file_location('skills_discovery', READER)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class SkillsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.project = self.home / "project with ' spaces"
        (self.project / '.git').mkdir(parents=True)

    def write(self, relative, text):
        path = self.home / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def skill(self, relative, name='review', description='Review changes.'):
        return self.write(relative + '/SKILL.md', f'---\nname: {name}\ndescription: {description}\n---\nInstructions.\n')

    def scan(self, cwd=None, opencode=lambda cwd: None):
        inventory = reader.Inventory(self.home, self.home / '.codex', self.home / '.claude', opencode)
        # Fixture scans never read the host's managed skills.
        original = inventory.folder
        inventory.folder = lambda root, *a, **kw: None if str(root) == '/etc/codex/skills' else original(root, *a, **kw)
        return inventory.scan(str(cwd or self.project))

    def test_opencode_skills_are_the_ones_its_server_lists_for_the_folder(self):
        shared = self.skill('.claude/skills/review')
        local = self.skill("project with ' spaces/.opencode/skills/ship", 'ship', 'Ship it.')
        asked = []

        def rows(cwd):
            asked.append(cwd)
            return [{'id': 'opencode', 'name': 'OpenCode', 'description': 'About OpenCode.', 'path': 'skill://opencode/SKILL.md', 'content': '# OpenCode'},
                    {'id': 'review', 'name': 'review', 'description': 'Review changes.', 'path': str(shared)},
                    {'id': 'ship', 'name': 'ship', 'description': 'Ship it.', 'path': str(local), 'autoinvoke': False},
                    {'id': 'broken'}]

        skills = {skill['name']: skill for skill in self.scan(opencode=rows)['skills']}
        self.assertEqual(asked, [str(self.project)])
        self.assertEqual([(item['agent'], item['origin']) for item in skills['review']['installations']], [('claude', 'personal'), ('opencode', 'personal')])
        ship = skills['ship']['installations']
        self.assertEqual([(item['agent'], item['origin'], item['project'], item['command']) for item in ship], [('opencode', 'project', True, None)])
        self.assertEqual(ship[0]['note'], 'OpenCode loads it only when asked for by name.')
        self.assertEqual([skills['OpenCode']['path'], skills['OpenCode']['body'], skills['OpenCode']['installations'][0]['origin']], ['skill://opencode/SKILL.md', '# OpenCode', 'builtin'])

        def fails(cwd):
            raise ValueError('no server')
        self.assertEqual(self.scan(opencode=fails)['warnings'], ['Cannot ask OpenCode for its skills: no server'])

    def test_missing_folders_create_nothing(self):
        before = list(self.home.rglob('*'))
        result = self.scan()
        self.assertEqual(result['skills'], [])
        self.assertEqual(result['warnings'], [])
        self.assertEqual(list(self.home.rglob('*')), before)

    def test_shared_symlinks_merge_but_same_name_different_files_remain(self):
        source = self.skill('source/shared', 'shared')
        for root in ['.agents/skills', '.claude/skills']:
            directory = self.home / root
            directory.mkdir(parents=True)
            (directory / 'shared').symlink_to(source.parent, target_is_directory=True)
        self.skill('.claude/skills/other', 'shared')
        result = self.scan()['skills']
        self.assertEqual(len(result), 2)
        shared = next(item for item in result if item['path'] == str(source.resolve()))
        self.assertEqual({i['agent'] for i in shared['installations']}, {'claude', 'codex'})
        self.assertEqual({i['command'] for i in shared['installations']}, {'/shared', '$shared'})

    def test_nested_working_directory_inherits_only_up_to_repository_root(self):
        self.skill('.agents/skills/outside', 'outside')
        self.skill(str(self.project.relative_to(self.home)) + '/.agents/skills/root', 'root')
        nested = self.project / 'packages/web'
        nested.mkdir(parents=True)
        self.skill(str(nested.relative_to(self.home)) + '/.claude/skills/nested', 'nested')
        result = self.scan(nested)['skills']
        root = next(s for s in result if s['name'] == 'root')
        self.assertTrue(root['installations'][0]['project'])
        # The home skill is discovered as personal, never as a project ancestor.
        outside = next(s for s in result if s['name'] == 'outside')
        self.assertFalse(outside['installations'][0]['project'])
        self.assertIn('nested', {s['name'] for s in result})

    def test_plain_source_skill_folder_does_not_imply_project_installation(self):
        self.skill(str(self.project.relative_to(self.home)) + '/skills/authored', 'authored')
        self.assertEqual(self.scan()['skills'], [])

    def test_codex_last_matching_selector_wins_and_bundled_disable_is_respected(self):
        path = self.skill('.codex/skills/one', 'one')
        self.skill('.codex/skills/two', 'two')
        self.skill('.codex/skills/.system/builtin', 'builtin')
        self.write('.codex/config.toml', '''[[skills.config]]
name = "one"
enabled = false
[[skills.config]]
path = ''' + json.dumps(str(path)) + '''
enabled = true
[[skills.config]]
name = "two"
enabled = false
[skills.bundled]
enabled = false
''')
        result = {s['name']: s['installations'][0] for s in self.scan()['skills']}
        self.assertTrue(result['one']['enabled'])
        self.assertFalse(result['two']['enabled'])
        self.assertFalse(result['builtin']['enabled'])
        with patch.object(reader, 'tomllib', None):
            fallback = {s['name']: s['installations'][0] for s in self.scan()['skills']}
        self.assertEqual(result, fallback)

    def test_claude_plugins_use_configuration_and_project_scope(self):
        self.skill('plugin/skills/pr', 'review')
        self.skill('disabled/skills/pr', 'disabled')
        self.skill('unrelated/skills/pr', 'unrelated')
        self.write('.claude/plugins/installed_plugins.json', json.dumps({'plugins': {
            'tools@test': [{'scope': 'user', 'installPath': str(self.home / 'plugin')}],
            'disabled@test': [{'scope': 'user', 'installPath': str(self.home / 'disabled')}],
            'other@test': [{'scope': 'project', 'projectPath': '/somewhere/else', 'installPath': str(self.home / 'unrelated')}],
        }}))
        self.write('.claude/settings.json', json.dumps({'enabledPlugins': {'tools@test': True, 'disabled@test': False}}))
        result = {s['name']: s['installations'][0] for s in self.scan()['skills']}
        self.assertEqual(set(result), {'review', 'disabled'})
        self.assertEqual(result['review']['command'], '/tools:review')
        self.assertTrue(result['review']['enabled'])
        self.assertFalse(result['disabled']['enabled'])

    def test_codex_cached_plugins_need_confirmed_enablement_and_unique_version(self):
        self.skill('.codex/plugins/cache/local/tools/v1/skills/review', 'review')
        self.skill('.codex/plugins/cache/remote/cache/v1/skills/cached', 'cached')
        self.write('.codex/config.toml', '[plugins."tools@local"]\nenabled = true\n')
        result = {s['name']: s['installations'][0] for s in self.scan()['skills']}
        self.assertTrue(result['review']['enabled'])
        self.assertIsNone(result['cached']['enabled'])
        self.skill('.codex/plugins/cache/local/tools/v2/skills/review', 'review')
        result = self.scan()
        self.assertTrue(result['warnings'])
        self.assertTrue(all(s['installations'][0]['enabled'] is None for s in result['skills']))

    def test_disabled_plugin_cannot_be_enabled_by_a_skill_selector(self):
        self.skill('.codex/plugins/cache/local/tools/v1/skills/review', 'review')
        self.write('.codex/config.toml', '[plugins."tools@local"]\nenabled = false\n[[skills.config]]\nname = "review"\nenabled = true\n')
        self.assertFalse(self.scan()['skills'][0]['installations'][0]['enabled'])

    def test_legacy_commands_use_file_namespace_and_user_invocable_false_has_no_command(self):
        self.write('.claude/commands/tools/review.md', '---\nname: ignored\ndescription: Review.\n---\nRead.')
        self.write('.claude/skills/hidden/SKILL.md', '---\nname: hidden\nuser-invocable: false\n---\nRead.')
        result = {s['name']: s['installations'][0] for s in self.scan()['skills']}
        self.assertEqual(result['ignored']['command'], '/tools:review')
        self.assertIsNone(result['hidden']['command'])

    def test_multiline_metadata_and_malformed_config_are_read_without_execution(self):
        path = self.write('.agents/skills/block/SKILL.md', '''---
name: "block"
description: >-
  Review changes
  with care.
---
!`touch should-not-exist`
''')
        self.write('.claude/settings.json', '{bad json')
        before = path.read_bytes()
        result = self.scan()
        self.assertEqual(result['skills'][0]['description'], 'Review changes with care.')
        self.assertTrue(result['warnings'])
        self.assertEqual(before, path.read_bytes())
        self.assertFalse((self.home / 'should-not-exist').exists())

    def test_recursive_plugin_skill_paths_do_not_follow_cycles(self):
        self.skill('.claude/skills/nested/actual', 'actual')
        (self.home / '.claude/skills/nested/cycle').symlink_to(self.home / '.claude/skills', target_is_directory=True)
        self.assertEqual([s['name'] for s in self.scan()['skills']], ['actual'])

    def test_claude_anthropic_synced_skills_are_builtin_not_personal(self):
        self.skill('.claude/skills/chrome-browser', 'chrome-browser')
        self.skill('.claude/skills/synced/account/chrome-browser', 'chrome-browser')
        self.skill('.claude/skills/synced/account/pdf', 'pdf')
        self.write('.claude/skills/synced/account/manifest.json', json.dumps({'skills': [
            {'name': 'chrome-browser', 'source': 'anthropic-example'},
            {'name': 'pdf', 'source': 'anthropic'},
        ]}))
        skills = self.scan()['skills']
        self.assertEqual(len(skills), 3)
        synced = [s for s in skills if '/synced/' in s['path']]
        for skill in synced:
            self.assertEqual(len(skill['installations']), 1)
            item = skill['installations'][0]
            self.assertEqual(item['origin'], 'builtin')
            self.assertEqual(item['command'], '/anthropic-skills:' + skill['name'])
            self.assertIn(item['sync_source'], ('anthropic', 'anthropic-example'))
        personal = next(s for s in skills if '/synced/' not in s['path'])
        self.assertEqual(personal['installations'][0]['origin'], 'personal')
        self.assertEqual(personal['installations'][0]['command'], '/chrome-browser')

    def test_synced_plugins_and_account_skills_keep_their_actual_provenance(self):
        self.skill('.claude/skills/synced/account/report', 'report')
        self.skill('.claude/skills/synced/account/custom', 'custom')
        self.write('.claude/skills/synced/account/manifest.json', json.dumps({'skills': [
            {'name': 'report', 'source': 'plugin', 'backingPluginId': 'plugin-test'},
            {'name': 'custom', 'source': 'user'},
        ]}))
        skills = {s['name']: s['installations'][0] for s in self.scan()['skills']}
        self.assertEqual(skills['report']['origin'], 'plugin')
        self.assertEqual(skills['report']['command'], '/anthropic-skills:report')
        self.assertEqual(skills['custom']['origin'], 'synced')
        self.assertEqual(skills['custom']['sync_source'], 'user')

    def test_synced_files_missing_manifest_entries_stay_unverified_and_trash_is_ignored(self):
        self.skill('.claude/skills/synced/account/chrome-browser', 'chrome-browser')
        self.skill('.claude/skills/.trash/old/chrome-browser', 'chrome-browser')
        result = self.scan()
        self.assertEqual(len(result['skills']), 1)
        item = result['skills'][0]['installations'][0]
        self.assertEqual(item['origin'], 'synced')
        self.assertIsNone(item['enabled'])
        self.assertTrue(result['warnings'])

    def test_sync_manifest_name_is_authoritative_and_unlisted_cache_is_not_personal(self):
        self.skill('.claude/skills/synced/account/chrome-browser', 'different-frontmatter-name')
        self.skill('.claude/skills/synced/account/unlisted', 'unlisted')
        self.write('.claude/skills/synced/account/manifest.json', json.dumps({'skills': [
            {'name': 'chrome-browser', 'source': 'anthropic-example'},
            {'name': '../outside', 'source': 'anthropic'},
        ]}))
        skills = {s['name']: s['installations'][0] for s in self.scan()['skills']}
        self.assertEqual(set(skills), {'chrome-browser', 'unlisted'})
        self.assertEqual(skills['chrome-browser']['origin'], 'builtin')
        self.assertEqual(skills['unlisted']['origin'], 'synced')
        self.assertIsNone(skills['unlisted']['enabled'])


if __name__ == '__main__':
    unittest.main()
