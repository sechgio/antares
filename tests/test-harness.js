const childProcess = require('child_process');
const { EventEmitter } = require('events');
const { assert, finish, makeFakeProc, patchSpawn } = require('./helpers/harness');

async function run() {
  const originalSpawn = childProcess.spawn;
  const originalExecFile = childProcess.execFile;
  const nativeCalls = [];
  const sentinelExecFile = (...args) => {
    nativeCalls.push(args[0]);
    args.at(-1)?.(null, '', '');
    return new EventEmitter();
  };
  childProcess.execFile = sentinelExecFile;
  const spawn = patchSpawn(() => makeFakeProc({ pid: process.pid, ready: false }));
  try {
    const fake = childProcess.spawn('python', []);
    let callbackCalled = false;
    childProcess.execFile('taskkill', ['/pid', String(fake.pid), '/T', '/F'], {}, (error) => {
      assert(error == null, 'simulated taskkill completes without an error');
      callbackCalled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert(callbackCalled, 'simulated taskkill invokes its callback');
    assert(nativeCalls.length === 0, 'fake process cleanup never reaches the native taskkill');
    childProcess.execFile('other-command', [], {}, () => {});
    assert(nativeCalls.join(',') === 'other-command', 'other commands keep their existing implementation');
  } finally {
    spawn.restore();
    assert(childProcess.spawn === originalSpawn, 'restore reinstates spawn');
    assert(childProcess.execFile === sentinelExecFile, 'restore reinstates execFile');
    childProcess.execFile = originalExecFile;
  }
  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
