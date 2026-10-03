// File icons come from vscode-icons: https://github.com/vscode-icons/vscode-icons
// A subset of its SVGs is vendored, unmodified, in src/assets/file-icons; see
// the README there for the license and how to add more.
import { LinkIcon } from 'lucide-react';
import { cn } from 'cn';

// Kept out of the bundle so that only the icons on screen are fetched.
const ICON_URLS = import.meta.glob<string>('../assets/file-icons/*.svg', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

function iconUrl(file: string): string | undefined {
  return ICON_URLS[`../assets/file-icons/${file}.svg`];
}

const DEFAULT_ICON = iconUrl('default_file')!;

/** vscode-icons name to the extensions it covers, without the leading dot. */
const EXTENSIONS_BY_ICON: Record<string, string[]> = {
  python: ['py', 'pyw', 'pyi', 'pyx', 'pxd', 'pyc', 'pyo'],
  shell: ['sh', 'bash', 'zsh', 'fish', 'ksh', 'csh', 'tcsh', 'command'],
  powershell: ['ps1', 'psm1', 'psd1'],
  bat: ['bat', 'cmd'],
  text: ['txt', 'text'],
  markdown: ['md', 'markdown', 'mdown', 'mkd'],
  rest: ['rst'],
  asciidoc: ['adoc', 'asciidoc'],
  org: ['org'],
  tex: ['tex', 'sty', 'cls', 'bib', 'ltx'],
  log: ['log', 'out', 'err'],
  json: ['json', 'jsonc', 'jsonl', 'ndjson', 'geojson'],
  json5: ['json5'],
  yaml: ['yml', 'yaml'],
  toml: ['toml'],
  ini: ['ini'],
  config: ['cfg', 'conf', 'cnf', 'config', 'properties', 'rc', 'plist'],
  dotenv: ['env'],
  xml: ['xml', 'xsd', 'xsl', 'xslt', 'dtd'],
  html: ['html', 'htm', 'xhtml'],
  css: ['css'],
  scss: ['scss', 'sass'],
  less: ['less'],
  js: ['js', 'mjs', 'cjs'],
  typescript: ['ts', 'mts', 'cts'],
  typescriptdef: ['d.ts', 'd.mts', 'd.cts'],
  reactjs: ['jsx'],
  reactts: ['tsx'],
  vue: ['vue'],
  svelte: ['svelte'],
  c: ['c'],
  cheader: ['h'],
  cpp: ['cpp', 'cc', 'cxx', 'c++'],
  cppheader: ['hpp', 'hh', 'hxx', 'h++'],
  csharp: ['cs', 'csx'],
  go: ['go'],
  rust: ['rs'],
  java: ['java'],
  jar: ['jar', 'war'],
  class: ['class'],
  kotlin: ['kt', 'kts'],
  scala: ['scala', 'sc'],
  groovy: ['groovy', 'gvy'],
  swift: ['swift'],
  objectivec: ['m', 'mm'],
  lua: ['lua'],
  perl: ['pl', 'pm', 'pod', 't'],
  ruby: ['rb', 'erb', 'gemspec', 'rake'],
  php: ['php', 'phtml'],
  r: ['r', 'rmd'],
  julia: ['jl'],
  haskell: ['hs', 'lhs'],
  erlang: ['erl', 'hrl'],
  elixir: ['ex', 'exs'],
  clojure: ['clj', 'cljs', 'cljc', 'edn'],
  ocaml: ['ml', 'mli'],
  lisp: ['lisp', 'lsp', 'el', 'scm', 'ss', 'rkt'],
  prolog: ['pro'],
  fortran: ['f', 'f77', 'f90', 'f95', 'f03', 'for'],
  matlab: ['mat', 'mlx'],
  dartlang: ['dart'],
  zig: ['zig'],
  nim: ['nim', 'nims'],
  assembly: ['asm', 's'],
  verilog: ['v', 'vh'],
  systemverilog: ['sv', 'svh'],
  vhdl: ['vhd', 'vhdl'],
  tcl: ['tcl', 'tk'],
  awk: ['awk'],
  vim: ['vim'],
  gnu: ['mk', 'mak', 'am', 'm4', 'ld'],
  cmake: ['cmake'],
  ninja: ['ninja'],
  bazel: ['bzl', 'bazel'],
  nix: ['nix'],
  docker: ['dockerfile'],
  terraform: ['tf', 'tfvars', 'hcl'],
  nginx: ['nginx'],
  systemd: [
    'service',
    'socket',
    'timer',
    'target',
    'mount',
    'network',
    'netdev',
    'link',
  ],
  diff: ['diff'],
  patch: ['patch'],
  sql: ['sql'],
  sqlite: ['sqlite', 'sqlite3', 'db3'],
  db: ['db'],
  csv: ['csv', 'tsv'],
  protobuf: ['proto'],
  graphql: ['graphql', 'gql'],
  wasm: ['wasm', 'wat'],
  jinja: ['j2', 'jinja', 'jinja2'],
  jupyter: ['ipynb'],
  graphviz: ['dot', 'gv'],
  gnuplot: ['gp', 'gnuplot', 'gnu', 'plt'],
  mermaid: ['mmd', 'mermaid'],
  plantuml: ['puml', 'plantuml', 'pu'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tif', 'tiff'],
  svg: ['svg'],
  pdf: ['pdf'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
  video: ['mp4', 'mkv', 'webm', 'avi', 'mov'],
  font: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
  zip: ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar'],
  // Packet captures have no icon of their own upstream.
  binary: ['bin', 'o', 'a', 'so', 'ko', 'elf', 'exe', 'dll', 'pcap', 'pcapng'],
  debian: ['deb'],
  bak: ['bak', 'backup', 'orig', 'swp'],
  cert: ['crt', 'cer', 'csr', 'der', 'p12', 'pfx'],
  key: ['key', 'pem', 'pub'],
  gpg: ['gpg', 'asc', 'sig'],
  license: ['license', 'lic'],
  todo: ['todo'],
  excel: ['xls', 'xlsx', 'ods'],
  word: ['doc', 'docx', 'odt', 'rtf'],
  powerpoint: ['ppt', 'pptx', 'odp'],
};

/** vscode-icons name to the whole file names it covers, in lower case. */
const FILENAMES_BY_ICON: Record<string, string[]> = {
  shell: [
    '.bashrc',
    '.bash_profile',
    '.bash_aliases',
    '.bash_history',
    '.bash_logout',
    '.profile',
    '.zshrc',
    '.zprofile',
    '.zshenv',
    '.inputrc',
  ],
  gnu: ['makefile', 'gnumakefile'],
  cmake: ['cmakelists.txt'],
  meson: ['meson.build', 'meson_options.txt'],
  ninja: ['build.ninja'],
  docker: [
    'dockerfile',
    'containerfile',
    '.dockerignore',
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
  ],
  vagrant: ['vagrantfile'],
  ansible: ['ansible.cfg', 'playbook.yml', 'playbook.yaml'],
  nginx: ['nginx.conf'],
  apache: ['.htaccess', 'httpd.conf', 'apache2.conf'],
  tmux: ['.tmux.conf', 'tmux.conf'],
  vim: ['.vimrc', '.viminfo', '.gvimrc', 'vimrc'],
  git: [
    '.gitignore',
    '.gitattributes',
    '.gitconfig',
    '.gitmodules',
    '.gitkeep',
    '.mailmap',
  ],
  editorconfig: ['.editorconfig'],
  dotenv: ['.env'],
  pip: ['requirements.txt', 'constraints.txt', 'pipfile', 'pipfile.lock'],
  poetry: ['poetry.lock'],
  pytest: ['pytest.ini', 'conftest.py'],
  python: ['.python-version', '.pythonrc', 'setup.py', 'setup.cfg'],
  ruby: ['gemfile', 'rakefile'],
  npm: ['package.json', 'package-lock.json', '.npmrc', '.npmignore'],
  yarn: ['yarn.lock', '.yarnrc', '.yarnrc.yml'],
  node: ['.nvmrc', '.node-version'],
  config: ['.tool-versions', '.wgetrc', '.curlrc', '.screenrc', '.nanorc'],
  key: ['id_rsa', 'id_ed25519', 'id_ecdsa', 'authorized_keys', 'known_hosts'],
  license: ['license', 'licence', 'copying', 'unlicense', 'notice'],
  markdown: ['readme', 'changelog', 'authors', 'contributing'],
  todo: ['todo'],
};

function invert(namesByIcon: Record<string, string[]>): Map<string, string> {
  const iconByName = new Map<string, string>();
  for (const [icon, names] of Object.entries(namesByIcon))
    for (const name of names) iconByName.set(name, icon);
  return iconByName;
}

const ICON_BY_EXTENSION = invert(EXTENSIONS_BY_ICON);
const ICON_BY_FILENAME = invert(FILENAMES_BY_ICON);

/** The vscode-icons name for a file, or undefined when nothing matches. */
function iconFor(fileName: string): string | undefined {
  const name = fileName.toLowerCase();
  const byName = ICON_BY_FILENAME.get(name);
  if (byName) return byName;
  // Longest extension first, so `types.d.ts` beats `.ts`; a leading dot marks
  // a hidden file, not an extension.
  for (
    let dot = name.indexOf('.', 1);
    dot !== -1;
    dot = name.indexOf('.', dot + 1)
  ) {
    const byExtension = ICON_BY_EXTENSION.get(name.slice(dot + 1));
    if (byExtension) return byExtension;
  }
  // `.env.local` and the like.
  if (name.startsWith('.env.')) return 'dotenv';
  return undefined;
}

interface FileTypeIconProps {
  /** File name, without its directory. */
  name: string;
  symlink?: boolean;
  className?: string;
}

/** The vscode-icons icon for a file; unknown types get the default file icon. */
export function FileTypeIcon({
  name,
  symlink = false,
  className,
}: FileTypeIconProps) {
  if (symlink) return <LinkIcon aria-hidden className={className} />;
  const icon = iconFor(name);
  const dark = (icon && iconUrl(`file_type_${icon}`)) ?? DEFAULT_ICON;
  // Some icons are too pale for a light surface and ship a darker twin.
  const light = icon && iconUrl(`file_type_light_${icon}`);
  const image = (src: string, extra?: string) => (
    <img
      aria-hidden
      alt=""
      src={src}
      draggable={false}
      className={cn(className, extra)}
    />
  );
  if (!light) return image(dark);
  return (
    <>
      {image(light, 'dark:hidden')}
      {image(dark, 'hidden dark:block')}
    </>
  );
}
