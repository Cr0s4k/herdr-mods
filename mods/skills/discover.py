"""Read-only skill inventory. Runs unchanged on the selected space's machine.

Only reads manifests and configuration; never imports a skill or runs its scripts.
The inventory describes filesystem discovery, not a running agent's context.
"""
import argparse
import json
import os
from pathlib import Path
import re

try:
    import tomllib
except ImportError:  # Python 3.9/3.10 on older machines.
    tomllib = None

MAX_BYTES = 262144
MAX_SKILLS = 1500


def scalar(value):
    value = value.strip()
    if value.startswith(('"', "'")):
        try:
            return json.loads(value) if value[0] == '"' else value[1:-1].replace("''", "'")
        except (ValueError, IndexError):
            return value.strip('"\'')
    return value.split(" #", 1)[0].strip()


def frontmatter(text):
    """Read the scalar metadata we display, including YAML block descriptions."""
    lines = text.lstrip('\ufeff').splitlines()
    if not lines or lines[0].strip() != '---':
        return {}
    result = {}
    key = None
    for line in lines[1:]:
        if line.strip() in ('---', '...'):
            break
        match = re.match(r'^([\w-]+):\s*(.*)$', line)
        if match:
            key, value = match.groups()
            if key not in ('name', 'description', 'disable-model-invocation', 'user-invocable'):
                key = None
                continue
            result[key] = '' if value in ('>', '|', '>-', '|-', '>+', '|+') else scalar(value)
        elif key and line[:1].isspace():
            result[key] = (result[key] + ' ' + line.strip()).strip()
    return result


def simple_toml(text):
    """Fallback for skill selectors and plugin toggles; no general TOML evaluator."""
    result = {'plugins': {}, 'skills': {'config': []}}
    target = {}
    for line in text.splitlines():
        line = line.strip()
        if line == '[[skills.config]]':
            target = {}
            result['skills']['config'].append(target)
        elif line.startswith('[plugins.') and line.endswith(']'):
            name = scalar(line[len('[plugins.'):-1])
            target = result['plugins'].setdefault(name, {})
        elif line == '[skills.bundled]':
            target = result['skills'].setdefault('bundled', {})
        elif line.startswith('['):
            target = {}
        elif '=' in line:
            key, value = line.split('=', 1)
            value = value.split(' #', 1)[0].strip()
            target[key.strip()] = value == 'true' if value in ('true', 'false') else scalar(value)
    return result


