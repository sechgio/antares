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

def write_svg(name, b64):
    content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img">
  <image href="data:image/png;base64,{b64}" width="256" height="256" />
</svg>"""
    with open(rf'c:\Users\HIDROAA\Desktop\Cosmo\frontend\public\{name}', 'w', encoding='utf-8') as f:
        f.write(content)

write_svg('logo-light.svg', b64_light)
write_svg('logo-dark.svg', b64_dark)
print('Generated individual SVGs.')
