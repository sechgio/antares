import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.utils.validators import sanitizar_nombre


def test_path_traversal_prevention():
    """Test that path traversal characters are removed."""
    bad_names = [
        "../../../etc/passwd",
        "..\\..\\windows\\system32",
        "normal_file_../traversal",
        "file with spaces and ../dots",
    ]

    for name in bad_names:
        result = sanitizar_nombre(name)
        assert '../' not in result, f"Path traversal not prevented: {result}"
        assert '..\\' not in result, f"Path traversal not prevented: {result}"

    print("Path traversal tests passed!")

def test_control_characters():
    """Test that control characters are removed."""
    name_with_control = "file\x00name.txt"  # Null byte
    result = sanitizar_nombre(name_with_control)
    assert '\x00' not in result, "Control character not removed"

    name_with_tab = "file\tname.txt"
    result = sanitizar_nombre(name_with_tab)
    assert '\t' not in result, "Tab character not removed"

    print("Control character tests passed!")

def test_leading_dots():
    """Test that leading dots are removed (hidden files on Unix)."""
    hidden_file = ".hidden_file.txt"
    result = sanitizar_nombre(hidden_file)
    assert not result.startswith('.'), "Leading dot not removed"

    print("Leading dots tests passed!")

if __name__ == '__main__':
    test_path_traversal_prevention()
    test_control_characters()
    test_leading_dots()
    print("All path sanitization tests passed!")
