const { spawn } = require('child_process');
const path = require('path');

const child = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000'], {
  cwd: path.join(__dirname),
  detached: true,
  stdio: 'ignore',
  env: { ...process.env },
});

child.unref();
console.log(`Backend PID: ${child.pid}`);
