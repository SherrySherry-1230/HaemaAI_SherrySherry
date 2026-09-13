import os
import re

os.chdir(r'd:\MyPoopAI_UpSol_Yaong1230\HaemaAI_Yaong1230')

with open('Resources/haema-console.js', 'r', encoding='utf-8') as f:
    js_content = f.read()

with open('Resources/haema-console.html', 'r', encoding='utf-8') as f:
    html_content = f.read()

# Extract CSS classes from JS
js_classes = set(re.findall(r'class="([^"]+)"', js_content))

print('=== JS에서 사용하는 CSS 클래스 ===')
missing = []
for cls in sorted(js_classes):
    if cls in html_content:
        print(f'  ✓ {cls}')
    else:
        print(f'  ✗ {cls} - HTML에 없음!')
        missing.append(cls)

print()
if missing:
    print(f'⚠ 누락된 클래스: {len(missing)}개')
else:
    print('✓ 모든 CSS 클래스가 HTML에 정의되어 있습니다.')
