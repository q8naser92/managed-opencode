import { chromium, expect } from '@playwright/test';
import { join } from 'node:path';
import { Policy } from '../src/shared/schema.ts';

// Browser UI test with synthetic API responses; real authorization is covered by
// authorization.test.ts. This does not claim to test a deployed Windows service.
let policy=Policy.parse({revision:0,gatewayUrl:'https://gateway.example/v1',models:[],tools:{read:'ask',edit:'ask',cmd:'allow',powershell:'ask'},maxCommandSeconds:60,maxSessionSteps:20});
const published:Policy[]=[];
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
  const url=new URL(request.url);
  const asset=url.pathname==='/'?'index.html':url.pathname.startsWith('/assets/')?url.pathname.slice(8):'';
  if(!['index.html','app.js','app.css','connectors.js'].includes(asset))return new Response('Not found',{status:404});
  return new Response(Bun.file(join(import.meta.dir,'../src/server/web',asset)));
}});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  await page.route('**/api/**',async route=>{
    const request=route.request();const path=new URL(request.url()).pathname;
    let result:unknown;
    if(path==='/api/me')result={id:'test-admin',admin:true,csrf:'synthetic-ui-test',hasGatewayKey:false};
    else if(path==='/api/catalog')result={...policy,connectors:[]};
    else if(path==='/api/admin/origins')result=['https://gateway.example'];
    else if(path==='/api/admin/policy'){
      if(request.method()==='PUT'){const next=Policy.parse(request.postDataJSON());expect(next.revision).toBe(policy.revision);policy={...next,revision:policy.revision+1};published.push(policy);}
      result=policy;
    }else throw new Error('Unexpected request '+path);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(server.url.toString());
  await page.getByRole('button',{name:'Policy & models',exact:true}).click();
  const shell=page.getByLabel('macOS shell (zsh / bash)',{exact:true});
  await expect(shell).toHaveValue('deny');
  await expect(page.getByLabel('CMD',{exact:true})).toHaveValue('allow');
  for(const mode of ['allow','ask','deny'] as const){
    await shell.selectOption(mode);
    await page.getByRole('button',{name:'Publish policy',exact:true}).click();
    await expect(page.getByRole('status')).toHaveText('Policy published.');
    await expect(shell).toHaveValue(mode);
    expect(published.at(-1)?.tools).toEqual({read:'ask',edit:'ask',cmd:'allow',powershell:'ask',shell:mode});
  }
  const report={passed:true,scope:'Chromium administration GUI with synthetic API; not macOS runtime',published:published.map(p=>({revision:p.revision,tools:p.tools}))};
  await Bun.write(join(import.meta.dir,'../test-results/mac-preparation-policy-ui.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{await browser.close();server.stop(true);}
