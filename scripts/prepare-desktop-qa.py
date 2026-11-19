"""Install the Xcode-provisioned QA copy without changing daily App bundles."""
import fnmatch
import hashlib
import os
import plistlib
import subprocess
import time
from pathlib import Path

client = Path(__file__).resolve().parents[2] / 'Muse-Client'
source = client / 'target/ci-desktop-qa-provision/OpenMuse.app'
destination = client / 'target/ci-desktop-qa/OpenMuseCIQA.app'
app_id = 'SDPXS943DW.com.openmuseai.office.ciqa'

def command(args):
    return subprocess.run(args, check=True, capture_output=True).stdout

profile = plistlib.loads(command(['security', 'cms', '-D', '-i', str(source / 'Contents/embedded.provisionprofile')]))
assert profile['TeamIdentifier'] == ['SDPXS943DW']
assert fnmatch.fnmatchcase(app_id, profile['Entitlements']['com.apple.application-identifier'])
entitlements = plistlib.loads(command(['codesign', '-d', '--entitlements', ':-', str(source)]))
assert entitlements['com.apple.application-identifier'] == app_id
assert entitlements['keychain-access-groups'] == [app_id]
prefix = '/tmp/muse-ci-qa-sign-cert-'
command(['codesign', '-d', '--extract-certificates=' + prefix, str(source)])
identity = hashlib.sha1(Path(prefix + '0').read_bytes()).hexdigest().upper()
assert any(hashlib.sha1(cert).hexdigest().upper() == identity for cert in profile['DeveloperCertificates'])

stage = destination.parent / f'qa-provisioned-{time.time_ns()}.app'
command(['cp', '-cR', str(source), str(stage)])
for relative in ['Contents/Resources/openmuse/dsh/node_modules', 'Contents/Resources/openmuse/dsh/node/bin/node']:
    target = stage / relative
    if target.is_symlink():
        resolved = target.resolve(strict=True)
        assert resolved.is_relative_to(client / 'target')
        target.unlink()
        command(['cp', '-cRL', str(resolved), str(target)])
info_file = stage / 'Contents/Info.plist'
info = plistlib.loads(info_file.read_bytes())
assert info['CFBundleIdentifier'] == 'com.openmuseai.office.ciqa'
info.update(CFBundleName='OpenMuseCIQA', CFBundleDisplayName='OpenMuse CI QA')
info_file.write_bytes(plistlib.dumps(info))
entitlement_file = destination.parent / 'qa-valid-provisioned-entitlements.plist'
entitlement_file.write_bytes(plistlib.dumps(entitlements))
command(['codesign', '--force', '--sign', identity, '--entitlements', str(entitlement_file), str(stage)])
command(['codesign', '--verify', '--deep', '--strict', str(stage)])

for line in command(['ps', '-axo', 'pid=,args=']).decode().splitlines():
    fields = line.strip().split(None, 1)
    if len(fields) == 2 and fields[1] == str(destination / 'Contents/MacOS/OpenMuse'):
        os.kill(int(fields[0]), 15)
        for _ in range(50):
            try:
                os.kill(int(fields[0]), 0)
            except ProcessLookupError:
                break
            time.sleep(.1)
        else:
            raise RuntimeError('QA still running; leave its current bundle intact')
backup = destination.parent / f'qa-before-valid-profile-{time.time_ns()}.app'
if destination.exists():
    destination.rename(backup)
stage.rename(destination)
print('QA installed: matching profile, original Xcode-selected certificate, app-only Keychain group and verified deep signature.')
