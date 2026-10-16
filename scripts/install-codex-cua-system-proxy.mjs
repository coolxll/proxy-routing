#!/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node
// Run with sudo; preserve unrelated system configuration and keep a root-only rollback snapshot.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const config='/etc/codex/config.toml', launcher='/usr/local/libexec/codex-cua-proxy.mjs';
const record='/etc/codex/cua-proxy-install.json';
const sourceFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'codex-cua-proxy-launcher.mjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
function atomic(file,body,mode){const tmp=file+'.tmp-'+process.pid;try{fs.writeFileSync(tmp,body,{mode});fs.chmodSync(tmp,mode);fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
if(process.getuid()!==0)throw new Error('Run this installer with sudo on this Mac');
if(process.argv.includes('--rollback')){
 const saved=JSON.parse(fs.readFileSync(record,'utf8'));
 const body=fs.readFileSync(config,'utf8');
 if(!body.includes(saved.block))throw new Error('System CUA block changed; merge manually');
 if(hash(fs.readFileSync(launcher,'utf8'))!==saved.launcherHash)throw new Error('Launcher changed; preserve it and merge manually');
 const rest=body.replace(saved.block,'');
 if(saved.previousConfig===null&&!rest.trim())fs.unlinkSync(config);else atomic(config,rest,0o644);
 if(saved.previousLauncher===null)fs.unlinkSync(launcher);else atomic(launcher,saved.previousLauncher,saved.previousLauncherMode);
 fs.unlinkSync(record);console.log('System CUA override removed. Restart Codex manually.');
}else{
 const owner=process.env.SUDO_UID,user=process.env.SUDO_USER;
 if(!/^\d+$/.test(owner||'')||owner==='0'||!user)throw new Error('Missing sudo caller identity');
 fs.mkdirSync(path.dirname(config),{recursive:true,mode:0o755});fs.mkdirSync(path.dirname(launcher),{recursive:true,mode:0o755});
 if(fs.existsSync(record))throw new Error('Already installed; inspect existing system override first');
 const previousConfig=fs.existsSync(config)?fs.readFileSync(config,'utf8'):null;
 const previousLauncher=fs.existsSync(launcher)?fs.readFileSync(launcher,'utf8'):null;
 const previousLauncherMode=fs.existsSync(launcher)?fs.statSync(launcher).mode&0o777:null;
 if(previousConfig?.includes('[mcp_servers.cua_repl]'))throw new Error('Existing system CUA configuration requires a manual merge');
 const source=fs.readFileSync(sourceFile,'utf8');
 const block='# BEGIN codex-cua-proxy\n[mcp_servers.cua_repl]\ncommand = '+JSON.stringify(launcher)+'\nargs = []\nenabled = true\nstartup_timeout_sec = 120\nenabled_tools = ["js", "js_reset", "turn_ended"]\n[mcp_servers.cua_repl.env]\nCODEX_CUA_PROXY_OWNER_UID = '+JSON.stringify(owner)+'\n# END codex-cua-proxy\n';
 const saved={block,previousConfig,previousLauncher,previousLauncherMode,launcherHash:hash(source),installedAt:new Date().toISOString()};
 atomic(record,JSON.stringify(saved,null,2),0o600);
 try{
  atomic(launcher,source,0o755);atomic(config,(previousConfig||'').trimEnd()+'\n\n'+block,0o644);
  const cli='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  const result=spawnSync('/usr/bin/sudo',['-u',user,cli,'mcp','get','cua_repl','--json'],{cwd:'/private/tmp',encoding:'utf8',timeout:15000});
  if(result.status!==0||JSON.parse(result.stdout).transport.command!==launcher)throw new Error('System CUA transport verification failed');
  console.log('System CUA launcher installed and selected outside the project. Restart Codex manually.');
 }catch(e){
  if(previousConfig===null)fs.rmSync(config,{force:true});else atomic(config,previousConfig,0o644);
  if(previousLauncher===null)fs.rmSync(launcher,{force:true});else atomic(launcher,previousLauncher,previousLauncherMode);
  fs.rmSync(record,{force:true});throw e;
 }
}
