import os
os.chdir('d:/MyPoopAI_UpSol_Yaong1230/HaemaAI_Yaong1230/Resources')

with open('haema-console.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 스크립트 태그 교체
old_script = """    <script>
        console.log('HAEMA.AI 콘솔 로드됨');
    </script>
</body>
</html>"""

new_script = """    <script src="haema-console.js"></script>
</body>
</html>"""

if old_script in content:
    content = content.replace(old_script, new_script)
    with open('haema-console.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('HTML 파일 업데이트 완료')
else:
    print('기존 스크립트 태그를 찾을 수 없습니다')
    print('파일 끝부분:')
    print(repr(content[-200:]))
