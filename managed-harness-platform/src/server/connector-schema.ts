import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { HTTPException } from 'hono/http-exception';
import { ToolSpec } from '../shared/schema.ts';
import type { Connector } from '../shared/schema.ts';

export function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,value])=>JSON.stringify(key)+':'+canonical(value)).join(',')+'}';return JSON.stringify(value);}
export function validator(schema:Record<string,unknown>){
  if(schema.type!=='object')throw new HTTPException(400,{message:'Tool input schemas must describe an object'});
  if(schema.properties&&typeof schema.properties==='object'&&Object.hasOwn(schema.properties,'__proto__'))throw new HTTPException(400,{message:'The reserved __proto__ argument name is not supported'});
  if(JSON.stringify(schema).length>100_000)throw new HTTPException(400,{message:'Tool schema is too large'});
  const ajv=new (String(schema.$schema??'').includes('draft-07')?Ajv:Ajv2020)({strict:false,validateSchema:true,allErrors:false,removeAdditional:false,useDefaults:false,coerceTypes:false,ownProperties:true});addFormats(ajv);
  try{return ajv.compile(schema);}catch{throw new HTTPException(400,{message:'Unsupported or invalid JSON schema; use inline schemas or local references'});}
}
export function validateTools(connector:Connector){for(const tool of connector.tools){validator(tool.inputSchema);if(connector.type==='api')apiUrl(connector,tool,{},true);}}
export function validateArguments(tool:Connector['tools'][number],args:Record<string,unknown>){
  if(!validator(tool.inputSchema)(args))throw new HTTPException(400,{message:'Arguments do not match the approved action schema'});
  for(const [key,allowed]of Object.entries(tool.resourceRules)){const value=args[key];const values=Array.isArray(value)?value:[value];if(!values.length||values.some(v=>typeof v!=='string'||!allowed.includes(v)))throw new HTTPException(403,{message:'Argument is outside the approved resource scope'});}
}
export function apiUrl(connector:Connector,tool:Connector['tools'][number],args:Record<string,unknown>,validateOnly=false){
  const base=new URL(connector.url);if(base.search)throw new HTTPException(400,{message:'API base URLs must not contain a query'});
  if(!tool.path?.startsWith('/')||tool.path.startsWith('//')||/[\\?#%\u0000-\u0020\u007f]/.test(tool.path)||tool.path.split('/').some(p=>p==='.'||p==='..'))throw new HTTPException(400,{message:'Use a relative API path beginning with one slash, without controls, whitespace, a query or traversal'});
  const used=new Set<string>();const path=tool.path.replace(/\{([a-zA-Z0-9_-]+)\}/g,(_,name:string)=>{used.add(name);if(validateOnly)return 'parameter';const value=args[name];if(!['string','number','boolean'].includes(typeof value)||String(value)==='.'||String(value)==='..'||String(value).length===0||/[\\/%?#]/.test(String(value)))throw new HTTPException(400,{message:'Invalid path parameter'});return encodeURIComponent(String(value));});
  if(/[{}]/.test(path))throw new HTTPException(400,{message:'Invalid API path template'});
  const url=new URL(base.href.replace(/\/$/,'')+path);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'))throw new HTTPException(400,{message:'Invalid API destination'});
  const remaining=Object.fromEntries(Object.entries(args).filter(([key])=>!used.has(key)));
  for(const [key,value]of Object.entries(remaining)){if(tool.method==='GET'||tool.queryParams.includes(key)){for(const item of Array.isArray(value)?value:[value]){if(!['string','number','boolean'].includes(typeof item))throw new HTTPException(400,{message:'Query arguments must be scalar values or arrays of scalar values'});url.searchParams.append(key,String(item));}delete remaining[key];}}
  return {url,body:tool.method==='GET'?undefined:tool.bodyArgument?(Object.hasOwn(remaining,tool.bodyArgument)?remaining[tool.bodyArgument]:undefined):remaining};
}

/** Import inline OpenAPI 3 operations only. No network fetches or external $ref resolution. */
export function importOpenApi(document:unknown){
  if(!document||typeof document!=='object')throw new HTTPException(400,{message:'An OpenAPI object is required'});
  const doc=document as Record<string,unknown>;if(typeof doc.openapi!=='string'||!doc.openapi.startsWith('3.')||!doc.paths||typeof doc.paths!=='object')throw new HTTPException(400,{message:'Use an OpenAPI 3 document'});
  function expand(value:unknown,depth=0):unknown {if(depth>30)throw new HTTPException(400,{message:'OpenAPI reference nesting is too deep or recursive'});if(Array.isArray(value))return value.map(v=>expand(v,depth+1));if(!value||typeof value!=='object')return value;const obj=value as Record<string,unknown>;if('$ref'in obj){if(typeof obj.$ref!=='string'||!obj.$ref.startsWith('#/'))throw new HTTPException(400,{message:'Only local OpenAPI references are supported'});let current:unknown=doc;for(const part of obj.$ref.slice(2).split('/').map(v=>v.replaceAll('~1','/').replaceAll('~0','~'))){if(!current||typeof current!=='object'||!Object.hasOwn(current,part))throw new HTTPException(400,{message:'Unresolved OpenAPI reference'});current=(current as Record<string,unknown>)[part];}return expand(current,depth+1);}return Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,expand(v,depth+1)]));}
  const tools:Connector['tools']=[];
  for(const [path,raw]of Object.entries(doc.paths)){
    const pathItem=expand(raw) as Record<string,unknown>;
    for(const method of ['get','post','put','patch','delete']as const){if(!pathItem[method])continue;const op=pathItem[method] as Record<string,unknown>;const properties:Record<string,unknown>=Object.create(null);const required:string[]=[];const queryParams:string[]=[];
      for(const p of [...(pathItem.parameters as Record<string,unknown>[]??[]),...(op.parameters as Record<string,unknown>[]??[])]){if(!['path','query'].includes(String(p.in))||typeof p.name!=='string'||!p.schema)throw new HTTPException(400,{message:'Imported operations support path and query parameters with schemas; define other operations manually'});properties[p.name]=p.schema;if(p.required||p.in==='path')required.push(p.name);if(p.in==='query')queryParams.push(p.name);}
      let bodyArgument: string|undefined;if(op.requestBody){const body=op.requestBody as {required?:boolean;content?:Record<string,{schema?:unknown}>};const schema=body.content?.['application/json']?.schema;if(!schema)throw new HTTPException(400,{message:'Only JSON request bodies are supported'});if(properties.body)throw new HTTPException(400,{message:'Rename the body parameter before importing'});properties.body=schema;bodyArgument='body';if(body.required)required.push('body');}
      const tool=ToolSpec.parse({name:op.operationId??method+'_'+path.replace(/[^a-zA-Z0-9]/g,'_'),description:op.summary??op.description??'',inputSchema:{type:'object',properties,required:[...new Set(required)],additionalProperties:false},enabled:false,mode:'deny',method:method.toUpperCase(),path,queryParams,bodyArgument});validator(tool.inputSchema);tools.push(tool);
    }
  }
  if(tools.length>150||new Set(tools.map(t=>t.name)).size!==tools.length)throw new HTTPException(400,{message:'Import at most 150 uniquely named operations'});return tools;
}
