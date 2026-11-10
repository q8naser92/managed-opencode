import { dlopen } from 'bun:ffi';
import { join } from 'node:path';

export function machineDirectory(kind:'data'|'programs') {
  if (process.platform!=='win32') throw new Error('This package requires Windows');
  const library=dlopen('shell32.dll',{SHGetFolderPathW:{args:['ptr','i32','ptr','u32','ptr'],returns:'i32'}});
  try {
    const buffer=new Uint16Array(260);
    if (library.symbols.SHGetFolderPathW(null,kind==='data'?0x23:0x26,null,0,buffer)!==0) throw new Error('Cannot resolve Windows machine directory');
    const length=buffer.indexOf(0);if(length<=0)throw new Error('Invalid Windows machine directory');
    return join(new TextDecoder('utf-16le').decode(buffer.subarray(0,length)),'ManagedOpenCodeCentral');
  } finally {library.close();}
}
