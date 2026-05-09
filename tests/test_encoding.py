import os
import sys

# Add project root to path so backend is recognized as a package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.main import _validate_encoding


def test_encoding_validation():
    """Test that encoding validation works."""
    try:
        _validate_encoding()
        print("Encoding validation passed!")
    except Exception as e:
        print(f"Encoding validation failed: {e}")
        sys.exit(1)

if __name__ == '__main__':
    test_encoding_validation()
