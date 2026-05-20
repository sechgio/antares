import zipfile
from xml.etree import ElementTree as ET

with zipfile.ZipFile('aviso-volanteo-panel.docx', 'r') as z:
    xml = z.read('word/document.xml')
    tree = ET.fromstring(xml)
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    a_ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
    wp_ns = {'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}

    print("=== Image dimensions ===")
    drawings = tree.findall('.//w:drawing', ns)
    for i, dwg in enumerate(drawings):
        extent = dwg.find('.//wp:extent', wp_ns)
        if extent is not None:
            cx = extent.get('cx')
            cy = extent.get('cy')
            print(f'  Drawing {i}: cx={cx} cy={cy} (EMU)')

    print("\n=== Paragraphs with drawings ===")
    paragraphs = tree.findall('.//w:p', ns)
    for i, p in enumerate(paragraphs):
        texts = p.findall('.//w:t', ns)
        text = ''.join(t.text or '' for t in texts)
        has_drawing = p.find('.//w:drawing', ns) is not None
        if has_drawing:
            pPr = p.find('.//w:pPr', ns)
            align = ''
            if pPr is not None:
                jc = pPr.find('.//w:jc', ns)
                if jc is not None:
                    align = jc.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '')
            print(f'  Para {i}: align={align} "{text}"')

    print('\n=== Full paragraph dump (first 25) ===')
    for i, p in enumerate(paragraphs[:25]):
        texts = p.findall('.//w:t', ns)
        text = ''.join(t.text or '' for t in texts)
        has_drawing = p.find('.//w:drawing', ns) is not None
        pPr = p.find('.//w:pPr', ns)
        align = ''
        if pPr is not None:
            jc = pPr.find('.//w:jc', ns)
            if jc is not None:
                align = jc.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '')
        print(f'  Para {i}: align={align} drawing={has_drawing} "{text}"')

    print('\n=== Images ===')
    try:
        rels = z.read('word/_rels/document.xml.rels')
        rel_tree = ET.fromstring(rels)
        rel_ns = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
        rels_list = rel_tree.findall('.//r:Relationship', rel_ns)
        for rel in rels_list:
            target = rel.get('Target', '')
            type_ = rel.get('Type', '')
            if 'image' in type_:
                print(f'Image: {target}')
    except Exception as e:
        print(f'No rels found: {e}')
