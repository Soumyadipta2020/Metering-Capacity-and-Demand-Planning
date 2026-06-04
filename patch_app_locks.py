with open('app.py', 'r', encoding='utf-8') as f:
    content = f.read()

import_idx = content.find('def _auto_generate_data_enabled() -> bool:')

locks = """import threading
_generation_lock = threading.Lock()

def _acquire_generation_lock() -> bool:
    return _generation_lock.acquire(blocking=False)

def _release_generation_lock() -> None:
    try:
        _generation_lock.release()
    except RuntimeError:
        pass

"""

if import_idx != -1:
    content = content[:import_idx] + locks + content[import_idx:]
    with open('app.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Added lock functions')
else:
    print('Could not find injection point')
