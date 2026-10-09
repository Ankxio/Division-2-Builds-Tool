"""Runs every automatic update. GitHub runs this one file every hour, so a new updater only
has to be added to the list below, never to the workflow on GitHub.

One updater failing does not stop the others, and each keeps its last good files.
"""
import os, subprocess, sys

UPDATERS = ['update_calendar.py', 'update_snapshot.py', 'update_escalation.py']
here = os.path.dirname(os.path.abspath(__file__))

failed = []
for name in UPDATERS:
    print(f'== {name}', flush=True)
    if subprocess.run([sys.executable, os.path.join(here, name)]).returncode:
        failed.append(name)
        print(f'!! {name} failed; its files were left as they were', flush=True)
print('Finished.' + (f" Failed: {', '.join(failed)}" if failed else ''))
