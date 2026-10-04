"""Print the Mininet package source as JSON, for the editor's IntelliSense.

scripts/build-guest.sh runs this inside the guest image, so the source the
language server reads is the source the guest runs. The arguments are only
for running it against an unpacked Mininet release instead.
"""

import glob
import json
import os
import re
import sys

package = sys.argv[1] if len(sys.argv) > 1 else '/usr/lib/python3.12/site-packages/mininet'
license_path = sys.argv[2] if len(sys.argv) > 2 else '/usr/share/licenses/mininet/LICENSE'


def read(path):
    with open(path, encoding='utf-8') as source:
        return source.read()


# Top-level modules only: the tests and examples are not part of the API.
files = {
    'mininet/' + os.path.basename(path): read(path)
    for path in sorted(glob.glob(os.path.join(package, '*.py')))
}
files['mininet/LICENSE'] = read(license_path)
version = re.search(r'^VERSION = "([^"]+)"', files['mininet/net.py'], re.M).group(1)
json.dump({'version': version, 'files': files}, sys.stdout, sort_keys=True)
sys.stdout.write('\n')
