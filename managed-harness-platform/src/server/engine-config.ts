import type { Connector,Policy } from '../shared/schema.ts';
import { approvedModels } from '../shared/schema.ts';

export function engineConfig(origin:string,policy:Policy,connectors:Connector[]) {
  const models=approvedModels(policy);
  const allowed=connectors.filter(c=>c.enabled);
  const local=['read','glob','grep','edit','write','patch','shell'];
  const policies=[...['provider.use','integration.connect','integration.use','mcp.use','plugin.use','skill.use','websearch.use','tool.use'].map(action=>({action,resource:'*',effect:'deny'})),
    ...['provider.use','integration.use'].map(action=>({action,resource:'managed',effect:'allow'})),
    ...local.map(name=>({action:'tool.use',resource:name+':*',effect:'allow'})),
    ...allowed.flatMap(connector=>[{action:'mcp.use',resource:connector.id,effect:'allow'},...connector.tools.filter(t=>t.enabled&&t.mode!=='deny').map(tool=>({action:'tool.use',resource:connector.id+'_'+tool.name+':*',effect:'allow'}))])];
  return {
    policies,
    permissions:[{action:'*',resource:'*',effect:'deny'},...local.map(action=>({action:action==='write'||action==='patch'?'edit':action,resource:'*',effect:'allow'})),{action:'external_directory',resource:'*',effect:'allow'},
      ...allowed.flatMap(conn=>conn.tools.filter(t=>t.enabled&&t.mode!=='deny').map(t=>({action:conn.id+'_'+t.name,resource:'*',effect:'allow'})))],
    lsp:false,formatter:false,snapshots:false,share:'disabled',update:'disable',
    agents:{build:{steps:policy.maxSessionSteps},plan:{steps:policy.maxSessionSteps}},
    ...(models.length?{model:'managed/'+models[0]!.id}:{}),
    providers:{managed:{name:'Managed AI gateway',package:'@opencode/ai/providers/openai-compatible',settings:{baseURL:origin+'/api/gateway/v1',apiKey:'{env:MANAGED_OPENCODE_SESSION}'},models:Object.fromEntries(models.map(m=>[m.id,{name:m.name,capabilities:{tools:true,input:['text'],output:['text']}}]))}},
    mcp:{servers:Object.fromEntries(allowed.map(c=>[c.id,{type:'remote',url:origin+'/api/connectors/'+c.id+'/mcp',oauth:false,codemode:false,headers:{Authorization:'Bearer {env:MANAGED_OPENCODE_SESSION}'}}]))},
  };
}
