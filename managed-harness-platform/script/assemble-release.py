"""Assemble an explicit allowlist of distributable files; never copy the private lab tree."""
from pathlib import Path
import hashlib,json,shutil,subprocess,zipfile,re,uuid

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text())['version']
release=root/'release'
release.mkdir(exist_ok=True)
if release.is_symlink() or release.resolve().parent!=root.resolve():raise RuntimeError('Unsafe release directory')
final=release/('ManagedOpenCode-'+version)
out=release/('.staging-'+uuid.uuid4().hex)
out.mkdir()
delivered=set()
fork=root.parent/'managed-opencode-fork'
def digest(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def copy(src,dst):
    dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
    delivered.add(dst.relative_to(out).as_posix())
for name in ['ManagedOpenCode-Setup.exe','ManagedOpenCode-Client.msi','ManagedOpenCode-Server.msi']:
    copy(root/'dist/Setup'/name,out/name)
for name in ['README.md','LICENSE','VERIFICATION.md','RELEASE-NOTES.md','THIRD-PARTY-NOTICES.md']:
    if (root/name).exists():copy(root/name,out/name)
for folder in ['docs','deployment']:
    for p in (root/folder).rglob('*'):
        if p.is_file():copy(p,out/folder/p.relative_to(root/folder))
evidence=['aksb-native-client-gui-raw.json','central-smtp-setup.json','central-smtp-settings.png','aksb-client-msi.json','server2022-msi.json','aksb-release-014.json','server2022-release-014.json','server2019-clean-install-014.json','server2019-functional-014.json','server2019-restart-014.json','server2019-restart-identity-014.json','installer-acl-014.json','server2022-release-013-first-attempt.json','aksb-release-013.json','server2022-release-013.json','server2019-release-013.json','server2019-functional-013.json','aksb-final-exe.json','server2022-final-exe.json','server2019-clean-install.json','server2019-functional.json','server2019-restart.json','final-lab-cleanup.json','aksb-native-client-gui.json','aksb-final-installed-hashes.json','aksb-native-client-gui.png','native-authentication.log','server2022-partial-rollback.json','aksb-upgrade.json','server2022-upgrade.json','aksb-central-engine.json','aksb-central-controls.json','aksb-alternate-port.json','aksb-native-engine-job.json','aksb-central-connectors.json','connector-gui.json','connector-personal-gui.json','platform-final-tests.log','independent-release-review.md']
for name in evidence:
    p=root/'test-results'/name
    if p.exists():copy(p,out/'validation'/name)
hashes={}
for role in ['Client','Server','Setup']:
    for p in (root/'dist'/role).glob('*.exe'):hashes[role+'/'+p.name]=digest(p)
for p in (root/'packaging').glob('*.ps1'):hashes['Setup/'+p.name]=digest(p)
(out/'ALLOWLIST-SHA256.json').write_text(json.dumps(hashes,indent=2)+'\n')
delivered.add('ALLOWLIST-SHA256.json')

# The inventory deliberately includes build dependencies; it is not an exact runtime SBOM.
inventory={}
with zipfile.ZipFile(out/'DEPENDENCY-LICENSES.zip','w',zipfile.ZIP_DEFLATED) as z:
    for base in [root,fork]:
        nm=base/'node_modules'
        paths=list(nm.glob('*/package.json'))+list(nm.glob('@*/*/package.json'))+list(nm.glob('.bun/*/node_modules/*/package.json'))+list(nm.glob('.bun/*/node_modules/@*/*/package.json'))
        for manifest in paths:
            try:pkg=json.loads(manifest.read_text(encoding='utf-8'))
            except (ValueError,OSError):continue
            if not pkg.get('name') or not pkg.get('version'):continue
            key=pkg['name']+'@'+pkg['version']
            if key in inventory:continue
            files=[p for p in manifest.parent.iterdir() if p.is_file() and p.name.lower().startswith(('license','licence','copying','notice'))]
            archive=re.sub(r'[^a-zA-Z0-9@._-]','_',key)
            record={k:pkg.get(k) for k in ['name','version','license','repository']}
            record['noticeFiles']=[archive+'/'+p.name for p in files]
            inventory[key]=record
            z.writestr(archive+'/package-metadata.json',json.dumps(record,indent=2))
            for p in files:z.write(p,archive+'/'+p.name)
    z.write(fork/'LICENSE','OpenCode-LICENSE')
    for name in ['bun-LICENSE.md','wix-LICENSE.txt']:z.write(root/'release-input'/name,name)
    z.writestr('inventory.json',json.dumps(list(inventory.values()),indent=2))
delivered.add('DEPENDENCY-LICENSES.zip')

source=root/'release'/('ManagedOpenCode-'+version+'-source.zip')
with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED,compresslevel=5) as z:
    for folder in ['src','native','packaging','script','test','docs','deployment']:
        for p in (root/folder).rglob('*'):
            if p.is_file() and not any(x in {'bin','obj','__pycache__'} for x in p.relative_to(root/folder).parts):z.write(p,'managed-harness-platform/'+p.relative_to(root).as_posix())
    for name in ['package.json','bun.lock','tsconfig.json','README.md','LICENSE','VERIFICATION.md','RELEASE-NOTES.md','THIRD-PARTY-NOTICES.md']:
        if (root/name).exists():z.write(root/name,'managed-harness-platform/'+name)
    paths=subprocess.check_output(['git','ls-files','-z'],cwd=fork).decode().split('\0')
    additions=subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z','packages/core/src','packages/core/test','packages/server/src','packages/server/test'],cwd=fork).decode().split('\0')
    for name in sorted(set(paths+additions)):
        p=fork/name
        if name and p.is_file():z.write(p,'managed-opencode-fork/'+name)
    z.writestr('UPSTREAM-REVISION.txt',subprocess.check_output(['git','rev-parse','HEAD'],cwd=fork).decode())
    for name in ['wix-5.0.2-source.zip','bun-1.4.4-source.zip']:z.write(root/'release-input'/name,'third-party-source/'+name)
manifest={name:digest(out/name) for name in delivered}
(out/'SHA256SUMS.txt').write_text(''.join(h+'  '+p+'\n' for p,h in sorted(manifest.items())))
delivered.add('SHA256SUMS.txt')
# Preserve previous output rather than deleting anything somebody might have placed there.
# Verify both resolved move targets are direct children of this workspace's release folder.
prior=release/('.previous-'+uuid.uuid4().hex)
for p in [out,final,prior]:
    if p.is_symlink() or p.resolve().parent!=release.resolve():raise RuntimeError('Unsafe release move target')
if final.exists():final.rename(prior)
out.rename(final)
out=final
bundle=root/'release'/('ManagedOpenCode-'+version+'-deployment.zip')
with zipfile.ZipFile(bundle,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
    for name in sorted(delivered):z.write(out/name,name)
(root/'release'/'SHA256SUMS.txt').write_text(''.join(digest(p)+'  '+p.name+'\n' for p in [bundle,source]))
print(json.dumps({'deployment':str(bundle),'source':str(source),'packagesWithMetadata':len(inventory),'packagesWithoutNoticeFile':sum(not r['noticeFiles'] for r in inventory.values())},indent=2))
