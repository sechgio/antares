with open(r'c:\Users\HIDROAA\Desktop\Cosmo\frontend\src\index.css', 'a', encoding='utf-8') as f:
    f.write('\n\n:root {\n  --display-light-logo: none;\n  --display-dark-logo: block;\n}\n\nhtml[data-theme-mode="light"] {\n  --display-light-logo: block;\n  --display-dark-logo: none;\n}\n')
