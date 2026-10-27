#!/usr/bin/python3
"""Consistent SQLite backup; never copies a live WAL database as a plain file."""
import datetime
import pathlib
import sqlite3

root = pathlib.Path('/var/lib/deep-dialogues')
backups = root / 'backups'
backups.mkdir(mode=0o700, exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
with sqlite3.connect(root / 'dialogues.sqlite') as source:
    with sqlite3.connect(backups / f'dialogues-{stamp}.sqlite') as target:
        source.backup(target)
        assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print('Deep Dialogues backup verified')
