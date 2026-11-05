// Material Icon Theme lookup (icons/ is vendored by scripts/icons.sh), shared with changes-modal.
import { image, svg } from "gpui-kit";
import { appHome, theme, readTextFile } from "herdr";

const DIR = "mods/files-modal/icons";
let map = null;
export const iconsReady = readTextFile(`${appHome()}/${DIR}/index.json`)
  .then((text) => { map = JSON.parse(text); })
  .catch(() => {});

export function light() {
  const hex = (theme().background ?? "#000000").replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

function find(table, key, isLight) {
  return (isLight && map.light[table]?.[key]) || map[table][key];
}

export function iconFor(path, { dir = false, open = false } = {}) {
  if (!map) return null;
  const name = path.split("/").pop().toLowerCase(), isLight = light();
  if (dir) return `${DIR}/${find(open ? "folderNamesExpanded" : "folderNames", name, isLight) ?? map[open ? "folderExpanded" : "folder"]}.svg`;
  let icon = find("fileNames", name, isLight);
  for (let i = name.indexOf("."); !icon && i >= 0; i = name.indexOf(".", i + 1)) icon = find("fileExtensions", name.slice(i + 1), isLight);
  return `${DIR}/${icon ?? map.file}.svg`;
}

export function fileIcon(path, options, t) {
  const found = iconFor(path, options);
  return found ? image(found).size(16).flex_none()
    : svg(`mods/files-modal/${options?.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted);
}
