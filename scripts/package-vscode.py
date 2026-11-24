#!/usr/bin/env python3
"""Package the built-in-only extension and skill, with no npm dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json, subprocess
root = Path(__file__).resolve().parent.parent
subprocess.run(['node', 'scripts/check.mjs'], cwd=root, check=True)
for example in sorted((root / 'skills/motion-explainer/examples').iterdir()):
    if example.is_dir():
        subprocess.run(['node', 'skills/motion-explainer/scripts/build.mjs', str(example), '--offline', '--strict', '--portable'], cwd=root, check=True)
manifest = json.loads((root / 'vscode/package.json').read_text())
out = root / 'vscode/output/motion-explainer.vsix'
out.parent.mkdir(exist_ok=True)
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    content_types = ''.join(f'<Default Extension="{extension}" ContentType="{mime}"/>' for extension, mime in [('json','application/json'),('cjs','application/javascript'),('mjs','application/javascript'),('html','text/html'),('svg','image/svg+xml'),('md','text/markdown'),('kymo','text/plain'),('txt','text/plain'),('vsixmanifest','text/xml')])
    archive.writestr('[Content_Types].xml', f'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">{content_types}</Types>')
    archive.writestr('extension.vsixmanifest', f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="{manifest['name']}" Version="{manifest['version']}" Publisher="{manifest['publisher']}"/><DisplayName>Motion Explainer</DisplayName><Description xml:space="preserve">Animated code walkthroughs in VS Code.</Description><License>extension/LICENSE</License><Tags>visualization,education</Tags><Categories>Other</Categories><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{manifest['engines']['vscode']}"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>''')
    for relative in ['package.json','extension.cjs','runtime.mjs','README.md','resources/motion.svg']:
        archive.write(root / 'vscode' / relative, 'extension/' + relative)
    archive.write(root / 'LICENSE', 'extension/LICENSE')
    archive.write(root / 'AUTHORS.md', 'extension/AUTHORS.md')
    for file in sorted((root / 'skills/motion-explainer').rglob('*')):
        if file.is_file(): archive.write(file, 'extension/skill/' + file.relative_to(root / 'skills/motion-explainer').as_posix())
with ZipFile(out) as archive:
    for name in archive.namelist():
        if str(root).encode() in archive.read(name):
            out.unlink()
            raise RuntimeError(f'Build-machine path leaked into package entry: {name}')
print(out)
