import type { Boot } from '../shared/schema.ts';

export class ListenerConflict extends Error {
  constructor(readonly port:number){super(`HTTPS port ${port} is already in use. Select a different server port.`);this.name='ListenerConflict';}
}

// Binding is the final availability check. A setup-time probe cannot reserve a port across a restart.
export function listen(boot:Boot,fetch:(request:Request)=>Response|Promise<Response>){
  try{
    return Bun.serve({hostname:'0.0.0.0',port:boot.port,tls:{key:Bun.file(boot.tlsKey),cert:Bun.file(boot.tlsCert)},fetch,maxRequestBodySize:2*1024*1024,idleTimeout:60});
  }catch(error){
    if(error&&typeof error==='object'&&'code' in error&&error.code==='EADDRINUSE')throw new ListenerConflict(boot.port);
    throw error;
  }
}
