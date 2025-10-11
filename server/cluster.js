import cluster from 'cluster';
import os from 'os';

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  
  // Start main server
  cluster.fork({ WORKER_TYPE: 'server' });
  
  // Start audio worker
  cluster.fork({ WORKER_TYPE: 'audio' });
  
  // Start PDF worker  
  cluster.fork({ WORKER_TYPE: 'pdf' });
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork();
  });
} else {
  switch (process.env.WORKER_TYPE) {
    case 'audio':
      import('./worker.js');
      break;
    case 'pdf':
      import('./pdf-worker.js');
      break;
    default:
      import('./index.js');
  }
}