import os, base64
from PIL import Image

def get_b64(path, size=256):
    img = Image.open(path)
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    img.save('temp.png', 'PNG')
    with open('temp.png', 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('utf-8')
    os.remove('temp.png')
    return b64

b64_light = get_b64(r'c:\Users\HIDROAA\Desktop\Cosmo\antares\logo1.png', 256)
b64_dark = get_b64(r'c:\Users\HIDROAA\Desktop\Cosmo\antares\logo2.png', 256)

svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="ANTARES logo">
  <style>
    .light-logo {{ display: block; }}
    .dark-logo {{ display: none; }}
    @media (prefers-color-scheme: dark) {{
      .light-logo {{ display: none; }}
      .dark-logo {{ display: block; }}
    }}
    :root[data-theme-mode="dark"] .light-logo {{ display: none !important; }}
    :root[data-theme-mode="dark"] .dark-logo {{ display: block !important; }}
    :root[data-theme-mode="light"] .light-logo {{ display: block !important; }}
    :root[data-theme-mode="light"] .dark-logo {{ display: none !important; }}
  </style>
  <image class="light-logo" href="data:image/png;base64,{b64_light}" width="256" height="256" />
  <image class="dark-logo" href="data:image/png;base64,{b64_dark}" width="256" height="256" />
</svg>"""

with open(r'c:\Users\HIDROAA\Desktop\Cosmo\assets\logo.svg', 'w', encoding='utf-8') as f:
    f.write(svg_content)
with open(r'c:\Users\HIDROAA\Desktop\Cosmo\frontend\public\logo.svg', 'w', encoding='utf-8') as f:
    f.write(svg_content)
print('Generated responsive SVG.')
