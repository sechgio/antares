import os, glob
from PIL import Image

logo_path = r'c:\Users\HIDROAA\Desktop\Cosmo\antares\logo1.png'
fav_path = r'c:\Users\HIDROAA\Desktop\Cosmo\antares\favicon1.png'
assets_dir = r'c:\Users\HIDROAA\Desktop\Cosmo\assets'
public_dir = r'c:\Users\HIDROAA\Desktop\Cosmo\frontend\public'

# Clean directories from old favicons and logos
def clean_dir(d):
    files_to_remove = glob.glob(os.path.join(d, "*.png")) + \
                      glob.glob(os.path.join(d, "*.ico")) + \
                      glob.glob(os.path.join(d, "*.icns"))
    for f in files_to_remove:
        try:
            os.remove(f)
            print(f"Removed: {f}")
        except Exception as e:
            print(f"Failed to remove {f}: {e}")

clean_dir(assets_dir)
clean_dir(public_dir)

logo_img = Image.open(logo_path)
fav_img = Image.open(fav_path)

# Generate new favicons
fav_resized = fav_img.resize((256, 256), Image.Resampling.LANCZOS)
sizes_ico = [(256,256), (128,128), (64,64), (32,32), (16,16)]
fav_resized.save(os.path.join(public_dir, 'favicon.ico'), format='ICO', sizes=sizes_ico)
fav_resized.save(os.path.join(assets_dir, 'favicon.ico'), format='ICO', sizes=sizes_ico)

# Generate new icons
icon_512 = logo_img.resize((512, 512), Image.Resampling.LANCZOS)
icon_512.save(os.path.join(public_dir, 'icon.png'), format='PNG')
icon_512.save(os.path.join(assets_dir, 'icon.png'), format='PNG')
icon_512.save(os.path.join(assets_dir, 'icon_512.png'), format='PNG')

icon_256 = logo_img.resize((256, 256), Image.Resampling.LANCZOS)
icon_256.save(os.path.join(assets_dir, 'icon.ico'), format='ICO', sizes=sizes_ico)
icon_256.save(os.path.join(assets_dir, 'app.ico'), format='ICO', sizes=sizes_ico)

print("Icons replaced successfully.")