class Inventory:
    def __init__(self, home=None, codex_home=None, claude_home=None):
        self.home = Path(home or Path.home())
        self.codex = Path(codex_home or os.environ.get('CODEX_HOME') or self.home / '.codex')
        self.claude = Path(claude_home or os.environ.get('CLAUDE_CONFIG_DIR') or self.home / '.claude')
        self.items = {}
        self.warnings = []
        self.selectors = []
        self.bundled = True
        self.count = 0

    def warn(self, message):
        if message not in self.warnings:
            self.warnings.append(message)

    def read(self, path):
        try:
            with Path(path).open('rb') as stream:
                data = stream.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                self.warn('Some manifests are too large to index completely.')
            return data[:MAX_BYTES].decode('utf-8-sig')
        except FileNotFoundError:
            return None
        except (OSError, UnicodeError) as error:
            self.warn('Cannot read {}: {}'.format(path, error))
            return None

    def config(self, path, kind='json'):
        text = self.read(path)
        if text is None:
            return {}
        try:
            value = json.loads(text) if kind == 'json' else (tomllib.loads(text) if tomllib else simple_toml(text))
            if not isinstance(value, dict):
                raise ValueError('expected an object')
            return value
        except (ValueError, TypeError) as error:
            self.warn('Cannot parse {}: {}'.format(path, error))
            return {}

    def children(self, path):
        try:
            return sorted(Path(path).iterdir(), key=lambda p: p.name.casefold())
        except FileNotFoundError:
            return []
        except OSError as error:
            self.warn('Cannot list {}: {}'.format(path, error))
            return []

    def add(self, path, agent, origin, project=False, plugin=None, enabled=True, note=None, command=None,
            sync_source=None, name_override=None):
        if self.count >= MAX_SKILLS:
            self.warn('Inventory limited to {} discovered skill installations.'.format(MAX_SKILLS))
            return
        text = self.read(path)
        if text is None:
            return
        metadata = frontmatter(text)
        name = name_override or metadata.get('name') or (path.stem if path.name != 'SKILL.md' else path.parent.name)
        if not isinstance(name, str) or not name:
            return
        if command is None:
            # Claude command-file names are folder-relative; skills use frontmatter.
            command = ('{}:'.format(plugin) if plugin else '') + name
        if not re.fullmatch(r'[\w:./-]+', command):
            command = None
            note = 'The skill name cannot be copied as an invocation.'
        elif agent == 'codex':
            command = '$' + command
        else:
            command = '/' + command
        if agent == 'claude' and metadata.get('user-invocable') == 'false':
            command = None
            note = 'Only Claude can invoke this skill.'
        if agent == 'codex':
            skill_enabled = True
            for selector in self.selectors:
                match = selector.get('name') == name
                if selector.get('path'):
                    match = str(Path(selector['path']).expanduser().resolve()) == str(path.resolve())
                if match and selector.get('enabled') is False:
                    skill_enabled = False
                elif match and selector.get('enabled') is True:
                    skill_enabled = True
            if not skill_enabled:
                enabled, note = False, 'Disabled in Codex skill configuration.'
        real = str(path.resolve())
        item = self.items.setdefault(real, {
            'id': real, 'path': real, 'name': name,
            'description': metadata.get('description', '')[:2400], 'installations': [],
        })
        installation = {
            'agent': agent, 'origin': origin, 'project': project, 'plugin': plugin,
            'path': str(path), 'command': command, 'enabled': enabled, 'note': note,
        }
        if sync_source is not None:
            installation['sync_source'] = sync_source
        if installation not in item['installations']:
            item['installations'].append(installation)
            self.count += 1

    def folder(self, root, agent, origin, project=False, plugin=None, enabled=True, note=None, recursive=False, exclude=()):
        stack = [(Path(root), 0)]
        seen = set()
        while stack and len(seen) < 5000:
            folder, depth = stack.pop()
            try:
                real = folder.resolve()
            except (OSError, RuntimeError):
                continue
            if real in seen:
                continue
            seen.add(real)
            for child in self.children(folder):
                if child.name.startswith('.') or (folder == Path(root) and child.name in exclude):
                    continue
                if not child.is_dir():
                    continue
                path = child / 'SKILL.md'
                if path.is_file():
                    self.add(path, agent, origin, project, plugin, enabled, note)
                elif recursive and depth < 12:
                    stack.append((child, depth + 1))

    def synced_claude(self):
        # The reserved synced/ tree is a download cache, not authored personal
        # skills. Its manifest carries provenance; names and paths alone do not.
        for account in self.children(self.claude / 'skills/synced'):
            if not account.is_dir() or account.name.startswith('.'):
                continue
            manifest = self.config(account / 'manifest.json')
            entries = manifest.get('skills', [])
            processed = set()
            for entry in entries if isinstance(entries, list) else []:
                if not isinstance(entry, dict):
                    continue
                name = entry.get('name')
                if not isinstance(name, str) or name in ('', '.', '..') or '/' in name or '\\' in name:
                    continue
                path = account / name / 'SKILL.md'
                source = entry.get('source')
                source = source if isinstance(source, str) else 'unknown'
                if source in ('anthropic', 'anthropic-example'):
                    origin, note = 'builtin', 'Provided by Anthropic; synced from claude.ai.'
                elif source == 'plugin':
                    origin, note = 'plugin', 'Plugin-provided skill; synced from claude.ai.'
                else:
                    origin, note = 'synced', 'Synced from claude.ai; source: {}.'.format(source)
                self.add(path, 'claude', origin, note=note, command='anthropic-skills:' + name,
                         sync_source=source, name_override=name)
                processed.add(name)
            before = self.count
            self.folder(account, 'claude', 'synced', enabled=None, recursive=True, exclude=processed,
                        note='Cached claude.ai skill; its source is not listed in the sync manifest.')
            if self.count > before:
                self.warn('Some cached claude.ai skills have no verified sync-manifest entry.')

    def commands(self, root, project=False, plugin=None, enabled=True):
        # Claude's legacy commands are still skills. Keep their invocation namespace.
        for folder, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
            for name in sorted(files):
                if name.endswith('.md'):
                    path = Path(folder) / name
                    command = path.relative_to(root).with_suffix('').as_posix().replace('/', ':')
                    if plugin:
                        command = plugin + ':' + command
                    self.add(path, 'claude', 'plugin' if plugin else 'project' if project else 'personal',
                             project, plugin, enabled, 'Legacy Claude command.', command)

    def project_dirs(self, cwd):
        if not cwd:
            return []
        root = Path(cwd).expanduser().absolute()
        if not root.is_dir():
            self.warn('The working folder is unavailable: {}'.format(root))
            return []
        dirs = []
        for directory in (root, *root.parents):
            dirs.append(directory)
            if (directory / '.git').exists():
                return list(reversed(dirs))
        return [root]

    def plugin(self, root, agent, name, enabled, project=False):
        if not root.is_dir():
            self.warn('Plugin files are unavailable: {}'.format(root))
            return
        manifest = root / 'plugin.json'
        portable = manifest.is_file()
        if not portable:
            manifest = root / ('.codex-plugin' if agent == 'codex' else '.claude-plugin') / 'plugin.json'
        metadata = self.config(manifest)
        paths = 'skills' if portable else metadata.get('skills', 'skills')
        paths = [paths] if isinstance(paths, str) else paths
        if not isinstance(paths, list):
            self.warn('Unsupported skill paths in {}'.format(manifest))
            return
        note = 'Plugin enabled in configuration; session loading unverified.' if enabled is True else (
            'Plugin disabled in configuration.' if enabled is False else 'Cached plugin; enablement could not be verified.')
        for relative in paths:
            if not isinstance(relative, str):
                continue
            folder = root / relative
            if (folder / 'SKILL.md').is_file():
                self.add(folder / 'SKILL.md', agent, 'plugin', project, name, enabled, note)
            else:
                self.folder(folder, agent, 'plugin', project, name, enabled, note, recursive=True)
        if agent == 'claude':
            self.commands(root / 'commands', project, name, enabled)

    def scan(self, cwd=None):
        dirs = self.project_dirs(cwd)
        codex_config = self.config(self.codex / 'config.toml', 'toml')
        plugins = dict(codex_config.get('plugins', {}))
        for config in [codex_config] + [self.config(d / '.codex/config.toml', 'toml') for d in dirs]:
            skills = config.get('skills', {})
            self.selectors.extend(s for s in skills.get('config', []) if isinstance(s, dict))
            self.bundled = skills.get('bundled', {}).get('enabled', self.bundled)
            plugins.update(config.get('plugins', {}))
        claude_enabled = {}
        for config_path in [self.claude / 'settings.json', self.claude / 'settings.local.json'] + [
            d / '.claude' / filename for d in dirs for filename in ('settings.json', 'settings.local.json')
        ]:
            claude_enabled.update(self.config(config_path).get('enabledPlugins', {}))

        self.folder(self.home / '.agents/skills', 'codex', 'personal')
        self.folder(self.codex / 'skills', 'codex', 'personal')
        self.folder(self.codex / 'skills/.system', 'codex', 'builtin', enabled=self.bundled)
        self.folder(self.claude / 'skills', 'claude', 'personal', recursive=True, exclude=('synced',))
        self.synced_claude()
        self.commands(self.claude / 'commands')
        if os.name != 'nt':
            self.folder(Path('/etc/codex/skills'), 'codex', 'admin')
        for directory in dirs:
            self.folder(directory / '.agents/skills', 'codex', 'project', project=True)
            self.folder(directory / '.codex/skills', 'codex', 'project', project=True)
            self.folder(directory / '.claude/skills', 'claude', 'project', project=True)
            self.commands(directory / '.claude/commands', project=True)

        registry = self.config(self.claude / 'plugins/installed_plugins.json').get('plugins', {})
        for key, versions in registry.items():
            if not isinstance(versions, list):
                continue
            for version in versions:
                if not isinstance(version, dict) or not version.get('installPath'):
                    continue
                project = version.get('scope') in ('project', 'local')
                if project and not any(str(d) == version.get('projectPath') for d in dirs):
                    continue
                self.plugin(Path(version['installPath']), 'claude', key.split('@')[0], claude_enabled.get(key), project)

        # Codex does not expose a stable local install registry. Only config-confirmed
        # cache entries qualify for Available here; other cached copies stay in Library.
        for marketplace in self.children(self.codex / 'plugins/cache'):
            if not marketplace.is_dir():
                continue
            for package in self.children(marketplace):
                if not package.is_dir():
                    continue
                versions = [p for p in self.children(package) if p.is_dir()]
                if not versions:
                    continue
                key = '{}@{}'.format(package.name, marketplace.name)
                config = plugins.get(key, {})
                enabled = config.get('enabled') if isinstance(config, dict) else None
                if len(versions) > 1:
                    enabled = None
                    self.warn('Multiple cached versions of {}; session selection is unverified.'.format(package.name))
                for version in versions:
                    self.plugin(version, 'codex', package.name, enabled)
        return {'skills': sorted(self.items.values(), key=lambda item: (item['name'].casefold(), item['path'])),
                'warnings': self.warnings, 'home': str(self.home), 'cwd': cwd}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cwd')
    args = parser.parse_args()
    try:
        print(json.dumps(Inventory().scan(args.cwd), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': 'Cannot discover skills: {}'.format(error)}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
