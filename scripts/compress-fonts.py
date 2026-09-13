import sys
from pathlib import Path
sys.path.insert(0,str(Path('.native/fonttools').resolve()))
from fontTools.ttLib import TTFont
css_path=Path('public/fonts.css')
css=css_path.read_text(encoding='utf-8')
for source in Path('public/fonts').glob('*.ttf'):
    font=TTFont(source)
    font.flavor='woff2'
    dest=source.with_suffix('.woff2')
    font.save(dest)
    css=css.replace('/fonts/'+source.name,'/fonts/'+dest.name)
    print(source.name,source.stat().st_size,'->',dest.stat().st_size)
css=css.replace("format('truetype')","format('woff2')")
css_path.write_text(css,encoding='utf-8')
