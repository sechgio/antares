import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend import handlers
from backend.handlers import _state
import threading
import time

def test_concurrent_state_access():
    """Test that concurrent access to ProcessState is safe."""
    results = []
    
    def reader():
        for _ in range(100):
            with _state._lock:
                results.append(_state.running)
    
    def writer():
        for i in range(100):
            with _state._lock:
                _state.progress = i
    
    threads = [threading.Thread(target=reader) for _ in range(5)] + \
              [threading.Thread(target=writer) for _ in range(5)]
    
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    
    assert len(results) == 500
    print("Race condition test passed!")

if __name__ == '__main__':
    # Reset state before test
    handlers._reset_state()
    test_concurrent_state_access()

