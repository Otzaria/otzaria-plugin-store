import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {OtzariaInstallProbe} from '../web/js/store/otzaria_probe.js';

const EXE = 'C:\\Users\\u\\AppData\\Local\\Programs\\Otzaria\\otzaria.exe';

function probeWith({exeVersion, stored = null}) {
  const files = new Map();
  if (stored !== null) files.set('C:\\Data\\state.json', JSON.stringify(stored));
  files.set(EXE, '');
  const fs = {
    fileExists: async (path) => files.has(path),
    dirExists: async () => false,
    readText: async (path) => files.get(path),
    writeText: async (path, text) => { files.set(path, text); },
    list: async () => [],
  };
  const sys = {
    exeVersion: async () => exeVersion,
    runningOtzaria: async () => ({running: true, launchPath: EXE}),
    registryDirs: async () => [],
  };
  return new OtzariaInstallProbe({
    fs, sys, env: {}, statePath: 'C:\\Data\\state.json', selfPath: 'C:\\s.exe',
  });
}

describe('OtzariaInstallProbe.version', () => {
  it('#302: גרסת ה-exe מתורגמת לגרסת השחרור עם ה-hotfix', async () => {
    const probe = probeWith({exeVersion: '0.9.98+99803'});
    await probe.ensureDetected();
    assert.equal(probe.launchPath, EXE);
    assert.equal(probe.version, '0.9.98.3');
  });

  it('גם ממצב שמור שנשא את הגרסה הגולמית', async () => {
    const probe = probeWith({
      exeVersion: null,
      stored: {installedTagName: '0.9.98+99803', launchPath: EXE},
    });
    await probe.ensureDetected();
    assert.equal(probe.version, '0.9.98.3');
  });
});
