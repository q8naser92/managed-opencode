import { join } from 'node:path';
import { VERSION } from '../shared/version.ts';
import { Boot } from '../shared/schema.ts';
import { machineDirectory } from '../shared/windows.ts';
import { Store } from './store.ts';
import { createApp } from './app.ts';
import { samlRoutes } from './saml.ts';
import { listen,ListenerConflict } from './listen.ts';
import { initializeAdministrator,assertAdministratorAccess } from './bootstrap.ts';
import { validateInstallation,verifyListener } from './validate-installation.ts';
import { smtpSettings,mailTransport } from './email-login.ts';
import page from './web/index.html' with {type:'text'};
import style from './web/app.css' with {type:'text'};
import script from './web/app.js' with {type:'text'};
import connectorScript from './web/connectors.js' with {type:'text'};

try {
  const data=join(machineDirectory('data'),'Server');
  const boot=Boot.parse(await Bun.file(join(data,'server.json')).json());
  const result=Bun.spawnSync([join(machineDirectory('programs'),'Server','managed-service.exe'),'read-key'],{stdout:'pipe',stderr:'pipe'});
  if (result.exitCode!==0) throw new Error('Cannot open protected server vault');
  const key=Buffer.from(result.stdout.toString().trim(),'base64');
  const store=new Store(join(data,'management.sqlite'),key);store.initialize(boot.initialPolicy);
  validateInstallation(boot,store);
  if(process.argv[2]==='--bootstrap'){
    if(process.argv.length!==4)throw new Error('Bootstrap file required');
    initializeAdministrator(store,await Bun.file(process.argv[3]!).json());const mail=mailTransport(boot,store,smtpSettings(store)!);try{await mail.verify();}finally{mail.close();}store.close();console.log('Administrator configuration saved.');process.exit(0);
  }
  if(process.argv[2]==='--validate'){store.close();console.log('Server configuration validated.');process.exit(0);}
  if(process.argv[2]==='--validate-access'){assertAdministratorAccess(boot,store);store.close();console.log('Administrator sign-in configured.');process.exit(0);}
  if(process.argv[2]==='--healthcheck'){store.close();await verifyListener(boot);console.log('Management HTTPS listener verified.');process.exit(0);}
  if(process.argv.length>2)throw new Error('Unsupported server command');
  const app=createApp(boot,store);app.route('/auth',samlRoutes(boot,store));
  app.get('/',c=>c.html(String(page)));
  app.get('/assets/app.css',c=>c.body(style,200,{'Content-Type':'text/css; charset=utf-8'}));
  app.get('/assets/app.js',c=>c.body(script,200,{'Content-Type':'text/javascript; charset=utf-8'}));
  app.get('/assets/connectors.js',c=>c.body(connectorScript,200,{'Content-Type':'text/javascript; charset=utf-8'}));
  const server=listen(boot,app.fetch);
  store.audit('service','service.started','management','success',{version:VERSION,port:boot.port});
  for(const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,async()=>{server.stop(true);await store.drain();store.close();process.exit(0);});
  setInterval(()=>{
    store.db.query('DELETE FROM transient WHERE expires<?').run(Date.now());
    store.db.query('DELETE FROM sessions WHERE expires<?').run(Date.now());
    store.db.query('DELETE FROM actions WHERE expires<?').run(Date.now()-24*3600_000);
  },60_000).unref();
} catch(error) {
  // Boot configuration and vault material must not appear in console/Windows event logs.
  console.error('Managed server startup failed:',error instanceof ListenerConflict?error.message:error instanceof Error?error.name:'Error');
  process.exit(1);
}
