import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(os.getcwd())))

from backend.core.technical_reports.models import create_empty_report
from backend.core.technical_reports.rendering import render_report_html
from backend.handlers.technical_reports import _sanitize_html_for_pdf
from weasyprint import HTML

def test_render():
    report = create_empty_report(1)
    # Mock some data
    report['header']['cs'] = 'TEST CS'
    report['header']['codigo_infraestructura'] = 'INF-001'
    
    print("Rendering HTML...")
    html = render_report_html(report)
    
    print("Sanitizing HTML...")
    html = _sanitize_html_for_pdf(html)
    
    print("Generating PDF...")
    try:
        HTML(string=html).write_pdf("test_output_sanitized.pdf")
        print("Success! test_output_sanitized.pdf generated.")
    except Exception as e:
        print(f"FAILED: {e}")

if __name__ == "__main__":
    test_render()
