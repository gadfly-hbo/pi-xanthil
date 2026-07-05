import sys
import os
import subprocess

if __name__ == "__main__":
    script_path = os.path.join(os.path.dirname(__file__), "script.py")
    sys.exit(subprocess.call([sys.executable, script_path] + sys.argv[1:]))
